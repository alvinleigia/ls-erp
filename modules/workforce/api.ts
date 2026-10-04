import type { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canManageUsers, type Role } from "@/lib/permissions"
import { recordDomainAuditEventSafe } from "@/lib/domain-audit"
import { withBusinessApi, readJson } from "@/platform/business-api"
import { requireBusinessModule } from "@/platform/module-server"
import { requirePermission } from "@/platform/access/policy"
import type { PermissionAction, Resource } from "@/platform/access/catalog"
import { BusinessError, type BusinessActor } from "@/platform/policy"

// Legacy domain handlers retain their workflow rules, using the freshly checked actor.
export function workforceSession(actor: BusinessActor): { error?: NextResponse; context: { tenantId: string; role: string; sessionUserId: string } } {
  return { context: { tenantId: actor.tenantId, role: actor.role, sessionUserId: actor.userId } }
}

async function snapshot(key: string, tenantId: string, id?: string, input?: Record<string, unknown>): Promise<unknown> {
  if (key === "definitions" && id) return prisma.leaveDefinition.findFirst({ where: { tenantId, id }, include: { nonClubbableWithFrom: true } })
  if (key === "groups" && id) return prisma.leaveGroup.findFirst({ where: { tenantId, id }, include: { leaves: true, staffAssignments: true } })
  if (key === "templates" && id) return prisma.shiftTemplate.findFirst({ where: { tenantId, id }, include: { breaks: true } })
  if (key === "schedules" && id) return prisma.shiftSchedule.findFirst({ where: { tenantId, id }, include: { blocks: true, assignments: true } })
  if (key === "assignments" && id) return prisma.staffScheduleAssignment.findFirst({ where: { id, schedule: { tenantId } } })
  if (key.startsWith("flexible-patterns") && id) return prisma.staffFlexiblePattern.findFirst({ where: { id, staffProfile: { user: { tenantId } } }, include: { weeks: { include: { days: { include: { slots: { include: { breaks: true } } } } } } } })
  const date = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value) : undefined
  // Date-based overrides are upserts. Bound snapshots to the affected staff/date.
  if (typeof input?.staffId === "string") {
    const staffProfile = { user: { tenantId, id: input.staffId } }
    if (key === "overrides" && date(input.startDate) && date(input.endDate)) return prisma.staffShiftOverride.findMany({ where: { staffProfile, date: { gte: date(input.startDate), lte: date(input.endDate) } } })
    if (key === "flexible-slots" && date(input.date)) return prisma.staffFlexibleAvailability.findMany({ where: { staffProfile, date: date(input.date) } })
    if (key === "flexible-week-plans" && date(input.weekStartDate)) return prisma.staffFlexibleWeekPlan.findMany({ where: { staffProfile, weekStartDate: date(input.weekStartDate) }, include: { days: { include: { slots: { include: { breaks: true } } } } } })
  }
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
    const before = action !== "read" ? await snapshot(key.split('/')[0], actor.tenantId, recordId, input) : null
    if (recordId && action !== "read" && !key.startsWith("requests") && !before) throw new BusinessError(404, "Record not found.")
    if (!key.startsWith("requests") && (action === "create" || action === "edit")) {
      const previous = before as { status?: string; isActive?: boolean } | null
      if (input?.status !== undefined && input.status !== (previous?.status ?? "ACTIVE")) requirePermission(actor, `${resource}.archive`)
      if (input?.isActive !== undefined && input.isActive !== (previous?.isActive ?? true)) requirePermission(actor, `${resource}.archive`)
      if (key === "flexible-patterns" && request.method === "PUT" && !recordId) requirePermission(actor, "shiftPlans.create")
      if (key === "overrides" && input?.templateId) requirePermission(actor, "shiftTemplates.read")
      if (resource === "shiftSchedules" && Array.isArray(input?.blocks) && input.blocks.length) requirePermission(actor, "shiftTemplates.read")
      if (resource === "leaveGroups" && Array.isArray(input?.leaveDefinitionIds) && input.leaveDefinitionIds.length) requirePermission(actor, "leaveDefinitions.read")
    }
    // Selecting a new default also updates the previously default schedule.
    const previousDefaults = resource === "shiftSchedules" && input?.isDefault === true
      ? await prisma.shiftSchedule.findMany({ where: { tenantId: actor.tenantId, isDefault: true, ...(recordId ? { id: { not: recordId } } : {}) }, select: { id: true, isDefault: true } }) : []
    if (previousDefaults.length) requirePermission(actor, "shiftSchedules.edit")
    const response = await handler(actor)
    if (response.ok && action !== "read" && !key.startsWith("requests")) {
      const result = await response.clone().json()
      if (previousDefaults.length) await recordDomainAuditEventSafe(prisma, {
        tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
        event: "workforce.shiftSchedules.edit", entityType: "shiftSchedules",
        before: { defaultSchedules: previousDefaults }, after: { defaultSchedules: [] },
      })
      const entityId = key.endsWith("/clone") ? result.item?.id ?? result.pattern?.id : recordId ?? result.item?.id ?? result.template?.id ?? result.schedule?.id ?? result.pattern?.id
      const after = await snapshot(key.split('/')[0], actor.tenantId, entityId, input)
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
