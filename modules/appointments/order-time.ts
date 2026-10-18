import type { AppointmentOrderCreateInput, AppointmentOrderUpdateInput } from "@/lib/validation"
import { wallTime, wallTimeToInstant } from "@/lib/business-time"
import { BusinessError } from "@/platform/policy"

type OrderTime = Pick<AppointmentOrderCreateInput, "appointmentDate" | "appointmentStartTime" | "appointmentStartAt">

export function validateOrderTime(input: OrderTime, timeZone: string) {
  if (wallTime(input.appointmentStartAt, timeZone) !== `${input.appointmentDate}T${input.appointmentStartTime}`) {
    throw new BusinessError(400, "Booking date and time must match the start timestamp in the business timezone.")
  }
}

export function mergeOrderTime(saved: OrderTime, patch: AppointmentOrderUpdateInput, timeZone: string): OrderTime {
  if (patch.appointmentStartAt === undefined && patch.appointmentDate === undefined && patch.appointmentStartTime === undefined) {
    return { appointmentDate: saved.appointmentDate, appointmentStartTime: saved.appointmentStartTime, appointmentStartAt: saved.appointmentStartAt }
  }
  let instant = patch.appointmentStartAt
  if (instant === undefined) {
    try { instant = wallTimeToInstant(`${patch.appointmentDate ?? saved.appointmentDate}T${patch.appointmentStartTime ?? saved.appointmentStartTime}`, timeZone) }
    catch (error) { throw new BusinessError(400, error instanceof Error ? error.message : "Choose a valid booking date and time.") }
  }
  const local = wallTime(instant, timeZone)
  const result = { appointmentStartAt: instant, appointmentDate: patch.appointmentDate ?? local.slice(0, 10),
    appointmentStartTime: patch.appointmentStartTime ?? local.slice(11, 16) }
  validateOrderTime(result, timeZone)
  return result
}
