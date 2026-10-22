import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { BusinessError } from "@/platform/policy"
import { applicationReceivables } from "./service"
export const withReceivablesApi = (request: Request, handler: (service: ReturnType<typeof applicationReceivables>) => Promise<unknown>) => withBusinessApi(request, actor => {
  if (!["GET", "HEAD"].includes(request.method)) {
    const url = new URL(request.url), origin = request.headers.get("origin")
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host
    const protocol = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "")
    if (origin && origin !== `${protocol}://${host}`) throw new BusinessError(403, "Cross-origin payment changes are not permitted.")
  }
  return handler(applicationReceivables(prisma, actor))
})
