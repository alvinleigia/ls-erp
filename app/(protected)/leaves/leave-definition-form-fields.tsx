"use client"
import { useCurrentResourceAction } from "@/platform/access/view-guard"

import { Section } from "@/components/erp/section"

import { Select, Checkbox } from "@/components/erp/controls"

import * as React from "react"

import { FormField } from "@/components/form-field"
import { SearchableMultiSelect } from "@/components/searchable-multi-select"
import { Input } from "@/components/ui/input"
import type { LeaveDefinitionFormValues } from "@/types/leaves"
import {
  leaveAllowedUsersOptions,
  leaveDefinitionStatusOptions,
  leaveDefinitionTypeOptions,
} from "./leave-definition-form-model"

type LeaveDefinitionFormFieldsProps = {
  values: LeaveDefinitionFormValues
  errors: Record<string, string>
  onChange: (updater: (prev: LeaveDefinitionFormValues) => LeaveDefinitionFormValues) => void
  leaveOptions: Array<{ value: string; label: string }>
  disableCode?: boolean
}

export function LeaveDefinitionFormFields({
  values,
  errors,
  onChange,
  leaveOptions,
  disableCode = false,
}: LeaveDefinitionFormFieldsProps) {
  const canArchive = useCurrentResourceAction("archive")
  const handleCheckbox =
    (field: keyof LeaveDefinitionFormValues) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const checked = event.target.checked
      onChange((prev) => ({ ...prev, [field]: checked }))
    }

  const handleNumber =
    (field: keyof LeaveDefinitionFormValues) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = Number(event.target.value)
      onChange((prev) => ({ ...prev, [field]: Number.isNaN(next) ? 0 : next }))
    }

  return (
    <div className="space-y-5"><Section title="Leave details"><div className="grid gap-4 md:grid-cols-2">
        <FormField id="code" label="Leave code" error={errors.code}>
          <Input
            id="code"
            value={values.code}
            disabled={disableCode}
            onChange={(event) =>
              onChange((prev) => ({ ...prev, code: event.target.value.toUpperCase() }))
            }
            placeholder="CL"
          />
        </FormField>
        <FormField id="name" label="Leave name" error={errors.name}>
          <Input
            id="name"
            value={values.name}
            onChange={(event) => onChange((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="Casual Leave"
          />
        </FormField>
      </div>
<div className="grid gap-4 md:grid-cols-3">
        <FormField id="leaveType" label="Leave type" error={errors.leaveType}>
          <Select
            id="leaveType"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={values.leaveType}
            onValueChange={(value) =>
              onChange((prev) => ({ ...prev, leaveType: value as LeaveDefinitionFormValues["leaveType"] }))
            }
          >
            {leaveDefinitionTypeOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="allowedUsers" label="Allowed users" error={errors.allowedUsers}>
          <Select
            id="allowedUsers"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={values.allowedUsers}
            onValueChange={(value) =>
              onChange((prev) => ({ ...prev, allowedUsers: value as LeaveDefinitionFormValues["allowedUsers"] }))
            }
          >
            {leaveAllowedUsersOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="status" label="Status" error={errors.status}>
          <Select disabled={!canArchive} id="status"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={values.status}
            onValueChange={(value) =>
              onChange((prev) => ({ ...prev, status: value as LeaveDefinitionFormValues["status"] }))
            }
          >
            {leaveDefinitionStatusOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </FormField>
      </div></Section>
<Section title="Request limits"><div className="grid gap-4 md:grid-cols-3">
        <FormField
          id="minDaysPerRequest"
          label="Minimum allowed at a time"
          error={errors.minDaysPerRequest}
        >
          <Input
            id="minDaysPerRequest"
            type="number"
            min={0}
            max={365}
            value={values.minDaysPerRequest}
            onChange={handleNumber("minDaysPerRequest")}
          />
        </FormField>
        <FormField
          id="maxDaysPerRequest"
          label="Maximum allowed at a time"
          error={errors.maxDaysPerRequest}
        >
          <Input
            id="maxDaysPerRequest"
            type="number"
            min={1}
            max={365}
            value={values.maxDaysPerRequest}
            onChange={handleNumber("maxDaysPerRequest")}
          />
        </FormField>
        <FormField id="maxPendingRequests" label="Max pending requests" error={errors.maxPendingRequests}>
          <Input
            id="maxPendingRequests"
            type="number"
            min={1}
            max={50}
            value={values.maxPendingRequests}
            onChange={handleNumber("maxPendingRequests")}
          />
        </FormField>
      </div>
<div className="grid gap-4 md:grid-cols-2">
        <FormField id="noticeDays" label="Prior leave entry days" error={errors.noticeDays}>
          <Input
            id="noticeDays"
            type="number"
            min={0}
            max={365}
            value={values.noticeDays}
            onChange={handleNumber("noticeDays")}
          />
        </FormField>
        <FormField id="sortOrder" label="Sort order" error={errors.sortOrder}>
          <Input
            id="sortOrder"
            type="number"
            min={0}
            max={9999}
            value={values.sortOrder}
            onChange={handleNumber("sortOrder")}
          />
        </FormField>
      </div></Section>
<Section title="Combination and carry forward rules"><div className="grid gap-4 md:grid-cols-2">
        <FormField id="allowWithOtherLeaves" label="Allowed with other leaves" error={errors.allowWithOtherLeaves}>
          <label className="inline-flex h-9 items-center gap-2 text-sm">
            <Checkbox
              id="allowWithOtherLeaves"
              checked={values.allowWithOtherLeaves}
              onChange={handleCheckbox("allowWithOtherLeaves")}
            />
            <span>Enabled</span>
          </label>
        </FormField>
        <FormField id="priorEntryAllowed" label="Prior leave entry allowed" error={errors.priorEntryAllowed}>
          <label className="inline-flex h-9 items-center gap-2 text-sm">
            <Checkbox
              id="priorEntryAllowed"
              checked={values.priorEntryAllowed}
              onChange={handleCheckbox("priorEntryAllowed")}
            />
            <span>Enabled</span>
          </label>
        </FormField>
      </div>
<div className="grid gap-4 md:grid-cols-2">
        <FormField id="allowCarryForward" label="Balance carried to next year" error={errors.allowCarryForward}>
          <label className="inline-flex h-9 items-center gap-2 text-sm">
            <Checkbox
              id="allowCarryForward"
              checked={values.allowCarryForward}
              onChange={handleCheckbox("allowCarryForward")}
            />
            <span>Enabled</span>
          </label>
        </FormField>
        <FormField id="nonClubbableWithIds" label="Leaves which cannot be clubbed" error={errors.nonClubbableWithIds}>
          <SearchableMultiSelect
            id="nonClubbableWithIds"
            values={values.nonClubbableWithIds}
            onChange={(next) => onChange((prev) => ({ ...prev, nonClubbableWithIds: next }))}
            options={leaveOptions}
            placeholder="Select leave definitions"
            searchPlaceholder="Search leave definitions..."
          />
        </FormField>
      </div></Section>
<Section title="Week off and holiday rules"><div className="space-y-3">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            id="weekOffSingleSideAllowed"
            label="Week Off Allowed in case of Leave on Single Side"
            error={errors.weekOffSingleSideAllowed}
          >
            <label className="inline-flex h-9 items-center gap-2 text-sm">
              <Checkbox
                id="weekOffSingleSideAllowed"
                checked={values.weekOffSingleSideAllowed}
                onChange={handleCheckbox("weekOffSingleSideAllowed")}
              />
              <span>Enabled</span>
            </label>
          </FormField>
          <FormField
            id="holidaySingleSideAllowed"
            label="Holiday Allowed in case of Leave on Single Side"
            error={errors.holidaySingleSideAllowed}
          >
            <label className="inline-flex h-9 items-center gap-2 text-sm">
              <Checkbox
                id="holidaySingleSideAllowed"
                checked={values.holidaySingleSideAllowed}
                onChange={handleCheckbox("holidaySingleSideAllowed")}
              />
              <span>Enabled</span>
            </label>
          </FormField>
          <FormField
            id="weekOffBothSideAllowed"
            label="Week Off Allowed in case of Leave on Both Side"
            error={errors.weekOffBothSideAllowed}
          >
            <label className="inline-flex h-9 items-center gap-2 text-sm">
              <Checkbox
                id="weekOffBothSideAllowed"
                checked={values.weekOffBothSideAllowed}
                onChange={handleCheckbox("weekOffBothSideAllowed")}
              />
              <span>Enabled</span>
            </label>
          </FormField>
          <FormField
            id="holidayBothSideAllowed"
            label="Holiday Allowed in case of Leave on Both Side"
            error={errors.holidayBothSideAllowed}
          >
            <label className="inline-flex h-9 items-center gap-2 text-sm">
              <Checkbox
                id="holidayBothSideAllowed"
                checked={values.holidayBothSideAllowed}
                onChange={handleCheckbox("holidayBothSideAllowed")}
              />
              <span>Enabled</span>
            </label>
          </FormField>
        </div>
      </div></Section></div>
  )
}
