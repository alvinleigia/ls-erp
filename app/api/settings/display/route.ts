import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { BusinessError } from "@/platform/policy"

export const dynamic = "force-dynamic"

// Formatting preferences are needed by staff workflows. Keep administrative
// settings, email delivery configuration and all writes on the restricted API.
export function GET(request: Request) {
  return withBusinessApi(request, async actor => {
    const settings = await prisma.appSetting.findUnique({
      where: { tenantId: actor.tenantId },
      select: {
        locale: true, currency: true, timeZone: true, dateFormat: true,
        timeFormat: true, firstDayOfWeek: true, currencySymbolPlacement: true,
        numberFormat: true,
      },
    })
    if (!settings) throw new BusinessError(503, "Business display settings are not configured. Ask your administrator to review Settings.")
    return { settings }
  })
}
