"use client"
import { SectionTabs } from "@/components/erp/section-tabs"
import { enumLabel } from "@/lib/enum-label"

import { FormField } from "@/components/form-field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { COUNTRY_OPTIONS, getStateOptionsByCountry } from "@/lib/constants/countries"
import type { ProfileFormValues } from "@/types/users"
import { profileGenderOptions } from "./profile-form-model"

type ProfileFormFieldsProps = {
  values: ProfileFormValues
  errors: Record<string, string>
  onChange: (next: ProfileFormValues) => void
}

export function ProfileFormFields({ values, errors, onChange }: ProfileFormFieldsProps) {
  const update = <K extends keyof ProfileFormValues>(key: K, value: ProfileFormValues[K]) => {
    onChange({ ...values, [key]: value })
  }
  const stateOptions = getStateOptionsByCountry(values.country)

  return (
    <div className="space-y-5">
<SectionTabs scope="profile-form" keepMounted validationErrors={errors} tabs={[
{ value: "overview", label: "Personal details", content: <div className="grid gap-4 sm:grid-cols-2"><FormField id="me-name" label="Full name" error={errors.name}>
        <Input
          id="me-name"
          value={values.name}
          onChange={(event) => update("name", event.target.value)}
        />
      </FormField>
<FormField id="me-email" label="Email">
        <Input id="me-email" value={values.email} disabled />
      </FormField>
<FormField id="me-phone" label="Mobile" error={errors.phone}>
        <Input
          id="me-phone"
          type="tel"
          value={values.phone}
          onChange={(event) => update("phone", event.target.value)}
        />
      </FormField>
<FormField id="me-image" label="Profile image URL" error={errors.image}>
        <Input
          id="me-image"
          type="url"
          value={values.image}
          onChange={(event) => update("image", event.target.value)}
        />
      </FormField>
<FormField id="me-dob" label="Date of birth" error={errors.dateOfBirth}>
        <Input
          id="me-dob"
          type="date"
          value={values.dateOfBirth}
          onChange={(event) => update("dateOfBirth", event.target.value)}
        />
      </FormField>
<FormField id="me-gender" label="Gender" error={errors.gender}>
        <select
          id="me-gender"
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={values.gender}
          onChange={(event) => update("gender", event.target.value as ProfileFormValues["gender"])}
        >
          {profileGenderOptions.map((gender) => (
            <option key={gender} value={gender}>{enumLabel(gender)}</option>
          ))}
        </select>
      </FormField></div> },
{ value: "address", label: "Address and preferences", content: <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2 sm:col-span-2">
        <Label>Address</Label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            placeholder="Address line 1"
            value={values.addressLine1}
            onChange={(event) => update("addressLine1", event.target.value)}
          />
          <Input
            placeholder="Address line 2"
            value={values.addressLine2}
            onChange={(event) => update("addressLine2", event.target.value)}
          />
          <Input
            placeholder="City"
            value={values.city}
            onChange={(event) => update("city", event.target.value)}
          />
          <Input
            placeholder="Postal code"
            value={values.postalCode}
            onChange={(event) => update("postalCode", event.target.value)}
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
            />
          )}
        </div>
      </div>
<div className="sm:col-span-2 flex items-center gap-2">
        <input
          id="me-marketing"
          type="checkbox"
          checked={values.marketingOptIn}
          onChange={(event) => update("marketingOptIn", event.target.checked)}
        />
        <Label htmlFor="me-marketing">Marketing opt-in</Label>
      </div></div> }
]} />
</div>
  )
}
