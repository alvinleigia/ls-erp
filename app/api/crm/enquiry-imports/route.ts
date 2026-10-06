import { withCrmApi, queryInput } from "@/application/crm/http"
import { CrmError } from "@/modules/crm/policy"
import { IMPORT_MAX_BYTES } from "@/modules/crm/import-types"

export const runtime = "nodejs"
export const maxDuration = 60
export async function GET(request: Request) {
  return withCrmApi(request, service => service.listEnquiryImports(queryInput(request)))
}
export async function POST(request: Request) {
  return withCrmApi(request, async service => {
    // Check import permission before accepting/parsing uploaded data.
    await service.listEnquiryImports({ pageSize: 1 })
    const reader = request.body?.getReader()
    if (!reader) throw new CrmError(400, "Choose a file.")
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > IMPORT_MAX_BYTES + 65536) { await reader.cancel(); throw new CrmError(400, "Choose a file up to 3 MB.") }
      chunks.push(value)
    }
    let form: FormData
    try { form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("Content-Type") || "" } }).formData() }
    catch { throw new CrmError(400, "Upload a CSV or XLSX file.") }
    const file = form.get("file")
    if (!(file instanceof File)) throw new CrmError(400, "Choose a file.")
    return service.uploadEnquiryImport(file.name, new Uint8Array(await file.arrayBuffer()))
  }, 201)
}
