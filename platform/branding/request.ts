import { BusinessError } from "../policy"
import { LOGO_UPLOAD_LIMIT } from "./types"
export async function brandingForm(request: Request) {
  const origin = request.headers.get("origin")
  // Next's internal URL can use the listening host. Match the same forwarded
  // tenant host used by authentication, including local development ports.
  const url = new URL(request.url)
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host
  const protocol = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "")
  if (origin && origin !== `${protocol}://${host}`) throw new BusinessError(403, "Cross-origin uploads are not permitted.")
  const limit = LOGO_UPLOAD_LIMIT + 16384
  if (Number(request.headers.get("content-length")) > limit) throw new BusinessError(413, "Choose an image up to 2 MB.")
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []
  let size = 0
  if (!reader) throw new BusinessError(400, "Upload form is missing.")
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > limit) { await reader.cancel(); throw new BusinessError(413, "Choose an image up to 2 MB.") }
    chunks.push(value)
  }
  let form: FormData
  try { form = await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type") || "" } }).formData() }
  catch { throw new BusinessError(400, "Use a valid upload form.") }
  const file = form.get("logo")
  if (file !== null && !(file instanceof File)) throw new BusinessError(400, "Choose a valid image file.")
  if (file && file.size > LOGO_UPLOAD_LIMIT) throw new BusinessError(413, "Choose an image up to 2 MB.")
  return { input: { name: form.get("name") ?? "", version: form.get("version"), removeLogo: form.get("removeLogo") ?? "false" }, file: file ? Buffer.from(await file.arrayBuffer()) : undefined }
}
