import { prisma } from "@/lib/prisma"
import { withBusinessApi, readJson } from "@/platform/business-api"
import { createAccessRoleService } from "@/platform/access/service"
type Context = { params: Promise<{ id: string }> }
export const GET = (request: Request, context: Context) => withBusinessApi(request, async actor => createAccessRoleService(prisma, actor).get((await context.params).id))
export const PATCH = (request: Request, context: Context) => withBusinessApi(request, async actor => createAccessRoleService(prisma, actor).save(await readJson(request), (await context.params).id))
