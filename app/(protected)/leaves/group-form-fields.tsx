"use client"
import { useCurrentResourceAction } from "@/platform/access/view-guard"

import { Section } from "@/components/erp/section"

import { Select, Checkbox } from "@/components/erp/controls"

import * as React from "react"

import { FormField } from "@/components/form-field"
import { SearchableMultiSelect } from "@/components/searchable-multi-select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { LeaveGroupFormValues } from "@/types/leaves"
import { leaveGroupStatusOptions } from "./group-form-model"

type LeaveGroupFormFieldsProps = {
  values: LeaveGroupFormValues
  errors: Record<string, string>
  onChange: (updater: (prev: LeaveGroupFormValues) => LeaveGroupFormValues) => void
  leaveOptions: Array<{ value: string; label: string }>
  staffOptions: Array<{ value: string; label: string }>
  disableCode?: boolean
}

export function LeaveGroupFormFields({
  values,
  errors,
  onChange,
  leaveOptions,
  staffOptions,
  disableCode = false,
}: LeaveGroupFormFieldsProps) {
  const canArchive = useCurrentResourceAction("archive")
  return (
    <div className="space-y-5"><Section title="Group details"><div className="grid gap-4 md:grid-cols-2">
        <FormField id="code" label="Group code" error={errors.code}>
          <Input
            id="code"
            value={values.code}
            disabled={disableCode}
            onChange={(event) =>
              onChange((prev) => ({ ...prev, code: event.target.value.toUpperCase() }))
            }
            placeholder="DEFAULT_STAFF"
          />
        </FormField>
        <FormField id="name" label="Group name" error={errors.name}>
          <Input
            id="name"
            value={values.name}
            onChange={(event) => onChange((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="Default Staff Leave Group"
          />
        </FormField>
      </div>
<FormField id="description" label="Description" error={errors.description}>
        <Input
          id="description"
          value={values.description}
          onChange={(event) =>
            onChange((prev) => ({ ...prev, description: event.target.value }))
          }
          placeholder="Optional"
        />
      </FormField>
<div className="grid gap-4 md:grid-cols-2">
        <FormField id="status" label="Status" error={errors.status}>
          <Select disabled={!canArchive} id="status"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={values.status}
            onValueChange={(value) =>
              onChange((prev) => ({
                ...prev,
                status: value as LeaveGroupFormValues["status"],
              }))
            }
          >
            {leaveGroupStatusOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="sortOrder" label="Sort order" error={errors.sortOrder}>
          <Input
            id="sortOrder"
            type="number"
            min={0}
            max={9999}
            value={values.sortOrder}
            onChange={(event) =>
              onChange((prev) => ({
                ...prev,
                sortOrder: Number(event.target.value) || 0,
              }))
            }
          />
        </FormField>
      </div></Section>
<Section title="Leaves and staff"><FormField
        id="leaveDefinitionIds"
        label="Leaves in this group"
        error={errors.leaveDefinitionIds}
      >
        <SearchableMultiSelect
          id="leaveDefinitionIds"
          values={values.leaveDefinitionIds}
          onChange={(next) => onChange((prev) => ({ ...prev, leaveDefinitionIds: next }))}
          options={leaveOptions}
          placeholder="Select leave definitions"
          searchPlaceholder="Search leave definitions..."
        />
      </FormField>
<FormField
        id="assignmentMode"
        label="Staff assignment"
        error={errors.assignmentMode || errors.staffIds}
      >
        <div className="space-y-3 rounded-md border border-input bg-background p-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="assignmentMode"
              checked={values.assignmentMode === "ALL_STAFF"}
              onChange={(event) =>
                onChange((prev) => ({
                  ...prev,
                  assignmentMode: event.target.checked ? "ALL_STAFF" : "SELECTED_STAFF",
                  staffIds: event.target.checked ? [] : prev.staffIds,
                }))
              }
            />
            <Label htmlFor="assignmentMode">Make this the default leave group</Label>
          </div>

          {values.assignmentMode === "SELECTED_STAFF" ? (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Select one or more staff members.
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {staffOptions.map((staff) => {
                  const checked = values.staffIds.includes(staff.value)
                  return (
                    <label key={staff.value} className="flex items-center gap-2 text-sm"><Checkbox
                        checked={checked}
                        onChange={(event) =>
                          onChange((prev) => ({
                            ...prev,
                            staffIds: event.target.checked
                              ? [...prev.staffIds, staff.value]
                              : prev.staffIds.filter((value) => value !== staff.value),
                          }))
                        }
                      />
<span>{staff.label}</span></label>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              This group will be assigned to all active staff employees.
            </div>
          )}
        </div>
      </FormField></Section></div>
  )
}
