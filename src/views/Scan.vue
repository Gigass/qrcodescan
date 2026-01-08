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
            <div class="roiLabel">二维码区域（2×2）</div>
          </div>
        </div>
      </div>

      <div class="roiPreview">
        <div class="roiPreviewTitle">右上角截取预览</div>
        <canvas ref="roiPreviewCanvas" class="roiPreviewCanvas" width="180" height="180"></canvas>
      </div>

      <div class="bottomBar">
        <button class="btn" :disabled="!videoReady" @click="capture">拍照</button>
        <button class="btn secondary" @click="restart">重启相机</button>
      </div>
    </div>
  </div>
</template>

<script>
import jsQR from 'jsqr'
import { captureStore } from '../state/captureStore'
import { mapDisplayRectToVideoRectCover } from '../utils/videoMapping'

const SCAN_INTERVAL_MS = 160
const ROI_CANVAS_SIZE = 960
const STABLE_FRAMES = 3
const LOST_FRAMES = 5

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
      _candidateCount: 0,
      _lostCount: 0,
      _lastRoiVideoRect: null,
      _roiCanvas: null,
      _roiCtx: null,
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
      const roiX = docW * (13 / 16)
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

      if (result && result.data) {
        const text = String(result.data)
        if (text === this._candidateText) this._candidateCount += 1
        else {
          this._candidateText = text
          this._candidateCount = 1
        }
        this._lostCount = 0

        if (this._candidateCount >= STABLE_FRAMES) {
          this.aligned = true
          this.alignedText = this._candidateText
          this.statusText = '已对准（自动拍照中…）'
          this.autoCaptureIfNeeded()
        } else {
          this.aligned = false
          this.alignedText = ''
          this.statusText = '识别中…（请保持稳定）'
        }
        return
      }

      this._candidateText = ''
      this._candidateCount = 0
      if (this.aligned) {
        this._lostCount += 1
        if (this._lostCount >= LOST_FRAMES) {
          this.aligned = false
          this.alignedText = ''
          this.statusText = '未对准（请将二维码放到右上角 2×2 区域）'
        }
        return
      }

      this.statusText = '未对准（请将二维码放到右上角 2×2 区域）'
    },
    autoCaptureIfNeeded() {
      if (this.autoCapturing) return
      this.autoCapturing = true
      // Small delay to reduce motion blur at the moment alignment is detected.
      window.setTimeout(() => {
        if (!this.videoReady || !this.aligned) {
          this.autoCapturing = false
          return
        }
        this.capture()
      }, 220)
    },
    capture() {
      const video = this.$refs.video
      if (!video || !video.videoWidth || !video.videoHeight) return

      const fullCanvas = document.createElement('canvas')
      fullCanvas.width = video.videoWidth
      fullCanvas.height = video.videoHeight
      const fullCtx = fullCanvas.getContext('2d')
      fullCtx.drawImage(video, 0, 0)

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

      fullCanvas.toBlob(
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
      this.autoCapturing = false
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
}
.topBar {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  padding: 14px 14px 10px;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.66), rgba(0, 0, 0, 0));
  pointer-events: auto;
}
.title {
  font-size: 18px;
  font-weight: 700;
}
.hint {
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.85;
  line-height: 1.4;
}
.status {
  margin-top: 10px;
  display: inline-block;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.18);
}
.status.ok {
  background: rgba(18, 184, 134, 0.18);
  border-color: rgba(18, 184, 134, 0.35);
}
.status.bad {
  background: rgba(255, 95, 86, 0.18);
  border-color: rgba(255, 95, 86, 0.35);
}
.error {
  margin-top: 8px;
  font-size: 12px;
  color: #ffb4ae;
  word-break: break-word;
}
.mask {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.docFrame {
  position: absolute;
  box-sizing: border-box;
}
.corner {
  position: absolute;
  width: 18px;
  height: 18px;
  border: 3px solid rgba(255, 255, 255, 0.9);
}
.corner.tl {
  top: -2px;
  left: -2px;
  border-right: 0;
  border-bottom: 0;
}
.corner.tr {
  top: -2px;
  right: -2px;
  border-left: 0;
  border-bottom: 0;
}
.corner.bl {
  bottom: -2px;
  left: -2px;
  border-right: 0;
  border-top: 0;
}
.corner.br {
  bottom: -2px;
  right: -2px;
  border-left: 0;
  border-top: 0;
}
.roiFrame {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.06);
}
.roiLabel {
  position: absolute;
  right: 6px;
  top: 6px;
  font-size: 11px;
  padding: 4px 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.16);
}
.bottomBar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 12px 14px 18px;
  display: flex;
  gap: 10px;
  justify-content: center;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.66), rgba(0, 0, 0, 0));
  pointer-events: auto;
}
.btn {
  min-width: 124px;
  height: 44px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}
.btn:disabled {
  opacity: 0.55;
}
.btn.secondary {
  background: rgba(255, 255, 255, 0.08);
}
.roiPreview {
  position: absolute;
  right: 12px;
  top: 92px;
  width: 200px;
  padding: 10px 10px 12px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.14);
  pointer-events: none;
}
.roiPreviewTitle {
  font-size: 12px;
  font-weight: 700;
}
.roiPreviewCanvas {
  margin-top: 8px;
  width: 180px;
  height: 180px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: #000;
  display: block;
}
</style>
