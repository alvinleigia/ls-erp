import { withCatalogApi } from "@/application/catalog/http"
import { readImportUpload } from "@/platform/imports/http"
export const runtime = "nodejs"
export const maxDuration = 60
export const GET = (request: Request) => withCatalogApi(request, service => service.listCatalogImports(Object.fromEntries(new URL(request.url).searchParams)))
export const POST = (request: Request) => withCatalogApi(request, async service => {
  await service.catalogImportOptions()
  const { file, form } = await readImportUpload(request)
  return service.uploadCatalogImport(String(form.get("profile") || ""), file.name, new Uint8Array(await file.arrayBuffer()))
}, 201)
