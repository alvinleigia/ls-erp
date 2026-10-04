import { withBusinessApi } from "@/platform/business-api"
import { createAuditReportService } from "@/platform/audit/service"
import { prisma } from "@/lib/prisma"

export function GET(request: Request) {
 return withBusinessApi(request, actor => createAuditReportService(prisma, actor).list(Object.fromEntries(new URL(request.url).searchParams)))
}
