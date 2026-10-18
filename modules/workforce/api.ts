import type { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canManageUsers, type Role } from "@/lib/permissions"
import { recordDomainAuditEventSafe } from "@/lib/domain-audit"
import { withBusinessApi, readJson } from "@/platform/business-api"
import { requireBusinessModule } from "@/platform/module-server"
import { requirePermission } from "@/platform/access/policy"
import type { PermissionAction, Resource } from "@/platform/access/catalog"
import { BusinessError, type BusinessActor } from "@/platform/policy"

async function snapshot(key: string, tenantId: string, id?: string): Promise<unknown> {
  if (key === "definitions" && id) return prisma.leaveDefinition.findFirst({ where: { tenantId, id }, include: { nonClubbableWithFrom: true } })
  if (key === "groups" && id) return prisma.leaveGroup.findFirst({ where: { tenantId, id }, include: { leaves: true, staffAssignments: true } })
  return null
}

export function withWorkforceApi(request: Request, module: "leaves" | "shifts", resource: Resource, action: PermissionAction,
  handler: (actor: BusinessActor) => Promise<NextResponse>, key: string, id?: string) {
  return withBusinessApi(request, async actor => {
    await requireBusinessModule(prisma, actor.tenantId, module)
    const personal = module === "leaves" && (key === "request-options" || key === "requests" || key === "requests/[id]" || key === "requests/[id]/cancel")
    if (!personal && !canManageUsers(actor.role as Role)) throw new BusinessError(403, "This view requires administrator or manager access.")
    requirePermission(actor, personal ? { any: ["leaveRequests.read", "leaveApprovals.read"] } : `${resource}.read`)
    const input = request.method === "GET" || !request.body ? undefined : await readJson(request.clone()) as Record<string, unknown> | undefined
    if (key === "flexible-patterns" && request.method === "PUT" && !input?.patternId) action = "create"
    let actualResource = resource
    if (personal && key !== "request-options") {
      requirePermission(actor, { any: [`leaveRequests.${action}`, `leaveApprovals.${action}`] })
      if (id) {
        const row = await prisma.leaveRequest.findFirst({ where: { tenantId: actor.tenantId, id }, select: { staffProfile: { select: { userId: true } } } })
        if (!row) throw new BusinessError(404, "Leave request not found.")
        actualResource = row.staffProfile.userId === actor.userId ? "leaveRequests" : "leaveApprovals"
      } else if (action === "read") {
        actualResource = actor.role === "STAFF" || new URL(request.url).searchParams.get("mineOnly") === "true" ? "leaveRequests" : "leaveApprovals"
      }
    }
    requirePermission(actor, `${actualResource}.${action}`)
    const recordId = id ?? (typeof input?.patternId === "string" ? input.patternId : undefined)
    // These services read snapshots and recheck transitions after acquiring the
    // scheduling lock; the wrapper must not duplicate stale reads or their audit.
    const serviceAudit = key === "flexible-week-plans" || key.startsWith("flexible-patterns") || ["templates", "schedules", "assignments", "overrides", "flexible-slots"].includes(key.split("/")[0])
    const before = action !== "read" && !serviceAudit ? await snapshot(key.split('/')[0], actor.tenantId, recordId) : null
    if (recordId && action !== "read" && !key.startsWith("requests") && !serviceAudit && !before) throw new BusinessError(404, "Record not found.")
    if (!key.startsWith("requests") && (action === "create" || action === "edit")) {
      const previous = before as { status?: string; isActive?: boolean } | null
      if (input?.status !== undefined && input.status !== (previous?.status ?? "ACTIVE")) requirePermission(actor, `${resource}.archive`)
      if (!serviceAudit && input?.isActive !== undefined && input.isActive !== (previous?.isActive ?? true)) requirePermission(actor, `${resource}.archive`)
      if (key === "flexible-patterns" && request.method === "PUT" && !recordId) requirePermission(actor, "shiftPlans.create")
      if (key === "overrides" && input?.templateId) requirePermission(actor, "shiftTemplates.read")
      if (resource === "shiftSchedules" && Array.isArray(input?.blocks) && input.blocks.length) requirePermission(actor, "shiftTemplates.read")
      if (resource === "leaveGroups" && Array.isArray(input?.leaveDefinitionIds) && input.leaveDefinitionIds.length) requirePermission(actor, "leaveDefinitions.read")
    }
    const response = await handler(actor)
    if (response.ok && action !== "read" && !key.startsWith("requests") && !serviceAudit) {
      const result = await response.clone().json()
      const entityId = key.endsWith("/clone") ? result.id ?? result.item?.id ?? result.pattern?.id : recordId ?? result.item?.id ?? result.template?.id ?? result.schedule?.id ?? result.pattern?.id
      const after = await snapshot(key.split('/')[0], actor.tenantId, entityId)
      await recordDomainAuditEventSafe(prisma, {
        tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
        event: `workforce.${resource}.${action}`, entityType: resource, entityId,
        ...(before ? { before: JSON.parse(JSON.stringify(before)) } : {}),
        after: JSON.parse(JSON.stringify(after ?? result)),
      })
    }
    return response
  })
}
