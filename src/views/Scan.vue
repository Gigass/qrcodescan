<template>
  <div class="page" ref="container">
    <video
      ref="video"
      class="video"
      playsinline
      autoplay
      muted
      @loadedmetadata="onLoadedMetadata"
    />

    <div class="overlay">
      <div class="topBar">
        <div class="title">单据扫码</div>
        <div class="hint">将单据完整对准 16:9 框，二维码在右上角 2×2 区域</div>
        <div class="status" :class="{ ok: aligned, bad: !aligned }">{{ statusText }}</div>
        <div v-if="error" class="error">{{ error }}</div>
      </div>

      <div class="mask">
        <div class="docFrame" :style="docFrameStyle">
          <div class="corner tl"></div>
          <div class="corner tr"></div>
          <div class="corner bl"></div>
          <div class="corner br"></div>

          <div class="roiFrame" :style="roiFrameStyle">
            <div class="scan-line"></div>
            <div class="roiLabel">二维码区域</div>
          </div>
        </div>
      </div>

      <div class="roiPreview">
        <div class="roiPreviewTitle">实时预览</div>
        <div class="preview-container">
          <canvas ref="roiPreviewCanvas" class="roiPreviewCanvas" width="180" height="180"></canvas>
          <div class="preview-scan-line"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import jsQR from 'jsqr'
import { captureStore } from '../state/captureStore'
import { mapDisplayRectToVideoRectCover } from '../utils/videoMapping'

const SCAN_INTERVAL_MS = 100  // 降低扫描间隔，增加采样机会
const ROI_CANVAS_SIZE = 960
const LOCK_TIMEOUT_MS = 400   // 锁定后的拍照倒计时
const CAPTURE_FRAME_EXPAND = 1.5
const CAPTURE_ASPECT_W = 20
const CAPTURE_ASPECT_H = 15

