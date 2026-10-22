import { withCrmApi } from "@/application/crm/http"
export const dynamic = "force-dynamic"
export const GET = (request: Request, context: { params: Promise<{ id: string }> }) => withCrmApi(request, async service => service.getCollectionContext((await context.params).id))
