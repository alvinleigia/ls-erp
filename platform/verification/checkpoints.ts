import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import { BusinessError } from "@/platform/policy"
import type { CheckpointReview, verificationCheckpoints } from "./checkpoint-contracts"
export async function readOrderVerificationCheckpoint(tx: Prisma.TransactionClient, actor: BusinessActor, id: string, checkpoint: typeof verificationCheckpoints[number]): Promise<CheckpointReview> {
  const [row] = await tx.$queryRaw<{ review: CheckpointReview | null }[]>`SELECT app.verification_checkpoint_review(${actor.tenantId},${id},${checkpoint}) AS review`
  if (!row?.review) throw new BusinessError(404, "Order verification review is unavailable.")
  return row.review
}
export function verificationCheckpointError(error: unknown) {
  const e = error as { message?: string; meta?: { driverAdapterError?: { cause?: { originalMessage?: string } }; database_error?: string } }
  const message = [e?.message, e?.meta?.database_error, e?.meta?.driverAdapterError?.cause?.originalMessage].filter(Boolean).join(" ")
  if (message.includes("Customer verification checkpoint: disposal")) return new BusinessError(409, "Verification evidence disposal is in progress for this customer. Finish or reconcile it before continuing.")
  if (message.includes("Customer verification checkpoint:")) return new BusinessError(409, "Customer verification is required for this action. Refresh the verification summary and complete approval for every applicable participant.")
  return null
}