export default {
  name: 'Scan',
  data() {
    return {
      stream: null,
      error: '',
      videoReady: false,
      autoCapturing: false,

      containerSize: { width: 0, height: 0 },
      docRect: { x: 0, y: 0, width: 0, height: 0 },
      roiRelRect: { x: 0, y: 0, width: 0, height: 0 },

      aligned: false,
      statusText: '未对准（请将二维码放到右上角 2×2 区域）',
      alignedText: '',

      _resizeObserver: null,
      _raf: 0,
      _lastScanAt: 0,
      _candidateText: '',
      _lastRoiVideoRect: null,
      _roiCanvas: null,
      _roiCtx: null,
      // 锁定模式相关
      _lockMode: false,        // 是否进入锁定模式
      _lockText: '',           // 锁定时的二维码内容
      _lockTimer: null,        // 锁定倒计时器
      _confirmCount: 0,        // 锁定期间再次识别到相同内容的次数
    }
  },
  computed: {
    docFrameStyle() {
      const { x, y, width, height } = this.docRect
      return {
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
      }
    },
    roiFrameStyle() {
      const { x, y, width, height } = this.roiRelRect
      return {
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
      }
    },
  },
  mounted() {
    captureStore.clear()
    this.setupCanvases()
    this.observeResize()
    this.startCamera()
  },
  beforeDestroy() {
    this.stopLoop()
    this.stopCamera()
    this.disconnectResize()
    this.clearLockTimer()
  },
  methods: {
    setupCanvases() {
      this._roiCanvas = document.createElement('canvas')
      this._roiCanvas.width = ROI_CANVAS_SIZE
      this._roiCanvas.height = ROI_CANVAS_SIZE
      this._roiCtx = this._roiCanvas.getContext('2d', { willReadFrequently: true })
      if (this._roiCtx) this._roiCtx.imageSmoothingEnabled = false
    },
    observeResize() {
      const container = this.$refs.container
      if (!container) return

      const update = () => {
        const rect = container.getBoundingClientRect()
        this.containerSize = { width: rect.width, height: rect.height }
        this.computeRects()
      }

      update()
      this._resizeObserver = new ResizeObserver(update)
      this._resizeObserver.observe(container)
    },
    disconnectResize() {
      if (this._resizeObserver) this._resizeObserver.disconnect()
      this._resizeObserver = null
    },
    computeRects() {
      const { width: cw, height: ch } = this.containerSize
      if (!cw || !ch) return

      const maxW = cw * 0.92
      const maxH = ch * 0.72

      let docW = maxW
      let docH = (docW * 9) / 16
      if (docH > maxH) {
        docH = maxH
        docW = (docH * 16) / 9
      }

      const docX = (cw - docW) / 2
      const docY = (ch - docH) / 2

      this.docRect = { x: docX, y: docY, width: docW, height: docH }

      const roiW = docW * (2 / 16)
      const roiH = docH * (2 / 9)
      const roiX = docW * (12 / 16)  // 最佳位置：75%
      const roiY = docH * (1 / 9)
      this.roiRelRect = { x: roiX, y: roiY, width: roiW, height: roiH }
    },
    getRoiAbsRect() {
      const { x: docX, y: docY } = this.docRect
      const { x: rx, y: ry, width, height } = this.roiRelRect
      return { x: docX + rx, y: docY + ry, width, height }
    },
    getRoiAbsRectWithPadding() {
      const abs = this.getRoiAbsRect()
      const padX = this.docRect.width * 0.02
      const padY = this.docRect.height * 0.02
      const x = Math.max(this.docRect.x, abs.x - padX)
      const y = Math.max(this.docRect.y, abs.y - padY)
      const maxX = this.docRect.x + this.docRect.width
      const maxY = this.docRect.y + this.docRect.height
      const width = Math.min(maxX - x, abs.width + padX)
      const height = Math.min(maxY - y, abs.height + padY)
      return { x, y, width, height }
    },
    getCaptureAbsRectExpanded() {
      const { width: displayW, height: displayH } = this.containerSize
      const base = this.docRect
      if (!displayW || !displayH || !base.width || !base.height) return null

      const targetAspect = CAPTURE_ASPECT_W / CAPTURE_ASPECT_H
      let targetW = base.width
      let targetH = base.height
      const baseAspect = targetW / targetH
      if (baseAspect > targetAspect) targetH = targetW / targetAspect
      else targetW = targetH * targetAspect

      const scale = Math.min(CAPTURE_FRAME_EXPAND, displayW / targetW, displayH / targetH)
      const cx = base.x + base.width / 2
      const cy = base.y + base.height / 2
      const w = targetW * scale
      const h = targetH * scale

      let x = cx - w / 2
      let y = cy - h / 2
      x = Math.max(0, Math.min(displayW - w, x))
      y = Math.max(0, Math.min(displayH - h, y))
      return { x, y, width: w, height: h }
    },
    preprocessToBinary(imageData) {
      const { data, width, height } = imageData
      const hist = new Uint32Array(256)
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const gray = (r * 299 + g * 587 + b * 114) / 1000
        hist[gray | 0] += 1
      }
      // Otsu threshold
      const total = width * height
      let sum = 0
      for (let t = 0; t < 256; t++) sum += t * hist[t]
      let sumB = 0
      let wB = 0
      let maxVar = 0
      let threshold = 128
      for (let t = 0; t < 256; t++) {
        wB += hist[t]
        if (wB === 0) continue
        const wF = total - wB
        if (wF === 0) break
        sumB += t * hist[t]
        const mB = sumB / wB
        const mF = (sum - sumB) / wF
        const between = wB * wF * (mB - mF) * (mB - mF)
        if (between > maxVar) {
          maxVar = between
          threshold = t
        }
      }
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const gray = (r * 299 + g * 587 + b * 114) / 1000
        const v = gray < threshold ? 0 : 255
        data[i] = v
        data[i + 1] = v
        data[i + 2] = v
        data[i + 3] = 255
      }
      return imageData
    },
    drawRoiPreview() {
      const c = this.$refs.roiPreviewCanvas
      if (!c || !this._roiCanvas) return
      const ctx = c.getContext('2d')
      ctx.clearRect(0, 0, c.width, c.height)
      ctx.drawImage(this._roiCanvas, 0, 0, c.width, c.height)
    },
    async startCamera() {
      this.error = ''
      this.videoReady = false
      this.aligned = false
      this.alignedText = ''
      this.statusText = '初始化相机中…'

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        })

        this.stream = stream
        const video = this.$refs.video
        video.srcObject = stream
      } catch (e) {
        this.error = e && e.message ? e.message : String(e)
        this.statusText = '无法打开相机（请确认 HTTPS / 权限）'
      }
    },
    stopCamera() {
      if (this.stream) {
        for (const track of this.stream.getTracks()) track.stop()
      }
      this.stream = null
      this.videoReady = false
    },
    onLoadedMetadata() {
      const video = this.$refs.video
      if (!video) return
      video.play().catch(() => {})
      this.videoReady = true
      this.statusText = '未对准（请将二维码放到右上角 2×2 区域）'
      this.startLoop()
    },
    startLoop() {
      this.stopLoop()
      const tick = (ts) => {
        this._raf = requestAnimationFrame(tick)
        if (!this.videoReady) return
        if (ts - this._lastScanAt < SCAN_INTERVAL_MS) return
        this._lastScanAt = ts
        this.scanOnce()
      }
      this._raf = requestAnimationFrame(tick)
    },
    stopLoop() {
      if (this._raf) cancelAnimationFrame(this._raf)
      this._raf = 0
    },
    scanOnce() {
      const video = this.$refs.video
      if (!video || !video.videoWidth || !video.videoHeight) return
      if (!this._roiCtx) return
      this.computeRects()

      const displayW = this.containerSize.width
      const displayH = this.containerSize.height
      const videoW = video.videoWidth
      const videoH = video.videoHeight

      const roiAbsRect = this.getRoiAbsRectWithPadding()
      const roiVideoRect = mapDisplayRectToVideoRectCover({
        displayRect: roiAbsRect,
        displayWidth: displayW,
        displayHeight: displayH,
        videoWidth: videoW,
        videoHeight: videoH,
      })
      if (!roiVideoRect) return
      this._lastRoiVideoRect = roiVideoRect

      this._roiCtx.drawImage(
        video,
        roiVideoRect.x,
        roiVideoRect.y,
        roiVideoRect.width,
        roiVideoRect.height,
        0,
        0,
        ROI_CANVAS_SIZE,
        ROI_CANVAS_SIZE
      )
      this.drawRoiPreview()

      let imageData = this._roiCtx.getImageData(0, 0, ROI_CANVAS_SIZE, ROI_CANVAS_SIZE)
      let result = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      })
      if (!result) {
        imageData = this.preprocessToBinary(imageData)
        result = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        })
      }

      // === 锁定模式逻辑 ===
      // 如果已经在锁定模式中，不更新状态显示，只检查是否再次识别到相同内容
      if (this._lockMode) {
        if (result && result.data && String(result.data) === this._lockText) {
          this._confirmCount += 1
          // 如果确认次数达到2次，立即拍照（提前结束倒计时）
          if (this._confirmCount >= 2) {
            this.clearLockTimer()
            this.executeCapture()
          }
        }
        // 锁定模式下，无论是否识别到，都不更新状态文字
        return
      }

      // === 正常扫描逻辑 ===
      if (result && result.data) {
        const text = String(result.data)
        
        // 首次识别到二维码，立即进入锁定模式
        if (!this._lockMode) {
          this.enterLockMode(text)
        }
        return
      }

      // 未识别到二维码，显示未对准状态
      this._candidateText = ''
      this.statusText = '未对准（请将二维码放到右上角 2×2 区域）'
    },
    // 进入锁定模式
    enterLockMode(text) {
      if (this._lockMode) return
      
      this._lockMode = true
      this._lockText = text
      this._confirmCount = 0
      this.aligned = true
      this.alignedText = text
      this.statusText = '识别成功，拍照中…'
      
      // 启动倒计时，到时即拍照
      this._lockTimer = window.setTimeout(() => {
        this.executeCapture()
      }, LOCK_TIMEOUT_MS)
    },
    
    // 清除锁定计时器
    clearLockTimer() {
      if (this._lockTimer) {
        window.clearTimeout(this._lockTimer)
        this._lockTimer = null
      }
    },
    
    // 退出锁定模式（重置状态）
    exitLockMode() {
      this.clearLockTimer()
      this._lockMode = false
      this._lockText = ''
      this._confirmCount = 0
      this.aligned = false
      this.alignedText = ''
      this.autoCapturing = false
    },
    
    // 执行拍照
    executeCapture() {
      if (this.autoCapturing) return
      if (!this.videoReady) {
        this.exitLockMode()
        this.statusText = '相机未就绪，请重试'
        return
      }
      this.autoCapturing = true
      this.capture()
    },
    capture() {
      const video = this.$refs.video
      if (!video || !video.videoWidth || !video.videoHeight) return

      this.computeRects()
      const fullCanvas = document.createElement('canvas')
      fullCanvas.width = video.videoWidth
      fullCanvas.height = video.videoHeight
      const fullCtx = fullCanvas.getContext('2d')
      fullCtx.drawImage(video, 0, 0)

      const captureAbsRect = this.getCaptureAbsRectExpanded() || this.docRect
      const captureVideoRect = mapDisplayRectToVideoRectCover({
        displayRect: captureAbsRect,
        displayWidth: this.containerSize.width,
        displayHeight: this.containerSize.height,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      })
      if (!captureVideoRect) return

      const roiVideoRect =
        this._lastRoiVideoRect ||
        mapDisplayRectToVideoRectCover({
          displayRect: this.getRoiAbsRectWithPadding(),
          displayWidth: this.containerSize.width,
          displayHeight: this.containerSize.height,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        })

      const qrText = this.decodeFromFullCanvas(fullCtx, roiVideoRect) || this.alignedText

      const captureCanvas = document.createElement('canvas')
      captureCanvas.width = Math.max(1, Math.round(captureVideoRect.width))
      captureCanvas.height = Math.max(1, Math.round(captureVideoRect.height))
      const captureCtx = captureCanvas.getContext('2d')
      captureCtx.drawImage(
        video,
        captureVideoRect.x,
        captureVideoRect.y,
        captureVideoRect.width,
        captureVideoRect.height,
        0,
        0,
        captureCanvas.width,
        captureCanvas.height
      )

      captureCanvas.toBlob(
        (blob) => {
          if (!blob) {
            this.autoCapturing = false
            this.statusText = '拍照失败（请重试）'
            return
          }
          captureStore.clear()
          captureStore.photoUrl = URL.createObjectURL(blob)
          captureStore.qrText = qrText || ''
          this.$router.push('/result')
        },
        'image/jpeg',
        0.92
      )
    },
    decodeFromFullCanvas(fullCtx, roiVideoRect) {
      if (!roiVideoRect || !this._roiCtx) return ''

      this._roiCtx.clearRect(0, 0, ROI_CANVAS_SIZE, ROI_CANVAS_SIZE)
      const fullCanvas = fullCtx.canvas
      this._roiCtx.drawImage(
        fullCanvas,
        roiVideoRect.x,
        roiVideoRect.y,
        roiVideoRect.width,
        roiVideoRect.height,
        0,
        0,
        ROI_CANVAS_SIZE,
        ROI_CANVAS_SIZE
      )

      let imageData = this._roiCtx.getImageData(0, 0, ROI_CANVAS_SIZE, ROI_CANVAS_SIZE)
      let result = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      })
      if (!result) {
        imageData = this.preprocessToBinary(imageData)
        result = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        })
      }
      return result && result.data ? String(result.data) : ''
    },
    restart() {
      this.stopLoop()
      this.stopCamera()
      this.exitLockMode()
      this.startCamera()
    },
  },
}
</script>

