import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { applicationVerificationEvidence } from "@/application/verification/service"
export const runtime = "nodejs"
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) => withBusinessApi(request, async actor => applicationVerificationEvidence(prisma, actor).finalize((await context.params).id))
