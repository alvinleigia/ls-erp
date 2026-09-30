"use client"

import { RecordSelect } from "@/modules/crm/components/record-select"
import * as React from "react"

import { FormField } from "@/components/form-field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { COUNTRY_OPTIONS, getStateOptionsByCountry } from "@/lib/constants/countries"
import type { Role } from "@/lib/permissions"
import type { UserFormValues } from "@/types/users"
import {
  genderOptions,
  roleOptions,
  statusOptions,
} from "./user-form-model"

type UserFormFieldsProps = {
  mode: "create" | "edit"
  values: UserFormValues
  errors: Record<string, string>
  onChange: (next: UserFormValues) => void
  canManage: boolean
  canEditProfile: boolean
}

export function UserFormFields({
  mode,
  values,
  errors,
  onChange,
  canManage,
  canEditProfile,
}: UserFormFieldsProps) {
  const canSelfEdit = mode === "create" ? true : canManage || canEditProfile
  const update = <K extends keyof UserFormValues>(key: K, value: UserFormValues[K]) => {
    onChange({ ...values, [key]: value, ...(key === "role" ? { accessRoleId: "" } : {}) })
  }
  const stateOptions = getStateOptionsByCountry(values.country)

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {mode === "create" && canManage && ["STAFF", "MANAGER"].includes(values.role) && <div className="space-y-2 sm:col-span-2"><Label htmlFor="new-user-access-role">Access role (optional)</Label><RecordSelect id="new-user-access-role" endpoint="/api/access/roles" value={values.accessRoleId || ""} onChange={value => update("accessRoleId", value)} placeholder="Existing account permissions" /><p className="text-xs text-muted-foreground">Restrict CRM, projects and sales documents. Manage roles in Settings &gt; Access roles.</p></div>}
      <FormField id={`${mode}-name`} label="Full name" error={errors.name}>
        <Input
          id={`${mode}-name`}
          value={values.name}
          onChange={(event) => update("name", event.target.value)}
          disabled={!canSelfEdit}
        />
      </FormField>
      <FormField id={`${mode}-email`} label="Email" error={errors.email}>
        <Input
          id={`${mode}-email`}
          type="email"
          value={values.email}
          onChange={(event) => update("email", event.target.value)}
          disabled={mode === "edit" && !canManage}
        />
      </FormField>
      <FormField id={`${mode}-phone`} label="Mobile" error={errors.phone}>
        <Input
          id={`${mode}-phone`}
          type="tel"
          value={values.phone}
          onChange={(event) => update("phone", event.target.value)}
          disabled={!canSelfEdit}
        />
      </FormField>
      <FormField
        id={`${mode}-image`}
        label="Profile image URL"
        error={errors.image}
      >
        <Input
          id={`${mode}-image`}
          type="url"
          value={values.image}
          onChange={(event) => update("image", event.target.value)}
          disabled={!canSelfEdit}
        />
      </FormField>
      <FormField
        id={`${mode}-dob`}
        label="Date of birth"
        error={errors.dateOfBirth}
      >
        <Input
          id={`${mode}-dob`}
          type="date"
          value={values.dateOfBirth}
          onChange={(event) => update("dateOfBirth", event.target.value)}
          disabled={!canSelfEdit}
        />
      </FormField>
      <FormField id={`${mode}-gender`} label="Gender" error={errors.gender}>
        <select
          id={`${mode}-gender`}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={values.gender}
          onChange={(event) => update("gender", event.target.value as UserFormValues["gender"])}
          disabled={!canSelfEdit}
        >
          {genderOptions.map((gender) => (
            <option key={gender} value={gender}>
              {gender.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </FormField>
      <FormField id={`${mode}-status`} label="Status" error={errors.status}>
        <select
          id={`${mode}-status`}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={values.status}
          onChange={(event) => update("status", event.target.value as UserFormValues["status"])}
          disabled={mode === "edit" && !canManage}
        >
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </FormField>
      <FormField id={`${mode}-role`} label="Role" error={errors.role}>
        <select
          id={`${mode}-role`}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={values.role}
          onChange={(event) => {
            const role = event.target.value as Role
            onChange({
              ...values,
              role,
              marketingOptIn: role === "STAFF" ? false : values.marketingOptIn,
            })
          }}
          disabled={mode === "edit" && !canManage}
        >
          {roleOptions.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </FormField>
      <FormField
        id={`${mode}-password`}
        label={mode === "create" ? "Temporary password" : "Reset password (optional)"}
        error={errors.password}
        className="sm:col-span-2"
      >
        <Input
          id={`${mode}-password`}
          type="password"
          value={values.password}
          onChange={(event) => update("password", event.target.value)}
          disabled={mode === "edit" && !canManage}
        />
      </FormField>
      <div className="space-y-2 sm:col-span-2">
        <Label>Address</Label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            placeholder="Address line 1"
            value={values.addressLine1}
            onChange={(event) => update("addressLine1", event.target.value)}
            disabled={!canSelfEdit}
          />
          <Input
            placeholder="Address line 2"
            value={values.addressLine2}
            onChange={(event) => update("addressLine2", event.target.value)}
            disabled={!canSelfEdit}
          />
          <Input
            placeholder="City"
            value={values.city}
            onChange={(event) => update("city", event.target.value)}
            disabled={!canSelfEdit}
          />
          <Input
            placeholder="Postal code"
            value={values.postalCode}
            onChange={(event) => update("postalCode", event.target.value)}
            disabled={!canSelfEdit}
          />
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={values.country}
            onChange={(event) => {
              const country = event.target.value
              const nextStateOptions = getStateOptionsByCountry(country)
              const shouldResetState = Boolean(
                nextStateOptions && values.state && !nextStateOptions.includes(values.state)
              )
              onChange({
                ...values,
                country,
                state: shouldResetState ? "" : values.state,
              })
            }}
            disabled={!canSelfEdit}
          >
            <option value="">Select country</option>
            {COUNTRY_OPTIONS.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
          {stateOptions ? (
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={values.state}
              onChange={(event) => update("state", event.target.value)}
              disabled={!canSelfEdit}
            >
              <option value="">Select state/province</option>
              {stateOptions.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          ) : (
            <Input
              placeholder="State / province / region"
              value={values.state}
              onChange={(event) => update("state", event.target.value)}
              disabled={!canSelfEdit}
            />
          )}
        </div>
      </div>
      {values.role !== "STAFF" ? (
        <div className="sm:col-span-2 flex items-center gap-2">
          <input
            id={`${mode}-marketing`}
            type="checkbox"
            checked={values.marketingOptIn}
            onChange={(event) => update("marketingOptIn", event.target.checked)}
            disabled={!canSelfEdit}
          />
          <Label htmlFor={`${mode}-marketing`}>Marketing opt-in</Label>
        </div>
      ) : null}
    </div>
  )
}
