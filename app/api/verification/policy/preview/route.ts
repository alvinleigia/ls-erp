import { prisma } from "@/lib/prisma"
import { readJson, withBusinessApi } from "@/platform/business-api"
import { createVerificationConfigurationService } from "@/platform/verification/configuration"
export const POST = (request: Request) => withBusinessApi(request, async actor => createVerificationConfigurationService(prisma, actor).preview(await readJson(request)))
