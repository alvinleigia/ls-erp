import { withOrderDocumentsApi } from "@/application/order-documents/http"
import { documentPageSchema } from "@/platform/documents/validation"
export const GET=(request:Request,context:{params:Promise<{id:string}>})=>withOrderDocumentsApi(request,async service=>service.list((await context.params).id,documentPageSchema.parse(Object.fromEntries(new URL(request.url).searchParams)).page))
