import { prisma } from "@/lib/prisma"
import { readJson, withBusinessApi } from "@/platform/business-api"
import { applicationVerificationEvidence } from "@/application/verification/service"
export const POST = (request: Request) => withBusinessApi(request, async actor => applicationVerificationEvidence(prisma, actor).reserve(await readJson(request)))
