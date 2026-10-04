"use client"

import { Select } from "@/components/erp/controls"

import { FormField } from "@/components/form-field"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/searchable-select"
import { TimePicker } from "@/components/ui/time-picker"
import type {
  AppointmentStatus,
  AppointmentCustomerOption,
  AppointmentFormValues,
  AppointmentServiceOption,
  AppointmentStaffOption,
} from "@/types/appointments"
import type { TimeFormat } from "@/types/scheduling"

type AppointmentFormFieldsProps = {
  values: AppointmentFormValues
  errors: Record<string, string>
  customers: AppointmentCustomerOption[]
  services: AppointmentServiceOption[]
  staff: AppointmentStaffOption[]
  timeFormat?: TimeFormat
  canCancel?: boolean
  showStatus?: boolean
  disableParticipantFields?: boolean
  onChange: (next: AppointmentFormValues) => void
}

export function AppointmentFormFields({
  values,
  errors,
  customers,
  services,
  staff,
  timeFormat = "H24",
  canCancel = true,
  showStatus = false,
  disableParticipantFields = false,
  onChange,
}: AppointmentFormFieldsProps) {
  const update = <K extends keyof AppointmentFormValues>(
    key: K,
    value: AppointmentFormValues[K]
  ) => {
    onChange({ ...values, [key]: value })
  }

  return (
    <div className="grid gap-4">
      <FormField id="appointment-customer" label="Customer" error={errors.customerId}>
        <SearchableSelect
          id="appointment-customer"
          value={values.customerId}
          disabled={disableParticipantFields}
          placeholder="Select customer"
          searchPlaceholder="Search customer..."
          options={customers.map((customer) => ({
            value: customer.id,
            label: `${customer.name?.trim() || customer.email} (${customer.email})`,
          }))}
          onChange={(nextValue) => update("customerId", nextValue)}
        />
      </FormField>

      <FormField id="appointment-service" label="Service" error={errors.serviceId}>
        <SearchableSelect
          id="appointment-service"
          value={values.serviceId}
          disabled={disableParticipantFields}
          placeholder="Select service"
          searchPlaceholder="Search service..."
          options={services.map((service) => ({
            value: service.id,
            label: `${service.name} (${service.durationMinutes}m)`,
          }))}
          onChange={(nextValue) => update("serviceId", nextValue)}
        />
      </FormField>

      <FormField id="appointment-staff" label="Staff attendant" error={errors.staffId}>
        <SearchableSelect
          id="appointment-staff"
          value={values.staffId}
          disabled={disableParticipantFields}
          placeholder="Select staff"
          searchPlaceholder="Search staff..."
          options={staff.map((member) => ({
            value: member.id,
            label: member.name?.trim() || member.email,
          }))}
          onChange={(nextValue) => update("staffId", nextValue)}
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="appointment-date" label="Date" error={errors.date}>
          <Input
            id="appointment-date"
            type="date"
            value={values.date}
            onChange={(event) => update("date", event.target.value)}
          />
        </FormField>
        <FormField id="appointment-time" label="Start time" error={errors.startTime}>
          <TimePicker
            id="appointment-time"
            value={values.startTime}
            timeFormat={timeFormat}
            minuteStep={15}
            onChange={(nextValue) => update("startTime", nextValue)}
          />
        </FormField>
      </div>

      {showStatus ? (
        <FormField id="appointment-status" label="Status" error={errors.status}>
          <Select
            id="appointment-status"
            className="w-full"
            value={values.status}
            onValueChange={(value) => update("status", value as AppointmentStatus)}
          >
            <option value="SCHEDULED">SCHEDULED</option>
            <option value="CONFIRMED">CONFIRMED</option>
            <option value="IN_PROGRESS">IN_PROGRESS</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="CANCELED" disabled={!canCancel}>CANCELED</option>
            <option value="NO_SHOW">NO_SHOW</option>
          </Select>
        </FormField>
      ) : null}
    </div>
  )
}

