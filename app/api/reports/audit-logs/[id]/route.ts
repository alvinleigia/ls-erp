import { withBusinessApi } from "@/platform/business-api"
import { createAuditReportService } from "@/platform/audit/service"
import { prisma } from "@/lib/prisma"

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
 const { id } = await context.params
 return withBusinessApi(request, actor => createAuditReportService(prisma, actor).get(id))
}
