function clamp(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value))
}

// Maps a rectangle in "display pixels" (relative to the video element box)
// into a rectangle in "video pixels", assuming the video is rendered with object-fit: cover.
export function mapDisplayRectToVideoRectCover({
  displayRect,
  displayWidth,
  displayHeight,
  videoWidth,
  videoHeight,
}) {
  if (videoWidth <= 0 || videoHeight <= 0 || displayWidth <= 0 || displayHeight <= 0) return null

  const scale = Math.max(displayWidth / videoWidth, displayHeight / videoHeight)
  const scaledWidth = videoWidth * scale
  const scaledHeight = videoHeight * scale

  const offsetX = (scaledWidth - displayWidth) / 2
  const offsetY = (scaledHeight - displayHeight) / 2

  const srcX = (displayRect.x + offsetX) / scale
  const srcY = (displayRect.y + offsetY) / scale
  const srcW = displayRect.width / scale
  const srcH = displayRect.height / scale

  const x = clamp(srcX, 0, videoWidth)
  const y = clamp(srcY, 0, videoHeight)
  const w = clamp(srcW, 0, videoWidth - x)
  const h = clamp(srcH, 0, videoHeight - y)

  if (w <= 0 || h <= 0) return null
  return { x, y, width: w, height: h }
}

