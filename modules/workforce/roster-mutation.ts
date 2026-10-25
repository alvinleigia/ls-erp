import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import type { BusinessActor } from "@/platform/policy"
import { canReadAppointmentDetails } from "@/modules/appointments/conflict-access"
import { planTransaction } from "./plan-transaction"
import { PlanBookingConflict } from "./plan-bookings"

// Catch only after rollback: a conflict must never commit a tentative roster edit.
// Recheck disclosure rights now and fetch customer details only for authorized users.
export async function rosterMutation<T>(actor: BusinessActor, action: "edit" | "archive",
  write: (tx: Prisma.TransactionClient, currentActor: BusinessActor) => Promise<T>) {
  try {
    return await planTransaction(actor, "shiftRoster", action, write)
  } catch (error) {
    if (!(error instanceof PlanBookingConflict)) throw error
    const conflicts: { id: string; startAt: string; endAt: string; customerName: string | null; customerEmail: string | null; serviceName: string | null }[] = []
    if (await canReadAppointmentDetails(actor.tenantId, actor.userId)) {
      for (let i = 0; i < error.blockedSlots.length; i += 200) {
        let cursor: string | undefined
        while (true) {
          const rows = await prisma.appointment.findMany({ where: { tenantId: actor.tenantId,
            status: { in: ["SCHEDULED", "CONFIRMED", "IN_PROGRESS"] },
            ...(cursor ? { id: { gt: cursor } } : {}),
            OR: error.blockedSlots.slice(i, i + 200).map(slot => ({ staffProfileId: slot.staffProfileId, startAt: slot.startAt, endAt: slot.endAt })) }, orderBy: { id: "asc" },
            take: 200,
            select: { id: true, startAt: true, endAt: true, customer: { select: { name: true, email: true } }, service: { select: { name: true } } },
          })
          conflicts.push(...rows.map(row => ({ id: row.id, startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString(),
            customerName: row.customer?.name ?? null, customerEmail: row.customer?.email ?? null, serviceName: row.service?.name ?? null })))
          if (rows.length < 200) break
          cursor = rows[rows.length - 1].id
        }
      }
    }
    return { error: error.message, conflicts, conflictCount: error.blockedSlots.length }
  }
}
