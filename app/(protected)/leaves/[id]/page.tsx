"use client"
import { useCurrentResourceAction } from "@/platform/access/view-guard"

import { DraftPanel } from "@/components/erp/record-detail"
import { LeaveDefinitionSummary } from "@/app/(protected)/leaves/leave-record-summary"

import { ActionDialogContent } from "@/components/erp/action-dialog"

import { PageHeader, pageClass } from "@/components/erp/page"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"

import { LeaveDefinitionFormFields } from "@/app/(protected)/leaves/leave-definition-form-fields"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { useFormErrors } from "@/hooks/use-form-errors"
import type { LeaveDefinitionFormValues, LeaveDefinitionRow } from "@/types/leaves"

const mapToFormValues = (row: LeaveDefinitionRow): LeaveDefinitionFormValues => ({
  code: row.code,
  name: row.name,
  leaveType: row.leaveType,
  allowedUsers: row.allowedUsers,
  minDaysPerRequest: row.minDaysPerRequest,
  maxDaysPerRequest: row.maxDaysPerRequest,
  allowWithOtherLeaves: row.allowWithOtherLeaves,
  priorEntryAllowed: row.priorEntryAllowed,
  noticeDays: row.noticeDays,
  allowCarryForward: row.allowCarryForward,
  weekOffSingleSideAllowed: row.weekOffSingleSideAllowed,
  weekOffBothSideAllowed: row.weekOffBothSideAllowed,
  holidaySingleSideAllowed: row.holidaySingleSideAllowed,
  holidayBothSideAllowed: row.holidayBothSideAllowed,
  maxPendingRequests: row.maxPendingRequests,
  status: row.status,
  sortOrder: row.sortOrder,
  nonClubbableWithIds: row.nonClubbableWith.map((item) => item.id),
})

export default function LeaveDefinitionDetailPage() {
  const canEdit = useCurrentResourceAction("edit")
  const canArchive = useCurrentResourceAction("archive")

  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params.id
  const [editOpen, setEditOpen] = React.useState(false)
  const [formError, setFormError] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [row, setRow] = React.useState<LeaveDefinitionRow | null>(null)
  const [values, setValues] = React.useState<LeaveDefinitionFormValues | null>(null)
  const [leaveOptions, setLeaveOptions] = React.useState<Array<{ value: string; label: string }>>([])
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()

  const load = React.useCallback(async () => {
    setLoading(true)
    const [definitionResponse, optionsResponse] = await Promise.all([
      fetch(`/api/leaves/definitions/${id}`, { cache: "no-store" }),
      fetch("/api/leaves/definitions?page=1&pageSize=100", { cache: "no-store" }),
    ])

    if (!definitionResponse.ok) {
      const data = (await definitionResponse.json().catch(() => ({}))) as { error?: string }
      toast.error(data.error ?? "Unable to load leave definition.")
      setLoading(false)
      return
    }

    const definitionData = (await definitionResponse.json()) as { item: LeaveDefinitionRow }
    setRow(definitionData.item)
    setValues(mapToFormValues(definitionData.item))

    if (optionsResponse.ok) {
      const optionsData = (await optionsResponse.json()) as { items?: LeaveDefinitionRow[] }
      setLeaveOptions(
        (optionsData.items ?? [])
          .filter((item) => item.id !== id)
          .map((item) => ({
            value: item.id,
            label: `${item.code} - ${item.name}`,
          }))
      )
    }

    setLoading(false)
  }, [id])

  React.useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!values) return
    setFormError(""); setSaving(true)
    try {
      clearErrors()
      const response = await fetch(`/api/leaves/definitions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string
          details?: { fieldErrors?: Record<string, string[]> }
        }
        setErrorsFromResponse(data)
        setFormError(data.error ?? "Unable to update leave definition."); toast.error(data.error ?? "Unable to update leave definition.")
        setSaving(false)
        return
      }
      const data = (await response.json()) as { item: LeaveDefinitionRow }
      setRow(data.item)
      setValues(mapToFormValues(data.item))
      toast.success("Leave definition updated."); setEditOpen(false)
      setSaving(false)
    } catch {
      setFormError("Unable to save. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setDeleting(true)
    try {
      const response = await fetch(`/api/leaves/definitions/${id}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        toast.error(data.error ?? "Unable to delete leave definition.")
        setDeleting(false)
        return
      }
      toast.success("Leave definition deleted.")
      router.push("/leaves")
    } catch {
      toast.error("Unable to complete this action. Please try again.")
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading leave definition...</p>
  }
  if (!row || !values) {
    return <p className="text-sm text-muted-foreground">Leave definition not found.</p>
  }

  return (
    <div className={pageClass}>
      <PageHeader title={row.name} description={<> Code: {row.code} </>} actions={<> <Button disabled={!canEdit} onClick={() => { setValues(mapToFormValues(row)); clearErrors(); setFormError(""); setEditOpen(true) }}>Edit details</Button> <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/leaves">Back to list</Link>
          </Button>
          <Button
            variant="destructive"
            disabled={!canArchive} onClick={() => setDeleteOpen(true)}
            loading={deleting}
            loadingText="Deleting..."
          >
            Delete
          </Button>
        </div> </>} />

      <LeaveDefinitionSummary row={row} />
      {canEdit && editOpen && <DraftPanel title="Edit leave definition" description="Update the configuration below." fingerprint={values} saving={saving} error={formError} onClose={() => { setValues(mapToFormValues(row)); setEditOpen(false) }} onSubmit={() => void save()}><LeaveDefinitionFormFields
          values={values}
          errors={errors}
          onChange={(updater) => setValues((prev) => (prev ? updater(prev) : prev))}
          leaveOptions={leaveOptions}
          disableCode={false}
        /></DraftPanel>}

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!deleting) setDeleteOpen(open)
        }}
      >
        <ActionDialogContent title={<>Delete leave definition</>} description={<>Delete &quot;{row.name}&quot;? This cannot be undone.
            </>} className="sm:max-w-md" actions={<> <Button
              variant="outline"
              disabled={deleting}
              onClick={() => setDeleteOpen(false)}
            >
              Cancel
            </Button><Button
              variant="destructive"
              onClick={remove}
              loading={deleting}
              loadingText="Deleting..."
            >
              Delete
            </Button> </>}></ActionDialogContent>
      </Dialog>
    </div>
  )
}
