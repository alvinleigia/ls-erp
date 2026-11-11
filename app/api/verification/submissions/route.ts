import { prisma } from "@/lib/prisma"
import { readJson, withBusinessApi } from "@/platform/business-api"
import { applicationVerificationSubmissions } from "@/application/verification/service"
export const GET = (request: Request) => withBusinessApi(request, actor => applicationVerificationSubmissions(prisma, actor).view(Object.fromEntries(new URL(request.url).searchParams)))
export const POST = (request: Request) => withBusinessApi(request, async actor => applicationVerificationSubmissions(prisma, actor).submit(await readJson(request)))