<style scoped>
.page {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
}
.video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  z-index: 10;
}

/* Gradients for readability */
.topBar {
  padding: 40px 24px 20px;
  background: linear-gradient(180deg, rgba(0,0,0,0.4) 0%, transparent 100%);
  color: white;
  text-align: center;
  pointer-events: none;
}

.title {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-shadow: 0 2px 4px rgba(0,0,0,0.3);
}

.hint {
  margin-top: 8px;
  font-size: 14px;
  opacity: 0.9;
  font-weight: 400;
  text-shadow: 0 1px 2px rgba(0,0,0,0.3);
}

.status {
  margin-top: 16px;
  display: inline-flex;
  align-items: center;
  padding: 8px 16px;
  border-radius: 30px;
  font-size: 13px;
  font-weight: 500;
  background: rgba(255, 255, 255, 0.95);
  color: #1e293b;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.status.ok {
  background: #ffffff;
  color: #10b981;
}
.status.bad {
  background: #ffffff;
  color: #64748b;
}

.error {
  margin-top: 12px;
  font-size: 13px;
  color: #ef4444;
  background: rgba(255, 255, 255, 0.9);
  padding: 6px 12px;
  border-radius: 8px;
  display: inline-block;
}

/* Active scanning area */
.mask {
  position: absolute;
  inset: 0;
  pointer-events: none;
  /* 移除背景遮罩，因为 .roiFrame 的 box-shadow 已经提供了足够的视觉区分 */
}

