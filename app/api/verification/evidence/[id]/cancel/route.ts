import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { applicationVerificationEvidence } from "@/application/verification/service"
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) => withBusinessApi(request, async actor => applicationVerificationEvidence(prisma, actor).cancel((await context.params).id))
