import { prisma } from "@/lib/prisma"
import { readJson, withBusinessApi } from "@/platform/business-api"
import { applicationVerificationSubmissions } from "@/application/verification/service"
export const POST = (request: Request) => withBusinessApi(request, async actor => applicationVerificationSubmissions(prisma, actor).review(await readJson(request)))