.docFrame {
  position: absolute;
  border: 2px solid rgba(255,255,255,0.4);
  border-radius: 8px;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.3), 0 0 20px rgba(255,255,255,0.1);
}

.corner {
  position: absolute;
  width: 32px;
  height: 32px;
  border: 5px solid #ffffff;
  border-radius: 4px;
  box-shadow: 0 0 12px rgba(0,0,0,0.4), 0 0 4px rgba(255,255,255,0.6);
  animation: cornerPulse 2s infinite ease-in-out;
}

@keyframes cornerPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.corner.tl { top: -2px; left: -2px; border-right: 0; border-bottom: 0; border-top-left-radius: 12px; }
.corner.tr { top: -2px; right: -2px; border-left: 0; border-bottom: 0; border-top-right-radius: 12px; }
.corner.bl { bottom: -2px; left: -2px; border-right: 0; border-top: 0; border-bottom-left-radius: 12px; }
.corner.br { bottom: -2px; right: -2px; border-left: 0; border-top: 0; border-bottom-right-radius: 12px; }

.roiFrame {
  position: absolute;
  box-sizing: border-box;
  border: 3px solid rgba(59, 130, 246, 0.8);
  border-radius: 12px;
  background: rgba(59, 130, 246, 0.05);
  box-shadow: 
    0 0 0 2000px rgba(0,0,0,0.15),
    0 0 20px rgba(59, 130, 246, 0.4),
    inset 0 0 20px rgba(59, 130, 246, 0.1);
  overflow: hidden;
  animation: roiGlow 2s infinite ease-in-out;
}

