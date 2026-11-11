import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { applicationVerificationEvidence } from "@/application/verification/service"
export const GET = (request: Request) => withBusinessApi(request, actor => applicationVerificationEvidence(prisma, actor).view(Object.fromEntries(new URL(request.url).searchParams)))
