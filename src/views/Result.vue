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
  min-height: 100%;
  padding: 14px 14px 24px;
  box-sizing: border-box;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title {
  font-size: 18px;
  font-weight: 700;
}
.content {
  margin-top: 12px;
  display: grid;
  gap: 12px;
}
.card {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  padding: 12px;
}
.label {
  font-size: 12px;
  opacity: 0.8;
}
.value {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.45;
  word-break: break-word;
}
.value.muted {
  opacity: 0.75;
}
.row {
  margin-top: 12px;
  display: flex;
  gap: 10px;
}
.btn {
  height: 40px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font: inherit;
}
.btn.secondary {
  background: rgba(255, 255, 255, 0.08);
}
.btn:disabled {
  opacity: 0.55;
}
.link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
}
.img {
  margin-top: 10px;
  width: 100%;
  height: auto;
  border-radius: 12px;
  display: block;
  background: #000;
}
</style>
