import sharp from "sharp"
import { BusinessError } from "../policy"
import { LOGO_STORED_LIMIT, LOGO_UPLOAD_LIMIT } from "./types"

export async function optimizeLogo(input: Buffer) {
  if (!input.length || input.length > LOGO_UPLOAD_LIMIT) throw new BusinessError(400, "Choose an image up to 2 MB.")
  try {
    const options = { limitInputPixels: 20_000_000, failOn: "warning" as const }
    const metadata = await sharp(input, options).metadata()
    if (!["png", "jpeg", "webp"].includes(metadata.format || "") || (metadata.pages || 1) !== 1) throw new BusinessError(400, "Use a still PNG, JPEG or WebP image.")
    // Keep document resolution; reduce palette precision before reducing dimensions.
    let document: Awaited<ReturnType<typeof encode>> | undefined
    async function encode(width: number, colours?: number) {
      return sharp(input, options).rotate().resize({ width, height: width, fit: "inside", withoutEnlargement: true })
        .png(colours ? { palette: true, colours, dither: 0 } : { compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
    }
    for (const width of [1200, 1000, 800, 600]) {
      for (const colours of [undefined, 256, 128]) {
        const result = await encode(width, colours)
        if (result.data.length <= LOGO_STORED_LIMIT) { document = result; break }
      }
      if (document) break
    }
    if (!document) throw new BusinessError(400, "This image cannot fit within 512 KB. Try a simpler logo.")
    const sidebar = await sharp(document.data).resize({ width: 300, height: 160, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true })
    if (sidebar.data.length > LOGO_STORED_LIMIT) throw new BusinessError(400, "Unable to optimize the sidebar logo.")
    return { document, sidebar, warning: document.info.width < 600 ? "This logo is under 600 pixels wide and may look soft when printed at 5 cm. A larger original is recommended." : null }
  } catch (error) {
    if (error instanceof BusinessError) throw error
    throw new BusinessError(400, "Unable to read this image. Choose a valid PNG, JPEG or WebP file.")
  }
}