@keyframes roiGlow {
  0%, 100% { 
    border-color: rgba(59, 130, 246, 0.8);
    box-shadow: 
      0 0 0 2000px rgba(0,0,0,0.15),
      0 0 20px rgba(59, 130, 246, 0.4),
      inset 0 0 20px rgba(59, 130, 246, 0.1);
  }
  50% { 
    border-color: rgba(59, 130, 246, 1);
    box-shadow: 
      0 0 0 2000px rgba(0,0,0,0.15),
      0 0 30px rgba(59, 130, 246, 0.6),
      inset 0 0 30px rgba(59, 130, 246, 0.15);
  }
}

.roiLabel {
  display: none; /* Minimalist: hide label */
}

/* Scan Line Animation */
.scan-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(to right, transparent, #60a5fa, #3b82f6, #60a5fa, transparent);
  box-shadow: 0 0 8px #3b82f6, 0 0 4px #60a5fa;
  animation: scan 2s infinite linear;
}

@keyframes scan {
  0% { top: 0; opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { top: 100%; opacity: 0; }
}


.roiPreview {
  position: absolute;
  left: 50%;
  bottom: 40px;
  transform: translateX(-50%);
  width: 140px;
  padding: 12px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.15);
  pointer-events: none;
  z-index: 20;
  animation: slideUp 0.4s ease-out;
}

@keyframes slideUp {
  from { 
    opacity: 0; 
    transform: translateX(-50%) translateY(20px); 
  }
  to { 
    opacity: 1; 
    transform: translateX(-50%) translateY(0); 
  }
}

.roiPreviewTitle {
  font-size: 11px;
  color: #64748b;
  text-align: center;
  margin-bottom: 8px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.preview-container {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: 12px;
  background: #000;
}

.roiPreviewCanvas {
  width: 100%;
  height: auto;
  border-radius: 12px;
  display: block;
}

/* 预览框内的扫描线动画 */
.preview-scan-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(to right, transparent, #10b981, transparent);
  box-shadow: 0 0 6px #10b981;
  animation: previewScan 2.5s infinite ease-in-out;
  pointer-events: none;
}

@keyframes previewScan {
  0% { top: 0; opacity: 0; }
  15% { opacity: 1; }
  85% { opacity: 1; }
  100% { top: 100%; opacity: 0; }
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
