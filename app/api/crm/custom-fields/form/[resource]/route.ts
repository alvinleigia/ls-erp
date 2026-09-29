import { withCustomFieldApi } from "@/application/crm/custom-fields"
export const dynamic = "force-dynamic"
export function GET(request: Request, context: { params: Promise<{ resource: string }> }) { return withCustomFieldApi(request, async service => service.form((await context.params).resource, new URL(request.url).searchParams.get("salesTeamId"))) }
