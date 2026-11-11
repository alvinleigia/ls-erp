import { prisma } from "@/lib/prisma"
import { readJson, withBusinessApi } from "@/platform/business-api"
import { applicationVerificationRetention } from "@/application/verification/service"
export const POST = (r: Request) => withBusinessApi(r, async actor => applicationVerificationRetention(prisma, actor).preview(await readJson(r)))
