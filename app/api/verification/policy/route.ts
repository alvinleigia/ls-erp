import { prisma } from "@/lib/prisma"
import { readJson, withBusinessApi } from "@/platform/business-api"
import { createVerificationConfigurationService } from "@/platform/verification/configuration"
export const GET = (request: Request) => withBusinessApi(request, actor => createVerificationConfigurationService(prisma, actor).get())
export const PUT = (request: Request) => withBusinessApi(request, async actor => createVerificationConfigurationService(prisma, actor).publish(await readJson(request)))
