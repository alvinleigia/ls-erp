import type { Prisma } from "@prisma/client"
import { tenantOperationTransaction } from "@/platform/transactions/tenant-operation"

// Schedule and inventory operations use the same lock as native R10 guards and
// account-security writers. Nested stock work reuses its caller's transaction.
export function scheduleTransaction<T>(tenantId: string, action: (tx: Prisma.TransactionClient) => Promise<T>) {
  return tenantOperationTransaction(tenantId, action)
}
