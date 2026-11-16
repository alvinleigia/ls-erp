"use client"
import * as React from "react"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/erp/controls"
import { PageHeader, Surface, pageClass } from "@/components/erp/page"
import { Pagination } from "@/components/erp/pagination"
import { useListState } from "@/components/erp/list-navigation"
import { verificationRoles, verificationSubjectSchema } from "./contracts"
import { VerificationRevision, verificationLabel } from "./revision-controls"

type Queue = {
  page: number
  pageSize: number
  total: number
  policyVersion: number
  rows: {
    id: string
    number: number
    policyVersion: number
    role: string
    submittedAt: string
    name: string
    subject: { kind: "PERSON" | "BUSINESS"; id: string }
  }[]
}
export function VerificationQueuePage() {
  const [page, setPage] = useListState("verification-queue", "page", 1, {
    validate: (value) =>
      typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100000
  })
  const [pageSize, setPageSize] = useListState("verification-queue", "pageSize", 10, {
    validate: (value) => typeof value === "number" && [5, 10, 20, 30].includes(value)
  })
  const [search, setSearch] = useListState("verification-queue", "search", "", {
    resetPages: true,
    validate: (value) => typeof value === "string" && value.length <= 100
  })
  const [kind, setKind] = useListState("verification-queue", "kind", "", {
    resetPages: true,
    validate: (value) => ["", "PERSON", "BUSINESS"].includes(String(value))
  })
  const [role, setRole] = useListState("verification-queue", "role", "", {
    resetPages: true,
    validate: (value) => ["", ...verificationRoles].includes(String(value))
  })
  const [data, setData] = React.useState<Queue>(),
    [error, setError] = React.useState(""),
    [loading, setLoading] = React.useState(true),
    [reload, setReload] = React.useState(0)
  React.useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        search,
        ...(kind ? { kind } : {}),
        ...(role ? { role } : {})
      })
      void fetch(`/api/verification/queue?${params}`, {
        cache: "no-store",
        signal: controller.signal
      })
        .then(async (response) => {
          const body = await response.json()
          if (!response.ok) throw Error(body.error || "Unable to load the review queue.")
          if (!controller.signal.aborted) {
            setData(body)
            setError("")
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
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [page, pageSize, search, kind, role, reload])
  return (
    <div className={pageClass}>
      <PageHeader
        title="Verification review queue"
        description="Latest submissions awaiting a decision for each customer and participant role. Only customers you can access are included. Requirements changed means a new submission is needed before approval."
        actions={
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => setReload((n) => n + 1)}
          >
            Refresh queue
          </Button>
        }
      />
      <Surface>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-medium">
            Find customer
            <Input
              className="mt-1"
              value={search}
              maxLength={100}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customers..."
            />
          </label>
          <label className="text-sm font-medium">
            Customer type
            <Select className="mt-1 w-full" value={kind} onValueChange={setKind}>
              <option value="">All customer types</option>
              <option value="PERSON">Person</option>
              <option value="BUSINESS">Business</option>
            </Select>
          </label>
          <label className="text-sm font-medium">
            Participant role
            <Select className="mt-1 w-full" value={role} onValueChange={setRole}>
              <option value="">All participant roles</option>
              {verificationRoles.map((value) => (
                <option key={value} value={value}>
                  {verificationLabel(value)}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {loading && <p role="status">Loading review queue...</p>}
        {!loading && data && (
          <>
            {!data.rows.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No submissions awaiting review.
              </p>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="p-3">Customer</th>
                      <th className="p-3">Participant role</th>
                      <th className="p-3">Revision</th>
                      <th className="p-3">Submitted</th>
                      <th className="p-3">Requirements</th>
                      <th className="p-3">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.id} className="border-b">
                        <td className="p-3 font-medium">{row.name}</td>
                        <td className="p-3">{verificationLabel(row.role)}</td>
                        <td className="p-3">{row.number}</td>
                        <td className="whitespace-nowrap p-3">{row.submittedAt.slice(0, 10)}</td>
                        <td className="p-3">
                          {row.policyVersion === data.policyVersion
                            ? "Current"
                            : "Requirements changed"}
                        </td>
                        <td className="p-3">
                          <Button asChild variant="outline">
                            <Link
                              href={`/crm/verification/${row.id}?${new URLSearchParams({ kind: row.subject.kind, customerId: row.subject.id })}`}
                            >
                              Review submission
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              loading={loading}
              resolved
              onPageChange={setPage}
              onPageSizeChange={(value) => {
                setPageSize(value)
                setPage(1)
              }}
              label="Review queue pagination"
            />
          </>
        )}
      </Surface>
    </div>
  )
}
export function VerificationReviewPage() {
  const { submissionId } = useParams<{ submissionId: string }>(),
    query = useSearchParams()
  const parsed = verificationSubjectSchema.safeParse({
    kind: query.get("kind"),
    id: query.get("customerId")
  })
  return (
    <div className={pageClass}>
      <PageHeader
        title="Review verification submission"
        backHref="/crm/verification"
        backLabel="Back to review queue"
      />
      {parsed.success ? (
        <VerificationRevision
          key={submissionId}
          {...parsed.data}
          submissionId={submissionId}
          allowReview
        />
      ) : (
        <p role="alert" className="text-destructive">
          Choose a submission from the review queue.
        </p>
      )}
    </div>
  )
}
