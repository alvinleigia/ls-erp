import { withCatalogApi } from "@/application/catalog/http"
export const GET = (request: Request) => withCatalogApi(request, service => service.catalogImportOptions())
