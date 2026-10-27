"use client"

import { FormField } from "@/components/form-field"
import { Input } from "@/components/ui/input"
import type { Role } from "@/lib/permissions"
import type { InviteFormValues } from "./invite-form-model"
import { inviteRoleOptions } from "./invite-form-model"
import { ProfilePicker } from "@/platform/access/profile-picker"

type InviteFormFieldsProps = {
  values: InviteFormValues
  errors: Record<string, string>
  onChange: (next: InviteFormValues) => void
}

export function InviteFormFields({ values, errors, onChange }: InviteFormFieldsProps) {
  const update = <K extends keyof InviteFormValues>(key: K, value: InviteFormValues[K]) => {
    onChange({ ...values, [key]: value })
  }

  return (
    <div className="grid gap-4">
      <FormField id="invite-email" label="Email" error={errors.email}>
        <Input
          id="invite-email"
          type="email"
          value={values.email}
          onChange={(event) => update("email", event.target.value)}
        />
      </FormField>
      <FormField id="invite-role" label="Role" error={errors.role}>
        <select
          id="invite-role"
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={values.role}
          onChange={(event) => onChange({ ...values, role: event.target.value as Role, accessRoleIds: [], officeAccess: event.target.value === "CUSTOMER" ? undefined : values.officeAccess })}
        >
          {inviteRoleOptions.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </FormField>
      {["STAFF", "MANAGER"].includes(values.role) && <ProfilePicker id="invite-profiles" value={values.accessRoleIds} onChange={ids => update("accessRoleIds", ids)} />}
      <FormField id="invite-delivery" label="Delivery" error={errors.delivery}>
        <select id="invite-delivery" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={values.delivery} onChange={event => update("delivery", event.target.value as InviteFormValues["delivery"])}>
          <option value="EMAIL">Send email</option>
          <option value="LINK">Create link</option>
        </select>
      </FormField>
    </div>
  )
}

