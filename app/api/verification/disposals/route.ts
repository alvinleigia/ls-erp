import { prisma } from "@/lib/prisma"
import { readJson, withBusinessApi } from "@/platform/business-api"
import { applicationVerificationDisposal } from "@/application/verification/service"
export const POST = (r: Request) => withBusinessApi(r, async actor => applicationVerificationDisposal(prisma, actor).request(await readJson(r)))
export const PATCH = (r: Request) => withBusinessApi(r, async actor => applicationVerificationDisposal(prisma, actor).act(await readJson(r)))
