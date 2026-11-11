import { prisma } from "@/lib/prisma"
import { readJson, withBusinessApi } from "@/platform/business-api"
import { applicationVerificationRetention } from "@/application/verification/service"
export const GET = (r: Request) => withBusinessApi(r, actor => applicationVerificationRetention(prisma, actor).view(Object.fromEntries(new URL(r.url).searchParams)))
export const POST = (r: Request) => withBusinessApi(r, async actor => applicationVerificationRetention(prisma, actor).hold(await readJson(r)))
