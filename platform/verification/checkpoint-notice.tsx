import type { CheckpointReview } from "./checkpoint-contracts"
export function VerificationCheckpointNotice({ review }: { review?: CheckpointReview }) {
  if (!review || review.mode === "OFF") return null
  return <p role="status" className={`rounded-md border p-3 text-sm ${review.mode === "REQUIRED" && !review.eligible ? "text-destructive" : "text-muted-foreground"}`}>
    Customer verification: {review.eligible ? "all applicable participants currently meet the requirements." : `${review.missingCount} participant${review.missingCount === 1 ? "" : "s"} need verification review.`}
    {review.mode === "WARN" ? " Warning only; you may continue. The result will be recorded." : " Approval is required before this action."} Checked again when saved.
  </p>
}
