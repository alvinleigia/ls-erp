import { storageClient as client, storageConfiguration as configuration } from "../storage/client"
import { BusinessError } from "../policy"
import { LOGO_STORED_LIMIT } from "./types"

export const BRANDING_BUCKET = "tenant-branding"
export function storageReady() { try { configuration(); return true } catch { return false } }
function validPath(path: string) {
  if (!/^[a-zA-Z0-9_-]+\/[a-f0-9-]{36}\/(document\.png|sidebar\.webp)$/.test(path)) throw new Error("Invalid branding asset path")
  return path
}
export function logoUrl(path: string) { return `${configuration().url}/storage/v1/object/public/${BRANDING_BUCKET}/${validPath(path)}` }
export async function uploadLogo(path: string, bytes: Buffer, contentType: string) {
  if (bytes.length > LOGO_STORED_LIMIT) throw new Error("Optimized logo exceeds storage limit")
  const { error } = await client().storage.from(BRANDING_BUCKET).upload(validPath(path), bytes, { contentType, cacheControl: "31536000", upsert: false })
  if (error) throw new BusinessError(503, "Unable to store the logo. Check the branding bucket configuration and try again.")
}
export async function removeUncommittedLogos(paths: string[]) {
  if (!paths.length) return
  const { error } = await client().storage.from(BRANDING_BUCKET).remove(paths.map(validPath))
  if (error) throw new Error("Unable to clean up uncommitted branding assets")
}
export async function downloadDocumentLogo(path: string) {
  if (!path.endsWith("/document.png")) throw new Error("Invalid document logo")
  const { data, error } = await client().storage.from(BRANDING_BUCKET).download(validPath(path))
  if (error || !data) throw new BusinessError(503, "The saved document logo is unavailable. Please try again later.")
  if (data.size > LOGO_STORED_LIMIT) throw new Error("Document logo exceeds storage limit")
  return Buffer.from(await data.arrayBuffer())
}
