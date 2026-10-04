"use client"

import { PageHeader, pageClass, FormActions } from "@/components/erp/page"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { LeaveDefinitionFormFields } from "@/app/(protected)/leaves/leave-definition-form-fields"
import { defaultLeaveDefinitionFormValues } from "@/app/(protected)/leaves/leave-definition-form-model"
import { useFormErrors } from "@/hooks/use-form-errors"
import type { LeaveDefinitionFormValues, LeaveDefinitionRow } from "@/types/leaves"

export default function NewLeaveDefinitionPage() {
  const router = useRouter()
  const [values, setValues] = React.useState<LeaveDefinitionFormValues>(
    defaultLeaveDefinitionFormValues
  )
  const [formError, setFormError] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [leaveOptions, setLeaveOptions] = React.useState<Array<{ value: string; label: string }>>([])
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()

  React.useEffect(() => {
    const loadOptions = async () => {
      const response = await fetch("/api/leaves/definitions?page=1&pageSize=100", { cache: "no-store" })
      if (!response.ok) return
      const data = (await response.json()) as { items?: LeaveDefinitionRow[] }
      setLeaveOptions(
        (data.items ?? []).map((item) => ({
          value: item.id,
          label: `${item.code} - ${item.name}`,
        }))
      )
    }
    void loadOptions()
  }, [])

  const createDefinition = async () => {
    setFormError("")
    setSaving(true)
    try {
      clearErrors()
      const response = await fetch("/api/leaves/definitions", {
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
        setFormError(data.error ?? "Unable to create leave definition.")
        toast.error(data.error ?? "Unable to create leave definition.")
        setSaving(false)
        return
      }

      const data = (await response.json()) as { item: LeaveDefinitionRow }
      toast.success("Leave definition created.")
      router.push(`/leaves/${data.item.id}`)
    } catch {
      setFormError("Unable to save. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={pageClass}>
      <PageHeader title={<> New Leave Definition </>} description={<> Configure a leave definition without hardcoded leave categories. </>} actions={<FormActions form="leave-create" cancelHref="/leaves" saving={saving} saveLabel="Create leave definition" />} />

      {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
      <form id="leave-create" onSubmit={event => { event.preventDefault(); void createDefinition() }}><fieldset disabled={saving} className="min-w-0">
        <LeaveDefinitionFormFields
          values={values}
          errors={errors}
          onChange={(updater) => setValues((prev) => updater(prev))}
          leaveOptions={leaveOptions}
        />
      </fieldset></form>

    </div>
  )
}
