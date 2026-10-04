"use client"
import { Section } from "@/components/erp/section"

import { Select, Checkbox } from "@/components/erp/controls"

import * as React from "react"
import { Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormField } from "@/components/form-field"
import { SearchableSelect } from "@/components/searchable-select"
import { WEEKDAY_OPTIONS } from "@/types/scheduling"
import type { Weekday } from "@/types/scheduling"
import type {
  ShiftScheduleForm,
  ShiftTemplateOption,
  StaffOption,
} from "@/types/shifts"

type ScheduleFormFieldsProps = {
  mode: "create" | "edit"
  form: ShiftScheduleForm
  setForm: React.Dispatch<React.SetStateAction<ShiftScheduleForm>>
  errors: Record<string, string>
  allowMultiStaff: boolean
  today: string
  staffOptions: StaffOption[]
  templates: ShiftTemplateOption[]
}

export function ScheduleFormFields({
  mode,
  form,
  setForm,
  errors,
  allowMultiStaff,
  today,
  staffOptions,
  templates,
}: ScheduleFormFieldsProps) {
  const addBlock = () => {
    setForm((prev) => ({
      ...prev,
      blocks: [...prev.blocks, { templateId: "", repeatDays: 1 }],
    }))
  }

  const updateBlock = (
    blockIndex: number,
    updater: (block: ShiftScheduleForm["blocks"][number]) => ShiftScheduleForm["blocks"][number]
  ) => {
    setForm((prev) => ({
      ...prev,
      blocks: prev.blocks.map((block, index) =>
        index === blockIndex ? updater(block) : block
      ),
    }))
  }

  const removeBlock = (blockIndex: number) => {
    setForm((prev) => ({
      ...prev,
      blocks: prev.blocks.filter((_, index) => index !== blockIndex),
    }))
  }

  const weekOff2Enabled = Boolean(form.weekOffDay2)
  const fieldId = (name: string) => (mode === "create" ? name : `edit-${name}`)

  return (
    <div className="space-y-5"><Section title="Schedule and assignment"><FormField id={fieldId("schedule-name")} label="Schedule name" error={errors.name}>
        <Input
          id={fieldId("schedule-name")}
          value={form.name}
          onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
        />
      </FormField>
<div className="flex items-center gap-2">
        <Checkbox
          id={fieldId("schedule-default")}
          checked={form.isDefault}
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              isDefault: event.target.checked,
              staffIds: event.target.checked ? [] : prev.staffIds,
            }))
          }
        />
        <Label htmlFor={fieldId("schedule-default")}>Make this the default schedule</Label>
      </div>
<FormField id={fieldId("schedule-staff")} label="Staff" error={errors.staffIds}>
        {form.isDefault ? (
          <div className="rounded-md border border-dashed border-input bg-background p-3 text-xs text-muted-foreground">
            Default schedules apply to all staff without an explicit schedule.
          </div>
        ) : allowMultiStaff ? (
          <div className="space-y-2 rounded-md border border-input bg-background p-3">
            <div className="text-xs text-muted-foreground">
              Select one or more staff members.
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {staffOptions.map((staff) => {
                const label = staff.name?.trim() || staff.email
                const checked = form.staffIds.includes(staff.id)
                return (
                  <label key={staff.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={checked}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          staffIds: event.target.checked
                            ? [...prev.staffIds, staff.id]
                            : prev.staffIds.filter((value) => value !== staff.id),
                        }))
                      }
                    />
                    <span>{label}</span>
                  </label>
                )
              })}
            </div>
          </div>
        ) : (
          <SearchableSelect
            id={fieldId("schedule-staff")}
            value={form.staffIds[0] ?? ""}
            placeholder="Select staff"
            searchPlaceholder="Search staff..."
            options={staffOptions.map((staff) => ({
              value: staff.id,
              label: staff.name?.trim() || staff.email,
            }))}
            onChange={(nextValue) =>
              setForm((prev) => ({
                ...prev,
                staffIds: nextValue ? [nextValue] : [],
              }))
            }
            />
        )}
        {!form.isDefault ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Flexible-mode staff are managed in flexible weekly/recurring plans, not shift schedules.
          </p>
        ) : null}
      </FormField>
{!form.isDefault ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id={fieldId("schedule-assign-start")}
            label="Assignment start date"
            error={errors.assignmentStartDate}
          >
            <Input
              id={fieldId("schedule-assign-start")}
              type="date"
              value={form.assignmentStartDate}
              min={today}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, assignmentStartDate: event.target.value }))
              }
            />
          </FormField>
          <FormField
            id={fieldId("schedule-assign-end")}
            label="Assignment end date"
            error={errors.assignmentEndDate}
          >
            <Input
              id={fieldId("schedule-assign-end")}
              type="date"
              value={form.assignmentEndDate}
              min={form.assignmentStartDate || today}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, assignmentEndDate: event.target.value }))
              }
            />
          </FormField>
        </div>
      ) : null}
