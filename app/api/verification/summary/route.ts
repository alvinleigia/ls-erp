import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { applicationVerificationSummary } from "@/application/verification/service"
export const GET = (request: Request) => withBusinessApi(request, actor => applicationVerificationSummary(prisma, actor).get(Object.fromEntries(new URL(request.url).searchParams)))
