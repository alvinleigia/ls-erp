import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { applicationVerificationEvidence } from "@/application/verification/service"
export const POST = (request: Request) => withBusinessApi(request, actor => applicationVerificationEvidence(prisma, actor).cleanup())
