"use client"

import { useCurrentResourceAction } from "@/platform/access/view-guard"
import { FormField } from "@/components/form-field"
import { Select, Textarea } from "@/components/erp/controls"
import { Input } from "@/components/ui/input"
import type { CategoryFormValues } from "@/types/services"
import { categoryStatusOptions } from "./category-form-model"

type CategoryFormFieldsProps = {
  mode: "create" | "edit"
  values: CategoryFormValues
  errors: Record<string, string>
  onChange: (next: CategoryFormValues) => void
}

export function CategoryFormFields({
  mode,
  values,
  errors,
  onChange,
}: CategoryFormFieldsProps) {
  const canArchive = useCurrentResourceAction("archive")
  const fieldId = (name: string) => (mode === "create" ? `category-${name}` : `edit-${name}`)

  return (
    <div className="grid gap-4">
      <FormField id={fieldId("name")} label="Name" error={errors.name}>
        <Input
          id={fieldId("name")}
          required minLength={2} maxLength={100}
          value={values.name}
          onChange={(event) => onChange({ ...values, name: event.target.value })}
        />
      </FormField>
      <FormField
        id={fieldId("description")}
        label="Description"
        error={errors.description}
      >
        <Textarea
          maxLength={500}
          id={fieldId("description")}
          value={values.description}
          onChange={(event) => onChange({ ...values, description: event.target.value })}
        />
      </FormField>
      <FormField id={fieldId("status")} label="Status" error={errors.status}>
        <Select disabled={!canArchive}
          id={fieldId("status")}
          className="w-full"
          value={values.status}
          onValueChange={(value) =>
            onChange({ ...values, status: value as CategoryFormValues["status"] })
          }
        >
          {categoryStatusOptions.map((status) => (
            <option key={status} value={status}>
              {status === "ACTIVE" ? "Active" : "Inactive"}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField id={fieldId("order")} label="Sort order" error={errors.sortOrder}>
        <Input
          id={fieldId("order")}
          type="number"
          min={0}
          value={values.sortOrder}
          onChange={(event) =>
            onChange({
              ...values,
              sortOrder: Number(event.target.value) || 0,
            })
          }
        />
      </FormField>
    </div>
  )
}
