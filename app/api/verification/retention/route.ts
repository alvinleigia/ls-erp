import { prisma } from "@/lib/prisma"
import { readJson, withBusinessApi } from "@/platform/business-api"
import { applicationVerificationRetention } from "@/application/verification/service"
export const GET = (r: Request) => withBusinessApi(r, actor => applicationVerificationRetention(prisma, actor).settings())
export const PUT = (r: Request) => withBusinessApi(r, async actor => applicationVerificationRetention(prisma, actor).publish(await readJson(r)))
