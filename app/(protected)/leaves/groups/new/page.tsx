"use client"

import { PageHeader, pageClass, FormActions } from "@/components/erp/page"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { LeaveGroupFormFields } from "@/app/(protected)/leaves/group-form-fields"
import { defaultLeaveGroupFormValues } from "@/app/(protected)/leaves/group-form-model"
import { useFormErrors } from "@/hooks/use-form-errors"
import type { LeaveDefinitionRow, LeaveGroupFormValues } from "@/types/leaves"

type StaffOption = { value: string; label: string }

export default function NewLeaveGroupPage() {
  const router = useRouter()
  const [values, setValues] = React.useState<LeaveGroupFormValues>(defaultLeaveGroupFormValues)
  const [formError, setFormError] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [leaveOptions, setLeaveOptions] = React.useState<Array<{ value: string; label: string }>>([])
  const [staffOptions, setStaffOptions] = React.useState<StaffOption[]>([])
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()

  React.useEffect(() => {
    const loadOptions = async () => {
      const [leaveResponse, staffResponse] = await Promise.all([
        fetch("/api/leaves/definitions?page=1&pageSize=100&status=ACTIVE", { cache: "no-store" }),
        fetch("/api/directory?role=STAFF&status=ACTIVE&page=1&pageSize=100", { cache: "no-store" }),
      ])
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
    }
    void loadOptions()
  }, [])

  const createGroup = async () => {
    setFormError("")
    setSaving(true)
    try {
      clearErrors()
      const response = await fetch("/api/leaves/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string
          details?: { fieldErrors?: Record<string, string[]> }
        }
        setErrorsFromResponse(data)
        setFormError(data.error ?? "Unable to create leave group.")
        toast.error(data.error ?? "Unable to create leave group.")
        setSaving(false)
        return
      }
      const data = (await response.json()) as { item: { id: string } }
      toast.success("Leave group created.")
      router.push(`/leaves/groups/${data.item.id}`)
    } catch {
      setFormError("Unable to save. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={pageClass}>
      <PageHeader title={<> New Leave Group </>} description={<> Add leaves to a group and assign it to all or selected employees. </>} actions={<FormActions form="leave-create" cancelHref="/leaves/groups" saving={saving} saveLabel="Create leave group" />} />

      {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
      <form id="leave-create" onSubmit={event => { event.preventDefault(); void createGroup() }}><fieldset disabled={saving} className="min-w-0">
        <LeaveGroupFormFields
          values={values}
          errors={errors}
          onChange={(updater) => setValues((prev) => updater(prev))}
          leaveOptions={leaveOptions}
          staffOptions={staffOptions}
        />
      </fieldset></form>

    </div>
  )
}
