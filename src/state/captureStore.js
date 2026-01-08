export const captureStore = {
  photoUrl: '',
  qrText: '',
  clear() {
    if (this.photoUrl) URL.revokeObjectURL(this.photoUrl)
    this.photoUrl = ''
    this.qrText = ''
  },
}

