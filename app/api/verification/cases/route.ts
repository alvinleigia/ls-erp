import { prisma } from "@/lib/prisma"
import { readJson, withBusinessApi } from "@/platform/business-api"
import { applicationVerificationCases } from "@/application/verification/service"
export const GET = (request: Request) => withBusinessApi(request, actor => applicationVerificationCases(prisma, actor).get(Object.fromEntries(new URL(request.url).searchParams)))
export const POST = (request: Request) => withBusinessApi(request, async actor => applicationVerificationCases(prisma, actor).start(await readJson(request)))
