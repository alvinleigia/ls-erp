import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { requirePermission } from "@/platform/access/policy"
import { readBranding, requireBrandingAdmin, saveBranding } from "@/platform/branding/service"
import { brandingForm } from "@/platform/branding/request"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export function GET(request: Request) { return withBusinessApi(request, actor => { requirePermission(actor, "businessSettings.read"); return readBranding(prisma, actor) }) }
export function PATCH(request: Request) { return withBusinessApi(request, async actor => {
  requireBrandingAdmin(actor)
  const { input, file } = await brandingForm(request)
  return saveBranding(prisma, actor, input, file)
}) }
