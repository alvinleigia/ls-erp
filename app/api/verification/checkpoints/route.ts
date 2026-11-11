import { prisma } from "@/lib/prisma"
import { readJson, withBusinessApi } from "@/platform/business-api"
import { createVerificationCheckpointSettings } from "@/platform/verification/checkpoint-settings"
export const GET = (request: Request) => withBusinessApi(request, actor => createVerificationCheckpointSettings(prisma, actor).get())
export const PUT = (request: Request) => withBusinessApi(request, async actor => createVerificationCheckpointSettings(prisma, actor).publish(await readJson(request)))
