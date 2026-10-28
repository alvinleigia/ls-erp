import { prisma } from "@/lib/prisma"
import { withBusinessApi, readJson } from "@/platform/business-api"
import { applicationParticipantSettings } from "@/application/participants/configuration"
export const POST = (request: Request) => withBusinessApi(request, async actor => applicationParticipantSettings(prisma, actor).preview(await readJson(request)))
