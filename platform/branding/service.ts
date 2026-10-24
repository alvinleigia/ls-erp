import { randomUUID } from "node:crypto"
import type { Prisma, PrismaClient } from "@prisma/client"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { brandingUpdateSchema } from "@/lib/validation"
import { accessContext, findAccessUser } from "../access/server"
import { requirePermission, permits } from "../access/policy"
import { BusinessError, type BusinessActor } from "../policy"
import { optimizeLogo } from "./images"
import { logoUrl, storageReady, uploadLogo, removeUncommittedLogos } from "./storage"
import type { BrandingState, TenantBranding } from "./types"

export function requireBrandingAdmin(actor: BusinessActor) {
  if (actor.role !== "ADMIN") throw new BusinessError(403, "Only a tenant administrator can change branding.")
  requirePermission(actor, "businessSettings.edit")
}
export async function readBranding(db: Prisma.TransactionClient, actor: BusinessActor): Promise<BrandingState> {
  const [settings, tenant] = await Promise.all([
    db.appSetting.findUniqueOrThrow({ where: { tenantId: actor.tenantId }, select: { branding: true, brandingVersion: true } }),
    db.tenant.findUniqueOrThrow({ where: { id: actor.tenantId }, select: { name: true } }),
  ])
  const branding = settings.branding as TenantBranding
  return { branding, version: settings.brandingVersion, defaultName: tenant.name, canManage: actor.role === "ADMIN" && permits(actor, "businessSettings.edit"),
    logoUrl: branding.logo && storageReady() ? logoUrl(branding.logo.document.path) : null, storageReady: storageReady() }
}
export async function saveBranding(db: PrismaClient, actor: BusinessActor, input: unknown, file?: Buffer) {
  requireBrandingAdmin(actor)
  const data = brandingUpdateSchema.parse(input)
  if (file && data.removeLogo === "true") throw new BusinessError(400, "Choose either a new logo or remove the current logo.")
  const optimized = file ? await optimizeLogo(file) : null
  const paths: string[] = []
  let logo: TenantBranding["logo"]
  try {
    if (optimized) {
      const prefix = `${actor.tenantId}/${randomUUID()}`
      for (const key of ["document", "sidebar"] as const) {
        const path = `${prefix}/${key === "document" ? "document.png" : "sidebar.webp"}`
        const image = optimized[key]
        await uploadLogo(path, image.data, key === "document" ? "image/png" : "image/webp")
        paths.push(path)
      }
      const asset = (key: "document" | "sidebar", path: string) => ({ path, width: optimized[key].info.width, height: optimized[key].info.height, bytes: optimized[key].data.length })
      logo = { document: asset("document", paths[0]), sidebar: asset("sidebar", paths[1]) }
    }
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${actor.tenantId} FOR UPDATE`
      const user = await findAccessUser(tx, actor.tenantId, actor.userId)
      if (!user || user.tenant.status !== "ACTIVE" || user.tenant.slug === (process.env.PLATFORM_ADMIN_TENANT_SLUG || "platform")) throw new BusinessError(403, "Business workspace access is not permitted.")
      const fresh = { ...actor, ...accessContext(user) }
      requireBrandingAdmin(fresh)
      const before = await tx.appSetting.findUniqueOrThrow({ where: { tenantId: actor.tenantId }, select: { branding: true, brandingVersion: true } })
      if (before.brandingVersion !== data.version) throw new BusinessError(409, "Branding changed. Refresh before saving.")
      const branding: TenantBranding = { ...(before.branding as TenantBranding), name: data.name }
      if (data.removeLogo === "true") delete branding.logo
      if (logo) branding.logo = logo
      await tx.appSetting.update({ where: { tenantId: actor.tenantId }, data: { branding: branding as Prisma.InputJsonValue, brandingVersion: { increment: 1 } } })
      await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: fresh.role, requestId: actor.requestId,
        event: "branding.updated", entityType: "AppSetting", entityId: actor.tenantId,
        before: { branding: before.branding, version: before.brandingVersion }, after: { branding: branding as Prisma.InputJsonValue, version: before.brandingVersion + 1 } })
    }, { isolationLevel: "ReadCommitted", maxWait: 20000, timeout: 20000 })
  } catch (error) {
    // A known validation/authorization conflict rolls back. Retain uploads on an
    // ambiguous connection failure: COMMIT might have succeeded on the server.
    if (error instanceof BusinessError) await removeUncommittedLogos(paths).catch(() => {})
    throw error
  }
  // Saved assets are immutable and retained for historical document references.
  return readBranding(db, actor)
}
