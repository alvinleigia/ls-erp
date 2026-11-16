"use client"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Pagination } from "@/components/erp/pagination"
import type { VerificationSubject } from "./contracts"
import { VerificationRevision, verificationLabel } from "./revision-controls"

type History = {
  page: number
  pageSize: number
  total: number
  rows: {
    id: string
    number: number
    policyVersion: number
    role: string
    reason: string | null
    submittedAt: string
    reviews: { decision: string }[]
  }[]
}
export function VerificationHistory(subject: VerificationSubject & { changed: number }) {
  const [open, setOpen] = React.useState(false)
  return (
    <details
      className="rounded-lg border p-4"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-medium">Revision history</summary>
      {open && <HistoryPages key={`${subject.kind}:${subject.id}`} {...subject} />}
    </details>
  )
}
function HistoryPages({ kind, id, changed }: VerificationSubject & { changed: number }) {
  const [page, setPage] = React.useState(1),
    [pageSize, setPageSize] = React.useState(10),
    [data, setData] = React.useState<History>(),
    [error, setError] = React.useState("")
  const [selected, setSelected] = React.useState(""),
    [loading, setLoading] = React.useState(true)
  React.useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void fetch(
      `/api/verification/history?${new URLSearchParams({ kind, id, page: String(page), pageSize: String(pageSize) })}`,
      { cache: "no-store", signal: controller.signal }
    )
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw Error(body.error || "Unable to load revision history.")
        if (!controller.signal.aborted) {
          setData(body)
          setError("")
          setPage(body.page)
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setData(undefined)
          setError(e.message)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [kind, id, page, pageSize, changed])
  return (
    <div className="mt-4 space-y-4">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading revision history...</p>}
      {!loading && data && (
        <>
          {!data.rows.length && <p className="text-sm">No submitted revisions.</p>}
          {data.rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm"
            >
              <div className="min-w-0 space-y-1">
                <p className="font-medium">
                  Revision {row.number} · {verificationLabel(row.role)} · Policy {row.policyVersion}
                </p>
                <p>
                  {row.submittedAt.slice(0, 10)} ·{" "}
                  {row.reviews[0]
                    ? verificationLabel(row.reviews[0].decision)
                    : "No decision recorded"}
                </p>
                {row.reason && <p className="break-words">Revision reason: {row.reason}</p>}
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSelected((current) => (current === row.id ? "" : row.id))}
              >
                {selected === row.id ? "Close revision" : `View revision ${row.number}`}
              </Button>
            </div>
          ))}
          <Pagination
            {...data}
            loading={loading}
            resolved
            onPageChange={(value) => {
              setPage(value)
              setSelected("")
            }}
            onPageSizeChange={(value) => {
              setPageSize(value)
              setPage(1)
              setSelected("")
            }}
            label="Revision history pagination"
          />
          {selected && (
            <VerificationRevision
              key={`${selected}:${changed}`}
              kind={kind}
              id={id}
              submissionId={selected}
            />
          )}
        </>
      )}
    </div>
  )
}
