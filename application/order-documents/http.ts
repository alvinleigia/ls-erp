import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { BusinessError } from "@/platform/policy"
import { applicationOrderDocuments,applicationDocumentTemplates } from "./service"
function origin(request:Request){if(["GET","HEAD"].includes(request.method))return;const url=new URL(request.url),host=request.headers.get("x-forwarded-host")||request.headers.get("host")||url.host,protocol=request.headers.get("x-forwarded-proto")||url.protocol.replace(":","");if(request.headers.get("origin")&&request.headers.get("origin")!==`${protocol}://${host}`)throw new BusinessError(403,"Cross-origin document changes are not permitted.")}
export const withOrderDocumentsApi=(request:Request,handler:(service:ReturnType<typeof applicationOrderDocuments>)=>Promise<unknown>)=>withBusinessApi(request,actor=>{origin(request);return handler(applicationOrderDocuments(prisma,actor))})
export const withDocumentTemplatesApi=(request:Request,handler:(service:ReturnType<typeof applicationDocumentTemplates>)=>Promise<unknown>)=>withBusinessApi(request,actor=>{origin(request);return handler(applicationDocumentTemplates(prisma,actor))})
