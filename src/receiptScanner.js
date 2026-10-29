import { parseReceiptText } from './receiptText.js'

async function loadImage(blob) {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not prepare the receipt image.')), 'image/jpeg', .88)
  })
}

export async function detectReceiptEdges(blob) {
  const image = await loadImage(blob)
  const scale = Math.min(1, 600 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  const luminance = (index) => .2126 * data[index] + .7152 * data[index + 1] + .0722 * data[index + 2]
  const corners = [0, (canvas.width - 1) * 4, (canvas.height - 1) * canvas.width * 4, (canvas.width * canvas.height - 1) * 4]
  const background = corners.reduce((sum, index) => sum + luminance(index), 0) / corners.length
  const rows = new Uint32Array(canvas.height)
  const columns = new Uint32Array(canvas.width)
  for (let y = 0; y < canvas.height; y += 2) {
    for (let x = 0; x < canvas.width; x += 2) {
      if (Math.abs(luminance((y * canvas.width + x) * 4) - background) < 45) continue
      rows[y] += 1
      columns[x] += 1
    }
  }
  const firstAndLast = (counts, threshold) => {
    const indices = [...counts.keys()].filter((index) => counts[index] > threshold)
    return indices.length ? [indices[0], indices.at(-1)] : null
  }
  const horizontal = firstAndLast(columns, canvas.height * .035)
  const vertical = firstAndLast(rows, canvas.width * .035)
  if (!horizontal || !vertical) return null
  const [left, right] = horizontal
  const [top, bottom] = vertical
  if ((right - left) / canvas.width < .2 || (bottom - top) / canvas.height < .2) return null
  const padX = canvas.width * .025
  const padY = canvas.height * .025
  return {
    left: Math.max(0, Math.round((left - padX) / canvas.width * 100)),
    right: Math.min(100, Math.round((right + padX) / canvas.width * 100)),
    top: Math.max(0, Math.round((top - padY) / canvas.height * 100)),
    bottom: Math.min(100, Math.round((bottom + padY) / canvas.height * 100)),
  }
}

export async function prepareReceiptImage(blob, crop, rotation = 0, enhance = true) {
  const image = await loadImage(blob)
  const x = image.naturalWidth * crop.left / 100
  const y = image.naturalHeight * crop.top / 100
  const width = image.naturalWidth * (crop.right - crop.left) / 100
  const height = image.naturalHeight * (crop.bottom - crop.top) / 100
  const scale = Math.min(1, 1800 / Math.max(width, height))
  const croppedWidth = Math.max(1, Math.round(width * scale))
  const croppedHeight = Math.max(1, Math.round(height * scale))
  const turn = ((rotation % 360) + 360) % 360
  const canvas = document.createElement('canvas')
  canvas.width = turn % 180 ? croppedHeight : croppedWidth
  canvas.height = turn % 180 ? croppedWidth : croppedHeight
  const context = canvas.getContext('2d', { willReadFrequently: enhance })
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate(turn * Math.PI / 180)
  context.drawImage(image, x, y, width, height, -croppedWidth / 2, -croppedHeight / 2, croppedWidth, croppedHeight)
  if (enhance) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    for (let index = 0; index < pixels.data.length; index += 4) {
      const gray = .2126 * pixels.data[index] + .7152 * pixels.data[index + 1] + .0722 * pixels.data[index + 2]
      const contrast = Math.max(0, Math.min(255, (gray - 128) * 1.3 + 135))
      pixels.data[index] = contrast
      pixels.data[index + 1] = contrast
      pixels.data[index + 2] = contrast
    }
    context.putImageData(pixels, 0, 0)
  }
  return canvasBlob(canvas)
}

export async function readReceipt(blob, onProgress) {
  const { createWorker } = await import('tesseract.js')
  const root = `${import.meta.env.BASE_URL}ocr`
  const worker = await createWorker('eng', 1, {
    workerPath: `${root}/worker.min.js`,
    corePath: root,
    langPath: root,
    workerBlobURL: false,
    logger: (event) => onProgress?.(event.status),
  })
  try {
    const result = await worker.recognize(blob)
    return { ...parseReceiptText(result.data.text), text: result.data.text }
  } finally {
    await worker.terminate()
  }
}
