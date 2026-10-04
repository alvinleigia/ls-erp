"use client"
import { useCurrentResourceAction } from "@/platform/access/view-guard"

import { Section } from "@/components/erp/section"

import { Select } from "@/components/erp/controls"

import { FormField } from "@/components/form-field"
import { Trash2Icon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { TimePicker } from "@/components/ui/time-picker"
import type { TimeFormat } from "@/types/scheduling"
import type { ShiftTemplateBreak, ShiftTemplateForm } from "@/types/shifts"
import { templateStatusOptions } from "./template-form-model"

type TemplateFormFieldsProps = {
  mode: "create" | "edit"
  template: ShiftTemplateForm
  errors: Record<string, string>
  timeFormat?: TimeFormat
  minStart: string
  maxEnd: string
  onChange: (next: ShiftTemplateForm) => void
  onAddBreak: () => void
  onUpdateBreak: (
    breakIndex: number,
    updater: (period: ShiftTemplateBreak) => ShiftTemplateBreak
  ) => void
  onRemoveBreak: (breakIndex: number) => void
}

export function TemplateFormFields({
  mode,
  template,
  errors,
  timeFormat = "H24",
  minStart,
  maxEnd,
  onChange,
  onAddBreak,
  onUpdateBreak,
  onRemoveBreak,
}: TemplateFormFieldsProps) {
  const canArchive = useCurrentResourceAction("archive")
  const fieldId = (name: string) => (mode === "create" ? name : `edit-${name}`)

  return (
    <div className="space-y-5"><Section title="Template details"><div className="grid gap-4 sm:grid-cols-2">
        <FormField id={fieldId("template-name")} label="Name" error={errors.name}>
          <Input
            id={fieldId("template-name")}
            value={template.name}
            onChange={(event) => onChange({ ...template, name: event.target.value })}
          />
        </FormField>
        <FormField
          id={fieldId("template-description")}
          label="Description"
          error={errors.description}
        >
          <Input
            id={fieldId("template-description")}
            value={template.description}
            onChange={(event) =>
              onChange({ ...template, description: event.target.value })
            }
          />
        </FormField>
        <FormField id={fieldId("template-color")} label="Color" error={errors.color}>
          <Input
            id={fieldId("template-color")}
            type="color"
            value={template.color}
            onChange={(event) => onChange({ ...template, color: event.target.value })}
          />
        </FormField>
        <FormField id={fieldId("template-status")} label="Status" error={errors.isActive}>
          <Select disabled={!canArchive} id={fieldId("template-status")}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={template.isActive ? "ACTIVE" : "INACTIVE"}
            onValueChange={(value) =>
              onChange({ ...template, isActive: value === "ACTIVE" })
            }
          >
            {templateStatusOptions.map((status) => (
              <option key={status} value={status}>
                {status === "ACTIVE" ? "Active" : "Inactive"}
              </option>
            ))}
          </Select>
        </FormField>
      </div></Section>
<Section title="Shift timing"><div className="rounded-lg border p-4">
        <h3 className="text-sm font-medium">Shift timing</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <FormField id={fieldId("shift-start")} label="Start" error={errors.startTime}>
            <TimePicker
              id={fieldId("shift-start")}
              timeFormat={timeFormat}
              min={minStart}
              max={maxEnd}
              value={template.startTime}
              onChange={(nextValue) => onChange({ ...template, startTime: nextValue })}
            />
          </FormField>
          <FormField id={fieldId("shift-end")} label="End" error={errors.endTime}>
            <TimePicker
              id={fieldId("shift-end")}
              timeFormat={timeFormat}
              min={minStart}
              max={maxEnd}
              value={template.endTime}
              onChange={(nextValue) => onChange({ ...template, endTime: nextValue })}
            />
          </FormField>
        </div>
      </div></Section>
<Section title="Breaks" description="Optional breaks within the shift range."><div>
        <div className="flex items-center justify-between">

          <button
            type="button"
            className="text-sm text-primary hover:underline"
            onClick={onAddBreak}
          >
            Add break
          </button>
        </div>

        <div className="mt-3 space-y-3">
          {template.breaks.map((period, index) => (
            <div
              key={`${mode}-break-${index}`}
              className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
            >
              <FormField id={fieldId(`break-start-${index}`)} label="Start">
                <TimePicker
                  id={fieldId(`break-start-${index}`)}
                  timeFormat={timeFormat}
                  min={template.startTime}
                  max={template.endTime}
                  value={period.startTime}
                  onChange={(nextValue) =>
                    onUpdateBreak(index, (existing) => ({
                      ...existing,
                      startTime: nextValue,
                    }))
                  }
                />
              </FormField>
              <FormField id={fieldId(`break-end-${index}`)} label="End">
                <TimePicker
                  id={fieldId(`break-end-${index}`)}
                  timeFormat={timeFormat}
                  min={template.startTime}
                  max={template.endTime}
                  value={period.endTime}
                  onChange={(nextValue) =>
                    onUpdateBreak(index, (existing) => ({
                      ...existing,
                      endTime: nextValue,
                    }))
                  }
                />
              </FormField>
              <div className="flex items-end">
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input hover:bg-muted"
                  aria-label="Remove break"
                  onClick={() => onRemoveBreak(index)}
                >
                  <Trash2Icon className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {errors.breaks ? (
          <p className="mt-2 text-xs text-destructive">{errors.breaks}</p>
        ) : null}
      </div>
{errors.form ? <p className="text-xs text-destructive">{errors.form}</p> : null}</Section></div>
  )
}

