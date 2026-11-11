import { prisma } from "@/lib/prisma"
import { readJson, withBusinessApi } from "@/platform/business-api"
import { createVerificationCheckpointSettings } from "@/platform/verification/checkpoint-settings"
export const POST = (request: Request) => withBusinessApi(request, async actor => createVerificationCheckpointSettings(prisma, actor).preview(await readJson(request)))
