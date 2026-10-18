import type { Prisma, StaffSchedulingMode } from "@prisma/client"
import { businessDate } from "@/lib/business-time"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { findAccessUser, assignedPermissions } from "@/platform/access/server"
import { requirePermission } from "@/platform/access/policy"
import { requireBusinessModule } from "@/platform/module-server"
import { BusinessError, type BusinessActor } from "@/platform/policy"

export function schedulingModeDates(now: Date, timeZone: string) {
  const today = new Date(businessDate(now, timeZone))
  const weekStart = new Date(today)
  weekStart.setUTCDate(weekStart.getUTCDate() - (weekStart.getUTCDay() + 6) % 7)
  return { today, weekStart }
}

// Caller owns the scheduling transaction, acquired before user-security row locks.
// Changing mode never deletes plans, appointments or historical roster snapshots.
export async function setStaffSchedulingMode(tx: Prisma.TransactionClient,
  identity: Pick<BusinessActor, "tenantId" | "userId" | "requestId">,
  userId: string, requested?: StaffSchedulingMode) {
  const { tenantId } = identity
  const user = await tx.user.findFirst({ where: { id: userId, tenantId, role: "STAFF" }, select: { id: true } })
  if (!user) throw new BusinessError(404, "Staff user not found.")
  const existing = await tx.staffProfile.findUnique({ where: { userId }, select: { id: true, schedulingMode: true } })
  const before = existing?.schedulingMode ?? "STANDARD"
  const schedulingMode = requested ?? before
  if (schedulingMode !== before) {
    const accessUser = await findAccessUser(tx, tenantId, identity.userId)
    if (!accessUser || accessUser.role !== "ADMIN") throw new BusinessError(403, "Scheduling mode requires administrator access.")
    await requireBusinessModule(tx, tenantId, "shifts")
    requirePermission({ ...identity, role: accessUser.role, permissions: assignedPermissions(accessUser) }, "shiftRoster.edit")
    const now = new Date()
    const setting = await tx.appSetting.findUnique({ where: { tenantId }, select: { timeZone: true } })
    const { today, weekStart } = schedulingModeDates(now, setting?.timeZone ?? "UTC")
    if (existing) {
      const staffProfileId = existing.id
      if (schedulingMode === "FLEXIBLE") {
        if (await tx.staffScheduleAssignment.findFirst({ where: { staffProfileId,
          OR: [{ endDate: null }, { endDate: { gte: today } }] }, select: { id: true } })) {
          throw new BusinessError(409, "Cannot switch to Flexible while active/future shift schedule assignments exist. Remove schedule assignments first.")
        }
      } else {
        const [pattern, week, slot] = await Promise.all([
          tx.staffFlexiblePattern.findFirst({ where: { staffProfileId, isActive: true, OR: [{ validTo: null }, { validTo: { gte: today } }] }, select: { id: true } }),
          tx.staffFlexibleWeekPlan.findFirst({ where: { staffProfileId, weekStartDate: { gte: weekStart } }, select: { id: true } }),
          tx.staffFlexibleAvailability.findFirst({ where: { staffProfileId, date: { gte: today } }, select: { id: true } }),
        ])
        if (pattern || week || slot) throw new BusinessError(409, "Cannot switch to Standard while active/future flexible availability exists. Clear flexible plans/slots first.")
      }
      // An explicit mode switch is not a command to cancel or move bookings.
      // Do not disclose customer details to users without Appointments access.
      if (await tx.appointment.findFirst({ where: { tenantId, staffProfileId,
        OR: [{ status: "IN_PROGRESS" }, { status: { in: ["SCHEDULED", "CONFIRMED"] }, endAt: { gt: now } }] }, select: { id: true } })) {
        throw new BusinessError(409, "Resolve active/future appointments before changing scheduling mode. Reassign or cancel them through Appointments.")
      }
    }
    await recordDomainAuditEvent(tx, { ...identity, actorUserId: identity.userId, actorRole: accessUser.role,
      event: "workforce.shiftRoster.edit", entityType: "User", entityId: userId,
      before: { schedulingMode: before }, after: { schedulingMode } })
  }
  return tx.staffProfile.upsert({ where: { userId }, update: { schedulingMode }, create: { userId, schedulingMode } })
}
