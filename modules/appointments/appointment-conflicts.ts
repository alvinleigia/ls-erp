import { AppointmentStatus, type Prisma } from "@prisma/client"
import { checkStaffAppointmentAvailability } from "@/modules/workforce/availability"
import { BusinessError } from "@/platform/policy"
import { appointmentConflictSummary } from "./booking-integrity"

export const activeAppointmentStatuses: AppointmentStatus[] = ["SCHEDULED", "CONFIRMED", "IN_PROGRESS"]
export type AppointmentSlot = { staffProfileId: string; customerId?: string; startAt: Date; endAt: Date }

export async function appointmentConflictReason(db: Prisma.TransactionClient, tenantId: string,
  slot: AppointmentSlot & { appointmentId?: string }) {
  const availability = await checkStaffAppointmentAvailability(slot.staffProfileId, slot.startAt, slot.endAt, tenantId, db)
  if (!availability.ok) return availability.reason
  const [{ staffConflict, customerConflict }] = await appointmentConflictSummary(db, tenantId, [slot], slot.appointmentId ? [slot.appointmentId] : [])
  if (staffConflict) return "Staff member already has an appointment in this time range."
  if (customerConflict) return "Customer already has an appointment in this time range."
  return null
}

// Bulk moves exclude their old rows, but must also check conflicts among the new slots.
// One bounded query checks other bookings, rather than two queries per moved row.
export async function assertAppointmentMovesAvailable(db: Prisma.TransactionClient, tenantId: string,
  moves: Array<AppointmentSlot & { id: string; status: AppointmentStatus }>, excludedIds: string[]) {
  const active = moves.filter(move => activeAppointmentStatuses.includes(move.status))
  if (!active.length) return
  const staffEnds = new Map<string, Date>(), customerEnds = new Map<string, Date>()
  for (const move of [...active].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())) {
    if ((staffEnds.get(move.staffProfileId)?.getTime() ?? 0) > move.startAt.getTime()) {
      throw new BusinessError(409, "Selected appointments overlap for the same staff member.")
    }
    if (move.customerId && (customerEnds.get(move.customerId)?.getTime() ?? 0) > move.startAt.getTime()) {
      throw new BusinessError(409, "Selected appointments overlap for the same customer.")
    }
    staffEnds.set(move.staffProfileId, move.endAt)
    if (move.customerId) customerEnds.set(move.customerId, move.endAt)
  }
  const conflict = (await appointmentConflictSummary(db, tenantId, active, excludedIds)).find(row => row.staffConflict || row.customerConflict)
  if (conflict) {
    throw new BusinessError(409, conflict.staffConflict ? "Staff member already has an appointment in this time range." : "Customer already has an appointment in this time range.")
  }
  for (const move of active) {
    const availability = await checkStaffAppointmentAvailability(move.staffProfileId, move.startAt, move.endAt, tenantId, db)
    if (!availability.ok) throw new BusinessError(409, `Appointment ${move.id}: ${availability.reason}`)
  }
}
