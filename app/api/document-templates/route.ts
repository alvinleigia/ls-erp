import { withDocumentTemplatesApi } from "@/application/order-documents/http"
import { readJson } from "@/platform/business-api"
import { z } from "zod"
export const GET=(request:Request)=>withDocumentTemplatesApi(request,service=>{const q=z.object({companyId:z.string().min(1).max(100),providerKey:z.string().min(1).max(72)}).strict().parse(Object.fromEntries(new URL(request.url).searchParams));return service.get(q.companyId,q.providerKey)})
export const PUT=(request:Request)=>withDocumentTemplatesApi(request,async service=>service.publish(await readJson(request)))
