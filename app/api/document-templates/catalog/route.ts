import { withDocumentTemplatesApi } from "@/application/order-documents/http"
export const GET=(request:Request)=>withDocumentTemplatesApi(request,service=>service.catalog(Object.fromEntries(new URL(request.url).searchParams)))
