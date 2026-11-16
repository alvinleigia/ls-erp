"use client"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Section } from "@/components/erp/section"
import {
  applicableRequirements,
  type VerificationPolicy,
  type VerificationSubject,
  type verificationRoles
} from "./contracts"

export const verificationLabel = (value: string) =>
  value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase())
type Revision = {
  submission: {
    id: string
    number: number
    role: (typeof verificationRoles)[number]
    policyVersion: number
    submittedAt: string
    reason: string | null
    facts: { code: string; value: string }[]
    reviews: {
      id: string
      number: number
      decision: string
      reviewedAt: string
      validUntil: string | null
      reason: string | null
    }[]
  }
  revisionPolicy: { version: number; definition: VerificationPolicy }
  policyVersion: number
  caseVersion: number
  currentForRole: boolean
  evidence: {
    id: string
    filename: string | null
    documentCode: string | null
    downloadable: boolean
  }[]
  canReview: boolean
  canRevoke: boolean
  selfReview: boolean
}

// Read-only by default, including when embedded in the historical browser.
// Queue review still uses the shared, version-checked native write service.
export function VerificationRevision({
  kind,
  id,
  submissionId,
  allowReview = false
}: VerificationSubject & { submissionId: string; allowReview?: boolean }) {
  const [data, setData] = React.useState<Revision>(),
    [error, setError] = React.useState(""),
    [message, setMessage] = React.useState("")
  const [reason, setReason] = React.useState(""),
    [reviewed, setReviewed] = React.useState(false),
    [busy, setBusy] = React.useState(false),
    [reload, setReload] = React.useState(0)
  React.useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/verification/revision?${new URLSearchParams({ kind, id, submissionId })}`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw Error(body.error || "Unable to load this revision.")
        if (!controller.signal.aborted) {
          setData(body)
          setError("")
          setReason("")
          setReviewed(false)
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setData(undefined)
          setError(e.message)
        }
      })
    return () => controller.abort()
  }, [kind, id, submissionId, reload])
  async function decide(decision: "APPROVED" | "CHANGES_REQUIRED" | "REVOKED") {
    if (!data || busy) return
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const response = await fetch("/api/verification/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId,
          version: data.caseVersion,
          reviewVersion: data.submission.reviews[0]?.number ?? 0,
          decision,
          reviewed,
          ...(reason.trim() ? { reason: reason.trim() } : {})
        })
      })
      const body = await response.json()
      if (!response.ok) throw Error(body.error || "Unable to record this decision.")
      setMessage("Decision recorded. The submitted revision and earlier decisions were retained.")
      setData(undefined)
      setReload((n) => n + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to record this decision.")
    } finally {
      setBusy(false)
    }
  }
  const requirements =
    data && applicableRequirements(data.revisionPolicy.definition, kind, data.submission.role)
  const pending = data && !data.submission.reviews.length && data.currentForRole
  return (
    <Section
      title={data ? `Revision ${data.submission.number}` : "Saved revision"}
      actions={
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setData(undefined)
            setReload((n) => n + 1)
          }}
        >
          Refresh revision
        </Button>
      }
    >
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {!data && !error && <p role="status">Loading saved revision...</p>}
      {data && (
        <>
          <p className="text-sm text-muted-foreground">
            {verificationLabel(data.submission.role)} · Policy {data.submission.policyVersion} ·{" "}
            {data.submission.submittedAt.slice(0, 10)}
          </p>
          {!data.currentForRole && (
            <p className="text-sm">
              Historical revision. A newer submission exists for this participant role.
            </p>
          )}
          {data.submission.policyVersion !== data.policyVersion && (
            <p className="text-sm">
              Requirements have changed. Submit a new revision before approval.
            </p>
          )}
          {data.submission.reason && (
            <p className="break-words text-sm">Revision reason: {data.submission.reason}</p>
          )}
          <dl className="grid gap-3 sm:grid-cols-2">
            {data.submission.facts.map((f) => (
              <div key={f.code} className="min-w-0">
                <dt className="text-sm text-muted-foreground">
                  {requirements?.facts.find((field) => field.code === f.code)?.label ?? f.code}
                </dt>
                <dd className="break-words text-sm font-medium">{f.value}</dd>
              </div>
            ))}
          </dl>
          <h3 className="text-sm font-medium">Selected evidence</h3>
          {!data.evidence.length && (
            <p className="text-sm">No evidence required by this revision.</p>
          )}
          {data.evidence.map((file) => (
            <div
              key={file.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
            >
              <span className="min-w-0 break-all text-sm">
                {file.filename ?? "Private or unavailable evidence"}
              </span>
              {file.downloadable && (
                <Button asChild variant="outline">
                  <a
                    href={`/api/verification/evidence/${file.id}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Download evidence
                  </a>
                </Button>
              )}
            </div>
          ))}
          <h3 className="text-sm font-medium">Decisions</h3>
          {!data.submission.reviews.length && (
            <p className="text-sm">
              {data.currentForRole
                ? "Awaiting independent review"
                : "Superseded without a decision"}
            </p>
          )}
          {data.submission.reviews.map((review) => (
            <div key={review.id} className="space-y-1 border-t pt-2 text-sm">
              <p className="font-medium">
                {verificationLabel(review.decision)} · {review.reviewedAt.slice(0, 10)}
              </p>
              {review.reason && <p className="break-words">{review.reason}</p>}
              {review.validUntil && <p>Valid until {review.validUntil.slice(0, 10)}</p>}
            </div>
          ))}
          {allowReview &&
            ((pending && data.canReview) ||
              (data.submission.reviews[0]?.decision === "APPROVED" && data.canRevoke)) && (
              <div className="space-y-3 border-t pt-4">
                {pending && (
                  <>
                    {data.selfReview && (
                      <p className="text-sm">
                        A different reviewer must approve your submission or evidence.
                      </p>
                    )}
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={reviewed}
                        disabled={busy}
                        onChange={(e) => setReviewed(e.target.checked)}
                      />
                      I have reviewed the submitted facts and selected evidence.
                    </label>
                  </>
                )}
                <label className="block text-sm">
                  Decision reason
                  <textarea
                    className="mt-1 block w-full rounded-md border bg-background p-2"
                    maxLength={1000}
                    value={reason}
                    disabled={busy}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  {pending ? (
                    <>
                      <Button
                        type="button"
                        disabled={
                          busy ||
                          !reviewed ||
                          data.selfReview ||
                          data.submission.policyVersion !== data.policyVersion
                        }
                        onClick={() => void decide("APPROVED")}
                      >
                        Approve verification
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy || !reason.trim()}
                        onClick={() => void decide("CHANGES_REQUIRED")}
                      >
                        Request corrections
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy || !reason.trim()}
                      onClick={() => void decide("REVOKED")}
                    >
                      Revoke approval
                    </Button>
                  )}
                </div>
              </div>
            )}
        </>
      )}
    </Section>
  )
}
