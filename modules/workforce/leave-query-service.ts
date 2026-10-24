import { leaveApprovalScope } from "./leave-access"
import { prisma } from "@/lib/prisma"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import type { LeaveRosterItem } from "@/types/leaves"
import type { WorkforceDateRangeQuery } from "./schedule-validation"

// Module/action authorization and tenant DB context belong to withWorkforceApi.
export async function listApprovedLeaves(actor: BusinessActor, query: WorkforceDateRangeQuery) {
  const { tenantId } = actor
  if (!tenantId || !actor.userId || !["ADMIN", "MANAGER", "STAFF"].includes(actor.role)) throw new BusinessError(401, "Unauthorized")
  const { startDate, endDate, staffIds } = query
  const staffUserIds = (staffIds ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  const items = await prisma.leaveRequest.findMany({
    where: {
      ...leaveApprovalScope(actor, "read"),
      status: "APPROVED",
      startDate: { lte: new Date(`${endDate}T00:00:00.000Z`) },
      endDate: { gte: new Date(`${startDate}T00:00:00.000Z`) },
      staffProfile: {
        user: { tenantId, ...(staffUserIds.length ? { id: { in: staffUserIds } } : {}) },
      },
      AND: [leaveApprovalScope(actor, "read")],
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      reason: true,
      leaveDefinition: {
        select: {
          code: true,
          name: true,
        },
      },
      staffProfile: {
        select: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
    },
    orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
  })

  const response: LeaveRosterItem[] = items.map((item) => ({
    id: item.id,
    staffId: item.staffProfile.user.id,
    staffName: item.staffProfile.user.name,
    staffEmail: item.staffProfile.user.email,
    leaveDefinitionCode: item.leaveDefinition.code,
    leaveDefinitionName: item.leaveDefinition.name,
    startDate: item.startDate.toISOString().slice(0, 10),
    endDate: item.endDate.toISOString().slice(0, 10),
    reason: item.reason,
  }))
  return { items: response }
}

export async function getLeaveRequestOptions(actor: BusinessActor) {
  const { tenantId, userId: sessionUserId } = actor
  if (!tenantId || !sessionUserId || !["MANAGER", "STAFF"].includes(actor.role)) throw new BusinessError(401, "Unauthorized")
  const staffProfile = await prisma.staffProfile.findFirst({
    where: { userId: sessionUserId, user: { tenantId } }, select: { id: true },
  }) ?? await prisma.staffProfile.create({ data: { userId: sessionUserId }, select: { id: true } })
  const items = await prisma.leaveDefinition.findMany({
    where: {
      tenantId, status: "ACTIVE",
      leaveGroups: { some: { leaveGroup: {
        tenantId, status: "ACTIVE", OR: [
          { assignmentMode: "ALL_STAFF" },
          { assignmentMode: "SELECTED_STAFF", staffAssignments: { some: { staffProfileId: staffProfile.id } } },
        ],
      } } },
    },
    select: { id: true, code: true, name: true }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  })
  return { items: items.map(item => ({ value: item.id, label: `${item.code} - ${item.name}` })) }
}
