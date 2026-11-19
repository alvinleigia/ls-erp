import { withRealEstateApi } from "@/modules/real-estate/http"
import { readJson } from "@/platform/business-api"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ id: string; phaseId: string }> }
export function PATCH(request: Request, context: Context) { return withRealEstateApi(request, async service => { const { id, phaseId } = await context.params; return service.saveLaunchPhase(id, await readJson(request), phaseId) }) }
