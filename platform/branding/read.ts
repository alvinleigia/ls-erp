import type { Prisma } from "@prisma/client"
import type { DocumentBranding, TenantBranding } from "./types"
export async function readDocumentBranding(tx: Prisma.TransactionClient, tenantId: string): Promise<DocumentBranding> {
  const [settings, tenant] = await Promise.all([
    tx.appSetting.findUnique({ where: { tenantId }, select: { branding: true } }),
    tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } }),
  ])
  const branding = (settings?.branding || {}) as TenantBranding
  return { name: branding.name || tenant.name, logo: branding.logo?.document || null }
}
