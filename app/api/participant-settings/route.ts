import { prisma } from "@/lib/prisma"
import { withBusinessApi, readJson } from "@/platform/business-api"
import { applicationParticipantSettings } from "@/application/participants/configuration"
export const GET = (request: Request) => withBusinessApi(request, actor => applicationParticipantSettings(prisma, actor).get())
export const PUT = (request: Request) => withBusinessApi(request, async actor => applicationParticipantSettings(prisma, actor).publish(await readJson(request)))
