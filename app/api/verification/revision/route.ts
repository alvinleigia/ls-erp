import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { applicationVerificationSubmissions } from "@/application/verification/service"
export const GET = (request: Request) => withBusinessApi(request, actor => applicationVerificationSubmissions(prisma, actor).revision(Object.fromEntries(new URL(request.url).searchParams)))
