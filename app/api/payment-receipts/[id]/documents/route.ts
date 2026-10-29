import { withPaymentDocumentsApi } from "@/application/payment-documents/http"
import { documentPageSchema } from "@/platform/documents/validation"
export const GET=(request:Request,context:{params:Promise<{id:string}>})=>withPaymentDocumentsApi(request,async service=>service.list((await context.params).id,documentPageSchema.parse(Object.fromEntries(new URL(request.url).searchParams)).page))
