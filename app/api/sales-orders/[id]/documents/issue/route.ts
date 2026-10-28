import { withOrderDocumentsApi } from "@/application/order-documents/http"
import { readJson } from "@/platform/business-api"
import { issuedDocumentSummary } from "@/modules/sales-orders/documents"
export const runtime="nodejs"
export const POST=(request:Request,context:{params:Promise<{id:string}>})=>withOrderDocumentsApi(request,async service=>issuedDocumentSummary(await service.issue((await context.params).id,await readJson(request))))