<FormField id={fieldId("schedule-start")} label="Start date" error={errors.startDate}>
        <Input
          id={fieldId("schedule-start")}
          type="date"
          value={form.startDate}
          min={today}
          onChange={(event) =>
            setForm((prev) => {
              const next = event.target.value
              return {
                ...prev,
                startDate: next,
                assignmentStartDate:
                  !prev.assignmentStartDate || prev.assignmentStartDate === prev.startDate
                    ? next
                    : prev.assignmentStartDate,
              }
            })
          }
        />
      </FormField></Section>
<Section title="Week off rules"><div className="grid gap-4 sm:grid-cols-2">
        <FormField id={fieldId("schedule-weekoff-1")} label="Week off day 1" error={errors.weekOffDay1}>
          <Select
            id={fieldId("schedule-weekoff-1")}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.weekOffDay1}
            onValueChange={(value) =>
              setForm((prev) => ({
                ...prev,
                weekOffDay1: value as Weekday,
              }))
            }
          >
            {WEEKDAY_OPTIONS.map((day) => (
              <option key={day.value} value={day.value}>
                {day.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id={fieldId("schedule-weekoff-2")} label="Week off day 2" error={errors.weekOffDay2}>
          <Select
            id={fieldId("schedule-weekoff-2")}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.weekOffDay2}
            onValueChange={(nextValue) => {
              const value = nextValue as Weekday | ""
              setForm((prev) => ({
                ...prev,
                weekOffDay2: value,
                weekOff2Weeks: value
                  ? prev.weekOff2Weeks.length
                    ? prev.weekOff2Weeks
                    : [1, 2, 3, 4, 5]
                  : [],
              }))
            }}
          >
            <option value="">None</option>
            {WEEKDAY_OPTIONS.map((day) => (
              <option key={day.value} value={day.value}>
                {day.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
<div className="space-y-2 rounded-md border border-input bg-background p-3">
        <div className="flex items-center justify-between">
          <Label>Week off day 2 weeks</Label>
          <span className="text-xs text-muted-foreground">Weeks of the month.</span>
        </div>
        <div className="flex flex-wrap gap-3">
          {[1, 2, 3, 4, 5].map((week) => (
            <label key={week} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.weekOff2Weeks.includes(week)}
                disabled={!weekOff2Enabled}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    weekOff2Weeks: event.target.checked
                      ? [...prev.weekOff2Weeks, week]
                      : prev.weekOff2Weeks.filter((value) => value !== week),
                  }))
                }
              />
              Week {week}
            </label>
          ))}
        </div>
        {errors.weekOff2Weeks ? (
          <p className="text-xs text-destructive">{errors.weekOff2Weeks}</p>
        ) : null}
      </div></Section>
<Section title="Repeating blocks"><div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>Shift blocks</Label>
          <span className="text-xs text-muted-foreground">
            Repeat days count ignores week off days.
          </span>
        </div>
        <div className="space-y-3">
          {form.blocks.map((block, index) => (
            <div
              key={`${mode}-block-${index}`}
              className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end"
            >
              <FormField
                id={fieldId(`block-template-${index}`)}
                label={`Shift template ${index + 1}`}
              >
                <SearchableSelect
                  id={fieldId(`block-template-${index}`)}
                  value={block.templateId}
                  placeholder="Select template"
                  searchPlaceholder="Search template..."
                  options={templates.map((template) => ({
                    value: template.id,
                    label: template.name,
                  }))}
                  onChange={(nextValue) =>
                    updateBlock(index, (current) => ({
                      ...current,
                      templateId: nextValue,
                    }))
                  }
                />
              </FormField>
              <FormField id={fieldId(`block-repeat-${index}`)} label="Repeat days">
                <Input
                  type="number"
                  min={1}
                  value={block.repeatDays}
                  onChange={(event) =>
                    updateBlock(index, (current) => ({
                      ...current,
                      repeatDays: Number(event.target.value || 1),
                    }))
                  }
                />
              </FormField>
              <Button type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Remove shift block"
                onClick={() => removeBlock(index)}
              >
                <Trash2Icon className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        {errors.blocks ? <p className="text-xs text-destructive">{errors.blocks}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={addBlock}>
            Add shift block
          </Button>
        </div>
      </div></Section></div>
  )
}
