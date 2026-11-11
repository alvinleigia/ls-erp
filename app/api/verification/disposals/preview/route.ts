import { prisma } from "@/lib/prisma"
import { readJson, withBusinessApi } from "@/platform/business-api"
import { applicationVerificationDisposal } from "@/application/verification/service"
export const POST = (r: Request) => withBusinessApi(r, async actor => applicationVerificationDisposal(prisma, actor).preview(await readJson(r)))
