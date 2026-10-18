import type { Prisma } from "@prisma/client"
import { activeTerms, termReplacements, type Term } from "./catalog"

export type TermReader = (tx: Prisma.TransactionClient, actor: { tenantId: string }) => Promise<Record<string, string>>

// Presentation reads run inside the caller's authorized tenant transaction.
// Two bounded queries per document/batch, never per record and never cached globally.
export async function readTermReplacements(tx: Prisma.TransactionClient, tenantId: string, catalog: readonly Term[]) {
  const [rows, flags] = await Promise.all([
    tx.tenantTerminology.findMany({ where: { tenantId }, select: { key: true, label: true } }),
    tx.tenantModule.findMany({ where: { tenantId }, select: { key: true, enabled: true, allowed: true } }),
  ])
  return termReplacements(activeTerms(catalog, flags), Object.fromEntries(rows.map(row => [row.key, row.label])))
}
