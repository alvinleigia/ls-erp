import type { PermissionRun } from "@/platform/access/server"
import type { Prisma } from "@prisma/client"
import type { CrmActor } from "./policy"

// Application-installed capabilities share CRM's checked transaction and audit.
export type CrmServiceContext = {
  run: PermissionRun
  audit: (tx: Prisma.TransactionClient, actor: CrmActor, event: string, id: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) => Promise<void>
}
