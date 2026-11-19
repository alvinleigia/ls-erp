import { BusinessError } from "@/platform/policy"
import { IMPORT_MAX_BYTES } from "./types"
// Bound multipart bytes before formData allocates the upload.
export async function readImportUpload(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) throw new BusinessError(400, "Choose a file.")
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > IMPORT_MAX_BYTES + 65536) { await reader.cancel(); throw new BusinessError(400, "Choose a file up to 3 MB.") }
    chunks.push(value)
  }
  let form: FormData
  try { form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("Content-Type") || "" } }).formData() }
  catch { throw new BusinessError(400, "Upload a CSV or XLSX file.") }
  const file = form.get("file")
  if (!(file instanceof File)) throw new BusinessError(400, "Choose a file.")
  if (!file.size || file.size > IMPORT_MAX_BYTES) throw new BusinessError(400, "Choose a non-empty file up to 3 MB.")
  return { file, form }
}
