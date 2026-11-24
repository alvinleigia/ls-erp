import type { Prisma } from "@prisma/client"
import { BusinessError } from "@/platform/policy"
import { catalogCurrencySchema } from "./validation"

export async function catalogDefaultCurrency(tx: Prisma.TransactionClient, tenantId: string) {
  const settings = await tx.appSetting.findUnique({ where: { tenantId }, select: { currency: true } })
  const currency = catalogCurrencySchema.safeParse(settings?.currency)
  if (!currency.success) throw new BusinessError(503, "Configure the business currency in Settings before saving items without an explicit currency.")
  return currency.data
}
