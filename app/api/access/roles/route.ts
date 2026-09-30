import { prisma } from "@/lib/prisma"
import { withBusinessApi, readJson } from "@/platform/business-api"
import { createAccessRoleService } from "@/platform/access/service"
export const GET = (request: Request) => withBusinessApi(request, actor => createAccessRoleService(prisma, actor).list(Object.fromEntries(new URL(request.url).searchParams)))
export const POST = (request: Request) => withBusinessApi(request, async actor => createAccessRoleService(prisma, actor).save(await readJson(request)), 201)
