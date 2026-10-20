import { z } from "zod"
import { withCrmApi } from "@/application/crm/http"
import { readJson } from "@/platform/business-api"
import { BusinessError } from "@/platform/policy"

export const runtime = "nodejs"
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) => withCrmApi(request, async service => {
  const url = new URL(request.url), origin = request.headers.get("origin")
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host
  const protocol = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "")
  if (origin && origin !== `${protocol}://${host}`) throw new BusinessError(403, "Cross-origin issuance is not permitted.")
  const { revision } = z.object({ revision: z.number().int().positive() }).strict().parse(await readJson(request))
  const archive = await service.issueQuotation((await context.params).id, revision)
  return { issuedAt: archive.issuedAt, bytes: archive.bytes, sha256: archive.sha256 }
})
