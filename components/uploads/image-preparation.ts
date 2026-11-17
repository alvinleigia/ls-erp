export type ImageRotation = 0 | 90 | 180 | 270
export type ImageCropArea = { x: number; y: number; width: number; height: number }
export const IMAGE_PIXEL_LIMIT = 20_000_000
const imageTypes = ["image/jpeg", "image/png"]

export function imageDimensions(bytes: Uint8Array, type: string) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0, height = 0
  if (type === "image/png" && bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) {
    width = data.getUint32(16); height = data.getUint32(20)
  } else if (type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    let i = 2
    while (i + 3 < bytes.length) {
      if (bytes[i++] !== 255) break
      while (bytes[i] === 255) i++
      const marker = bytes[i++]
      if (marker === 218 || marker === 217 || i + 2 > bytes.length) break
      if (marker === 1 || marker >= 208 && marker <= 215) continue
      const length = data.getUint16(i)
      if (length < 2 || i + length > bytes.length) break
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) {
        height = data.getUint16(i + 3); width = data.getUint16(i + 5); break
      }
      i += length
    }
  }
  checkDimensions(width, height)
  return { width, height }
}

function checkDimensions(width: number, height: number) {
  if (!width || !height) throw Error("Choose a valid JPEG or PNG image.")
  if (width > 16_384 || height > 16_384 || width * height > IMAGE_PIXEL_LIMIT) throw Error("This image is too large to crop. Choose an image up to 20 megapixels and 16,384 pixels per side.")
}

export async function loadCropImage(file: File, maxBytes: number) {
  const limit = maxBytes >= 1024 * 1024 ? `${maxBytes / 1024 / 1024} MB` : `${Math.ceil(maxBytes / 1024)} KB`
  if (!imageTypes.includes(file.type) || !file.size || file.size > maxBytes) throw Error(`Choose a JPEG or PNG up to ${limit} to crop.`)
  imageDimensions(new Uint8Array(await file.arrayBuffer()), file.type)
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }) }
  catch { throw Error("Unable to read this image. Choose a valid JPEG or PNG.") }
  try { checkDimensions(bitmap.width, bitmap.height); return bitmap } catch (error) { bitmap.close(); throw error }
}

export function rotatedDimensions(width: number, height: number, rotation: ImageRotation) {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height }
}

export function drawRotatedImage(canvas: HTMLCanvasElement, image: ImageBitmap, rotation: ImageRotation) {
  const size = rotatedDimensions(image.width, image.height, rotation)
  const scale = Math.min(1, 1600 / Math.max(size.width, size.height))
  canvas.width = Math.max(1, Math.round(size.width * scale)); canvas.height = Math.max(1, Math.round(size.height * scale))
  const context = canvas.getContext("2d")
  if (!context) throw Error("Image editing is unavailable in this browser. You can use the original file.")
  context.scale(canvas.width / size.width, canvas.height / size.height)
  context.translate(size.width / 2, size.height / 2)
  context.rotate(rotation * Math.PI / 180)
  context.drawImage(image, -image.width / 2, -image.height / 2)
}

export function cropPixels(area: ImageCropArea, width: number, height: number) {
  if (![area.x, area.y, area.width, area.height].every(Number.isFinite) || area.x < 0 || area.y < 0 || area.width <= 0 || area.height <= 0 || area.x + area.width > 100.000001 || area.y + area.height > 100.000001) throw Error("Select a crop inside the image.")
  const x = Math.floor(area.x * width / 100), y = Math.floor(area.y * height / 100)
  const right = Math.min(width, Math.ceil((area.x + area.width) * width / 100)), bottom = Math.min(height, Math.ceil((area.y + area.height) * height / 100))
  if (right <= x || bottom <= y) throw Error("Select a larger crop area.")
  return { x, y, width: right - x, height: bottom - y }
}

export async function croppedImageFile(file: File, image: ImageBitmap, area: ImageCropArea, rotation: ImageRotation, maxBytes: number) {
  const size = rotatedDimensions(image.width, image.height, rotation), crop = cropPixels(area, size.width, size.height)
  if (!rotation && crop.x === 0 && crop.y === 0 && crop.width === size.width && crop.height === size.height) return file
  const output = document.createElement("canvas")
  output.width = crop.width; output.height = crop.height
  try {
    const context = output.getContext("2d")
    if (!context) throw Error("Image editing is unavailable in this browser.")
    context.translate(size.width / 2 - crop.x, size.height / 2 - crop.y)
    context.rotate(rotation * Math.PI / 180)
    context.drawImage(image, -image.width / 2, -image.height / 2)
    const blob = await new Promise<Blob>((resolve, reject) => output.toBlob(value => value ? resolve(value) : reject(Error("Unable to prepare this image. Try a smaller crop.")), file.type, 0.95))
    if (blob.type !== file.type || !blob.size || blob.size > maxBytes) throw Error("The prepared image exceeds the upload limit. Choose a smaller crop or use the original.")
    const base = file.name.replace(/\.[^.]+$/, "").replace(/-cropped$/, "").replace(/[\x00-\x1f\x7f/\\"]/g, "_").trim() || "image"
    const name = base.slice(0, 108) + (file.type === "image/png" ? "-cropped.png" : "-cropped.jpg")
    return new File([blob], name, { type: blob.type })
  } finally { output.width = 0; output.height = 0 }
}
