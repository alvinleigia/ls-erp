import type { Prisma, PrismaClient } from "@prisma/client"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { verificationSourceSchema, type VerificationSource } from "./checkpoint-contracts"
import type { VerificationIdentity } from "./configuration"
export type VerificationSourceReader = (tx: Prisma.TransactionClient, actor: BusinessActor, source: VerificationSource) => Promise<unknown>
export function createVerificationSourceService(db: PrismaClient, identity: VerificationIdentity, sourceReader: VerificationSourceReader) {
  return { get(input: unknown) {
    const source = verificationSourceSchema.parse(input)
    return db.$transaction(async tx => {
      const actor = await authorizeBusinessOperation(tx, identity, ["verificationSummaries.read", source.kind === "ORDER" ? "salesOrders.read" : "opportunities.read"], ["customerVerification", "crm", ...(source.kind === "ORDER" ? ["salesOrders" as const] : [])])
      if (actor.collaboratorId || !await sourceReader(tx, actor, source)) throw new BusinessError(404, "Transaction not found.")
      const [result] = await tx.$queryRaw<{ summary: unknown }[]>`SELECT app.verification_source_summary(${actor.tenantId},${source.kind},${source.id}) AS summary`
      if (!result?.summary) throw new BusinessError(404, "Verification summary unavailable.")
      const acceptances = source.kind === "ORDER" ? await tx.orderVerificationAcceptance.findMany({ where: { tenantId: actor.tenantId, orderId: source.id }, select: { id: true, checkpoint: true, sourceId: true, sourceVersion: true, configurationVersion: true, evaluatedAt: true, proof: true }, orderBy: { evaluatedAt: "desc" }, take: 10 }) : []
      // Accepted operation evidence is separate from today's status. Never expose
      // raw private facts, file references or reviewer identities in this view.
      return { ...result.summary as object, acceptances: acceptances.map(({ proof, ...r }) => ({ ...r, mode: (proof as { mode?: string }).mode, eligible: (proof as { eligible?: boolean }).eligible })) }
    }, { isolationLevel: "ReadCommitted", maxWait: 20000, timeout: 20000 })
  } }
}
