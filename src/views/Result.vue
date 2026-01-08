<template>
  <div class="page">
    <div class="header">
      <div class="title">识别结果</div>
      <div class="actions">
        <button class="btn secondary" @click="goBack">重拍</button>
      </div>
    </div>

    <div class="content" v-if="photoUrl">
      <div class="card">
        <div class="label">二维码内容</div>
        <div class="value" v-if="qrText">{{ qrText }}</div>
        <div class="value muted" v-else>未识别到二维码（可重拍或调整对准）</div>
        <div class="row">
          <button class="btn" :disabled="!qrText" @click="copy">复制</button>
          <a class="btn secondary link" :href="photoUrl" download="document.jpg">下载原图</a>
        </div>
      </div>

      <div class="card">
        <div class="label">原图（取景框截图）</div>
        <img class="img" :src="photoUrl" alt="document" />
      </div>
    </div>
  </div>
</template>

<script>
import { captureStore } from '../state/captureStore'

export default {
  name: 'Result',
  data() {
    return {
      photoUrl: '',
      qrText: '',
      copyState: '',
    }
  },
  mounted() {
    this.photoUrl = captureStore.photoUrl
    this.qrText = captureStore.qrText
    if (!this.photoUrl) this.$router.replace('/scan')
  },
  methods: {
    goBack() {
      this.$router.push('/scan')
    },
    async copy() {
      try {
        await navigator.clipboard.writeText(this.qrText)
      } catch (e) {
        const input = document.createElement('textarea')
        input.value = this.qrText
        document.body.appendChild(input)
        input.select()
        document.execCommand('copy')
        document.body.removeChild(input)
      }
    },
  },
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 20px 20px 40px;
  box-sizing: border-box;
  background: #f8fafc;
  color: #1e293b;
  animation: fadeIn 0.4s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.title {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.5px;
  color: #0f172a;
}

.content {
  display: grid;
  gap: 20px;
  max-width: 600px;
  margin: 0 auto;
}

.card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.02);
  border: 1px solid #f1f5f9;
  transition: transform 0.2s;
}

.card:hover {
  transform: translateY(-2px);
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.value {
  font-size: 16px;
  line-height: 1.6;
  color: #334155;
  word-break: break-all;
  font-family: 'SF Mono', 'Roboto Mono', monospace; /* Monospace for QR data */
  padding: 12px;
  background: #f8fafc;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
}

.value.muted {
  color: #94a3b8;
  font-style: italic;
  font-family: inherit;
}

.row {
  margin-top: 20px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.btn {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  font-size: 15px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
  background: #0f172a;
  color: #ffffff;
  box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.1);
}

.btn:active {
  transform: scale(0.96);
}

.btn.secondary {
  background: #ffffff;
  color: #475569;
  border: 1px solid #e2e8f0;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}

.btn.secondary:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: #cbd5e1;
}

.link {
  text-decoration: none;
}

.img {
  width: 100%;
  height: auto;
  border-radius: 12px;
  display: block;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
}
</style>
