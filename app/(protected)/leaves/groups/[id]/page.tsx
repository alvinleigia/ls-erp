"use client"
import { useCurrentResourceAction } from "@/platform/access/view-guard"

import { DraftPanel } from "@/components/erp/record-detail"
import { LeaveGroupSummary } from "@/app/(protected)/leaves/leave-record-summary"

import { ActionDialogContent } from "@/components/erp/action-dialog"

import { PageHeader, pageClass } from "@/components/erp/page"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"

import { LeaveGroupFormFields } from "@/app/(protected)/leaves/group-form-fields"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { useFormErrors } from "@/hooks/use-form-errors"
import type { LeaveDefinitionRow, LeaveGroupFormValues, LeaveGroupRow } from "@/types/leaves"

const toFormValues = (row: LeaveGroupRow): LeaveGroupFormValues => ({
  code: row.code,
  name: row.name,
  description: row.description ?? "",
  assignmentMode: row.assignmentMode,
  status: row.status,
  sortOrder: row.sortOrder,
  leaveDefinitionIds: row.leaveDefinitions.map((item) => item.id),
  staffIds: row.assignedStaff.map((item) => item.userId),
})

export default function LeaveGroupDetailPage() {
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
  const [row, setRow] = React.useState<LeaveGroupRow | null>(null)
  const [values, setValues] = React.useState<LeaveGroupFormValues | null>(null)
  const [leaveOptions, setLeaveOptions] = React.useState<Array<{ value: string; label: string }>>([])
  const [staffOptions, setStaffOptions] = React.useState<Array<{ value: string; label: string }>>([])
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()

  const load = React.useCallback(async () => {
    setLoading(true)
    const [groupResponse, leaveResponse, staffResponse] = await Promise.all([
      fetch(`/api/leaves/groups/${id}`, { cache: "no-store" }),
      fetch("/api/leaves/definitions?page=1&pageSize=100&status=ACTIVE", { cache: "no-store" }),
      fetch("/api/directory?role=STAFF&status=ACTIVE&page=1&pageSize=100", { cache: "no-store" }),
    ])
    if (!groupResponse.ok) {
      const data = (await groupResponse.json().catch(() => ({}))) as { error?: string }
      toast.error(data.error ?? "Unable to load leave group.")
      setLoading(false)
      return
    }
    const groupData = (await groupResponse.json()) as { item: LeaveGroupRow }
    setRow(groupData.item)
    setValues(toFormValues(groupData.item))

    if (leaveResponse.ok) {
      const leaveData = (await leaveResponse.json()) as { items?: LeaveDefinitionRow[] }
      setLeaveOptions(
        (leaveData.items ?? []).map((item) => ({
          value: item.id,
          label: `${item.code} - ${item.name}`,
        }))
      )
    }
    if (staffResponse.ok) {
      const staffData = (await staffResponse.json()) as {
        items?: Array<{ id: string; name: string | null; email: string }>
      }
      setStaffOptions(
        (staffData.items ?? []).map((item) => ({
          value: item.id,
          label: item.name?.trim() || item.email,
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
      const response = await fetch(`/api/leaves/groups/${id}`, {
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
        setFormError(data.error ?? "Unable to update leave group."); toast.error(data.error ?? "Unable to update leave group.")
        setSaving(false)
        return
      }
      const data = (await response.json()) as { item: LeaveGroupRow }
      setRow(data.item)
      setValues(toFormValues(data.item))
      toast.success("Leave group updated."); setEditOpen(false)
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
      const response = await fetch(`/api/leaves/groups/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        toast.error(data.error ?? "Unable to delete leave group.")
        setDeleting(false)
        return
      }
      toast.success("Leave group deleted.")
      router.push("/leaves/groups")
    } catch {
      toast.error("Unable to complete this action. Please try again.")
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading leave group...</p>
  if (!row || !values) return <p className="text-sm text-muted-foreground">Leave group not found.</p>

  return (
    <div className={pageClass}>
      <PageHeader title={row.name} description={<> Code: {row.code} </>} actions={<> <Button disabled={!canEdit} onClick={() => { setValues(toFormValues(row)); clearErrors(); setFormError(""); setEditOpen(true) }}>Edit details</Button> <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/leaves/groups">Back to groups</Link>
          </Button>
          <Button disabled={!canArchive} variant="destructive" onClick={() => setDeleteOpen(true)}>
            Delete
          </Button>
        </div> </>} />

      <LeaveGroupSummary row={row} />
      {canEdit && editOpen && <DraftPanel title="Edit leave group" description="Update the configuration below." fingerprint={values} saving={saving} error={formError} onClose={() => { setValues(toFormValues(row)); setEditOpen(false) }} onSubmit={() => void save()}><LeaveGroupFormFields
          values={values}
          errors={errors}
          onChange={(updater) => setValues((prev) => (prev ? updater(prev) : prev))}
          leaveOptions={leaveOptions}
          staffOptions={staffOptions}
        /></DraftPanel>}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <ActionDialogContent title={<>Delete leave group</>} description={<>Delete &quot;{row.name}&quot;? This cannot be undone.
            </>} className="sm:max-w-md" actions={<> <Button variant="outline" disabled={deleting} onClick={() => setDeleteOpen(false)}>
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
