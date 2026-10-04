import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { BusinessError } from "@/platform/policy"
import { requireLookup } from "@/platform/core/lookups"

// Read-only scheduling inputs, without notification or delivery configuration.
export function GET(request: Request) {
  return withBusinessApi(request, async actor => {
    await requireLookup(actor, [["appointments", "appointments.read"], ["shifts", "shiftRoster.read"]], "businessSettings.read")
    const settings = await prisma.appSetting.findUnique({ where: { tenantId: actor.tenantId }, select: {
      locale: true, currency: true, timeZone: true, dateFormat: true, timeFormat: true,
      firstDayOfWeek: true, currencySymbolPlacement: true, numberFormat: true,
      workingDays: { select: { day: true, isOpen: true, periods: { select: { kind: true, startTime: true, endTime: true, sortOrder: true }, orderBy: { sortOrder: "asc" } } } },
      overrides: { select: { date: true, isOpen: true, periods: { select: { kind: true, startTime: true, endTime: true, sortOrder: true }, orderBy: { sortOrder: "asc" } } } },
    } })
    if (!settings) throw new BusinessError(503, "Business settings are not configured.")
    const { workingDays, overrides, ...display } = settings
    return { settings: { ...display, workingHours: workingDays, overrides: overrides.map(row => ({ ...row, date: row.date.toISOString().slice(0, 10) })) } }
  })
}
