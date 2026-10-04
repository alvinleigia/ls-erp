"use client"
import { useCurrentResourceAction } from "@/platform/access/view-guard"

import * as React from "react"
import { toast } from "sonner"
import { Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TimePicker } from "@/components/ui/time-picker"
import { FormField } from "@/components/form-field"
import { Label } from "@/components/ui/label"
import { useFormErrors } from "@/hooks/use-form-errors"
import {
  CURRENCY_OPTIONS,
  LOCALE_OPTIONS,
  TIME_ZONE_OPTIONS,
} from "@/lib/constants/localization"
import {
  CURRENCY_SYMBOL_PLACEMENT_OPTIONS,
  DATE_FORMAT_OPTIONS,
  NUMBER_FORMAT_OPTIONS,
  TIME_FORMAT_OPTIONS,
  WEEKDAY_OPTIONS,
} from "@/types/scheduling"
import type {
  AppSettingsPayload,
  DateOverrideDay,
  EmailDeliveryStatus,
  WorkingDay,
  WorkingPeriod,
} from "@/types/scheduling"
import {
  DEFAULT_PERIOD,
  defaultSettings,
  normalizeOverrides,
  normalizeWorkingHours,
  type SettingsForm,
} from "./settings-form-model"

export default function SettingsPage() {
  const canEdit = useCurrentResourceAction("edit")
  const InlineField = ({
    label,
    children,
  }: {
    label: string
    children: React.ReactNode
  }) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState<SettingsForm>(defaultSettings)
  const [emailDelivery, setEmailDelivery] = React.useState<EmailDeliveryStatus | null>(null)
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()
  const localeOptions = React.useMemo(() => {
    if (LOCALE_OPTIONS.some((option) => option.value === form.locale)) {
      return LOCALE_OPTIONS
    }
    return [{ value: form.locale, label: `${form.locale} (Custom)` }, ...LOCALE_OPTIONS]
  }, [form.locale])
  const currencyOptions = React.useMemo(() => {
    if (CURRENCY_OPTIONS.some((option) => option.value === form.currency)) {
      return CURRENCY_OPTIONS
    }
    return [{ value: form.currency, label: `${form.currency} (Custom)` }, ...CURRENCY_OPTIONS]
  }, [form.currency])
  const timeZoneOptions = React.useMemo(() => {
    if (TIME_ZONE_OPTIONS.some((option) => option.value === form.timeZone)) {
      return TIME_ZONE_OPTIONS
    }
    return [{ value: form.timeZone, label: `${form.timeZone} (Custom)` }, ...TIME_ZONE_OPTIONS]
  }, [form.timeZone])

  React.useEffect(() => {
    const load = async () => {
      setLoading(true)
      const response = await fetch("/api/settings", { cache: "no-store" })
      if (!response.ok) {
        toast.error("Unable to load settings.")
        setLoading(false)
        return
      }
      const data = (await response.json()) as {
        settings?: AppSettingsPayload
        emailDelivery?: EmailDeliveryStatus
      }
      const settings = data.settings ?? {}
      setEmailDelivery(data.emailDelivery ?? null)
      setForm({
        ...defaultSettings,
        ...settings,
        workingHours: normalizeWorkingHours(settings.workingHours ?? defaultSettings.workingHours),
        overrides: normalizeOverrides(settings.overrides ?? defaultSettings.overrides),
      })
      setLoading(false)
    }
    void load()
  }, [])

  const updateField = (key: keyof SettingsForm, value: string | number | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const updateWorkingDay = (
    dayIndex: number,
    updater: (day: WorkingDay) => WorkingDay
  ) => {
    setForm((prev) => ({
      ...prev,
      workingHours: prev.workingHours.map((day, index) =>
        index === dayIndex ? updater(day) : day
      ),
    }))
  }

  const updatePeriod = (
    dayIndex: number,
    periodIndex: number,
    updater: (period: WorkingPeriod) => WorkingPeriod
  ) => {
    updateWorkingDay(dayIndex, (day) => ({
      ...day,
      periods: day.periods.map((period, index) =>
        index === periodIndex ? updater(period) : period
      ),
    }))
  }

  const addPeriod = (dayIndex: number, kind: WorkingPeriod["kind"]) => {
    updateWorkingDay(dayIndex, (day) => ({
      ...day,
      periods: [
        ...day.periods,
        {
          kind,
          startTime: "09:00",
          endTime: "18:00",
        },
      ],
    }))
  }

  const removePeriod = (dayIndex: number, periodIndex: number) => {
    updateWorkingDay(dayIndex, (day) => ({
      ...day,
      periods: day.periods.filter((_, index) => index !== periodIndex),
    }))
  }

  const updateOverride = (
    overrideIndex: number,
    updater: (override: DateOverrideDay) => DateOverrideDay
  ) => {
    setForm((prev) => ({
      ...prev,
      overrides: prev.overrides.map((override, index) =>
        index === overrideIndex ? updater(override) : override
      ),
    }))
  }

  const updateOverridePeriod = (
    overrideIndex: number,
    periodIndex: number,
    updater: (period: WorkingPeriod) => WorkingPeriod
  ) => {
    updateOverride(overrideIndex, (override) => ({
      ...override,
      periods: override.periods.map((period, index) =>
        index === periodIndex ? updater(period) : period
      ),
    }))
  }

  const addOverride = () => {
    const today = new Date().toISOString().slice(0, 10)
    if (form.overrides.some((override) => override.date === today)) {
      toast.error("An override for today already exists.")
      return
    }
    setForm((prev) => ({
      ...prev,
      overrides: [
        ...prev.overrides,
        {
          date: today,
          isOpen: true,
          periods: [{ ...DEFAULT_PERIOD }],
        },
      ],
    }))
  }

  const removeOverride = (overrideIndex: number) => {
    setForm((prev) => ({
      ...prev,
      overrides: prev.overrides.filter((_, index) => index !== overrideIndex),
    }))
  }

  const addOverridePeriod = (overrideIndex: number, kind: WorkingPeriod["kind"]) => {
    updateOverride(overrideIndex, (override) => ({
      ...override,
      periods: [
        ...override.periods,
        {
          kind,
          startTime: "09:00",
          endTime: "18:00",
        },
      ],
    }))
  }

  const removeOverridePeriod = (overrideIndex: number, periodIndex: number) => {
    updateOverride(overrideIndex, (override) => ({
      ...override,
      periods: override.periods.filter((_, index) => index !== periodIndex),
    }))
  }

  const save = async () => {
    setSaving(true)
    clearErrors()
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })

    if (!response.ok) {
      const data = (await response.json()) as {
        error?: string
        details?: { fieldErrors?: Record<string, string[]> }
      }
      setErrorsFromResponse(data)
      toast.error(data.error ?? "Unable to update settings.")
      setSaving(false)
      return
    }

    const data = (await response.json()) as {
      settings?: AppSettingsPayload
      emailDelivery?: EmailDeliveryStatus
    }
    const settings = data.settings ?? {}
    setEmailDelivery(data.emailDelivery ?? null)
    setForm({
      ...defaultSettings,
      ...settings,
      workingHours: normalizeWorkingHours(settings.workingHours ?? defaultSettings.workingHours),
      overrides: normalizeOverrides(settings.overrides ?? defaultSettings.overrides),
    })
    toast.success("Settings updated.")
    setSaving(false)
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading settings...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure localization and formatting defaults.
        </p>
      </div>

      {!canEdit && <p role="status" className="text-sm text-muted-foreground">You have read-only access to business settings.</p>}
      <fieldset disabled={!canEdit} className="space-y-6">
      <div className="rounded-xl border bg-card p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="settings-locale" label="Locale" error={errors.locale}>
            <select
              id="settings-locale"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.locale}
              onChange={(event) => updateField("locale", event.target.value)}
            >
              {localeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="settings-currency" label="Currency" error={errors.currency}>
            <select
              id="settings-currency"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.currency}
              onChange={(event) => updateField("currency", event.target.value)}
            >
              {currencyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="settings-timezone" label="Time zone" error={errors.timeZone}>
            <select
              id="settings-timezone"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.timeZone}
              onChange={(event) => updateField("timeZone", event.target.value)}
            >
              {timeZoneOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            id="settings-date-format"
            label="Date format"
            error={errors.dateFormat}
          >
            <select
              id="settings-date-format"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.dateFormat}
              onChange={(event) => updateField("dateFormat", event.target.value)}
            >
              {DATE_FORMAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            id="settings-time-format"
            label="Time format"
            error={errors.timeFormat}
          >
            <select
              id="settings-time-format"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.timeFormat}
              onChange={(event) => updateField("timeFormat", event.target.value)}
            >
              {TIME_FORMAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            id="settings-first-day"
            label="First day of week"
            error={errors.firstDayOfWeek}
          >
            <select
              id="settings-first-day"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.firstDayOfWeek}
              onChange={(event) => updateField("firstDayOfWeek", event.target.value)}
            >
              {WEEKDAY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            id="settings-email-notifications"
            label="Email notifications"
            error={errors.emailNotificationsEnabled}
          >
            <label className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
              <input
                id="settings-email-notifications"
                type="checkbox"
                checked={form.emailNotificationsEnabled}
                onChange={(event) =>
                  updateField("emailNotificationsEnabled", event.target.checked)
                }
              />
              Enable app email notifications
            </label>
          </FormField>
          <FormField
            id="settings-currency-placement"
            label="Currency symbol placement"
            error={errors.currencySymbolPlacement}
          >
            <select
              id="settings-currency-placement"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.currencySymbolPlacement}
              onChange={(event) =>
                updateField("currencySymbolPlacement", event.target.value)
              }
            >
              {CURRENCY_SYMBOL_PLACEMENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            id="settings-number-format"
            label="Number format"
            error={errors.numberFormat}
          >
            <select
              id="settings-number-format"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.numberFormat}
              onChange={(event) => updateField("numberFormat", event.target.value)}
            >
              {NUMBER_FORMAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Email delivery</h2>
          <p className="text-sm text-muted-foreground">
            SMTP is configured from backend environment variables. Secrets are never shown in UI.
          </p>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border p-3 text-sm">
            <p className="font-medium">Status</p>
            <p className="mt-1 text-muted-foreground">
              {emailDelivery?.configured ? "Configured" : "Not configured"}
            </p>
          </div>
          <div className="rounded-md border p-3 text-sm">
            <p className="font-medium">From address</p>
            <p className="mt-1 text-muted-foreground">{emailDelivery?.from ?? "-"}</p>
          </div>
          <div className="rounded-md border p-3 text-sm">
            <p className="font-medium">SMTP host / port</p>
            <p className="mt-1 text-muted-foreground">
              {emailDelivery?.host ?? "-"}
              {emailDelivery?.port ? `:${emailDelivery.port}` : ""}
            </p>
          </div>
          <div className="rounded-md border p-3 text-sm">
            <p className="font-medium">SMTP username</p>
            <p className="mt-1 text-muted-foreground">{emailDelivery?.usernameMasked ?? "-"}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Working hours</h2>
          <p className="text-sm text-muted-foreground">
            Configure daily hours and add break periods.
          </p>
        </div>

        <div className="mt-4 space-y-4">
          {form.workingHours.map((day, dayIndex) => (
            <div key={day.day} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-medium">
                  {WEEKDAY_OPTIONS.find((item) => item.value === day.day)?.label ?? day.day}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={day.isOpen}
                    onChange={(event) =>
                      updateWorkingDay(dayIndex, (current) => ({
                        ...current,
                        isOpen: event.target.checked,
                        periods: event.target.checked
                          ? current.periods.length
                            ? current.periods
                            : [{ ...DEFAULT_PERIOD }]
                          : [],
                      }))
                    }
                  />
                  Open
                </label>
              </div>

              {day.isOpen ? (
                <div className="mt-4 space-y-3">
                  {day.periods.map((period, periodIndex) => (
                    <div
                      key={`${day.day}-${periodIndex}`}
                      className="grid gap-3 sm:grid-cols-[140px_1fr_1fr_auto] sm:items-end"
                    >
                      <InlineField label="Type">
                        <select
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={period.kind}
                          onChange={(event) =>
                            updatePeriod(dayIndex, periodIndex, (current) => ({
                              ...current,
                              kind: event.target.value as WorkingPeriod["kind"],
                            }))
                          }
                        >
                          <option value="WORK">Work</option>
                          <option value="BREAK">Break</option>
                        </select>
                      </InlineField>
                      <InlineField label="Start">
                        <TimePicker
                          timeFormat={form.timeFormat}
                          value={period.startTime}
                          onChange={(nextValue) =>
                            updatePeriod(dayIndex, periodIndex, (current) => ({
                              ...current,
                              startTime: nextValue,
                            }))
                          }
                        />
                      </InlineField>
                      <InlineField label="End">
                        <TimePicker
                          timeFormat={form.timeFormat}
                          value={period.endTime}
                          onChange={(nextValue) =>
                            updatePeriod(dayIndex, periodIndex, (current) => ({
                              ...current,
                              endTime: nextValue,
                            }))
                          }
                        />
                      </InlineField>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label="Remove period"
                        onClick={() => removePeriod(dayIndex, periodIndex)}
                      >
                        <Trash2Icon className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => addPeriod(dayIndex, "WORK")}
                    >
                      Add work period
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => addPeriod(dayIndex, "BREAK")}
                    >
                      Add break
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Closed for this day.
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Special hours</h2>
            <p className="text-sm text-muted-foreground">
              Override working hours for specific dates.
            </p>
          </div>
          <Button variant="outline" onClick={addOverride}>
            Add override
          </Button>
        </div>

        {form.overrides.length ? (
          <div className="mt-4 space-y-4">
            {form.overrides.map((override, overrideIndex) => (
              <div key={`${override.date}-${overrideIndex}`} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <InlineField label="Date">
                    <Input
                      type="date"
                      defaultValue={override.date}
                      onBlur={(event) => {
                        const nextDate = event.currentTarget.value
                        if (!nextDate || nextDate === override.date) {
                          return
                        }
                        if (
                          form.overrides.some(
                            (item, index) =>
                              index !== overrideIndex && item.date === nextDate
                          )
                        ) {
                          toast.error("That date already has an override.")
                          event.currentTarget.value = override.date
                          return
                        }
                        updateOverride(overrideIndex, (current) => ({
                          ...current,
                          date: nextDate,
                        }))
                      }}
                    />
                  </InlineField>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={override.isOpen}
                        onChange={(event) =>
                          updateOverride(overrideIndex, (current) => ({
                            ...current,
                            isOpen: event.target.checked,
                            periods: event.target.checked
                              ? current.periods.length
                                ? current.periods
                                : [{ ...DEFAULT_PERIOD }]
                              : [],
                          }))
                        }
                      />
                      Open
                    </label>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label="Remove override"
                      onClick={() => removeOverride(overrideIndex)}
                    >
                      <Trash2Icon className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {override.isOpen ? (
                  <div className="mt-4 space-y-3">
                    {override.periods.map((period, periodIndex) => (
                      <div
                        key={`${override.date}-${periodIndex}`}
                        className="grid gap-3 sm:grid-cols-[140px_1fr_1fr_auto] sm:items-end"
                      >
                        <InlineField label="Type">
                          <select
                            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                            value={period.kind}
                            onChange={(event) =>
                              updateOverridePeriod(
                                overrideIndex,
                                periodIndex,
                                (current) => ({
                                  ...current,
                                  kind: event.target.value as WorkingPeriod["kind"],
                                })
                              )
                            }
                          >
                            <option value="WORK">Work</option>
                            <option value="BREAK">Break</option>
                          </select>
                        </InlineField>
                        <InlineField label="Start">
                          <TimePicker
                            timeFormat={form.timeFormat}
                            value={period.startTime}
                            onChange={(nextValue) =>
                              updateOverridePeriod(
                                overrideIndex,
                                periodIndex,
                                (current) => ({
                                  ...current,
                                  startTime: nextValue,
                                })
                              )
                            }
                          />
                        </InlineField>
                        <InlineField label="End">
                          <TimePicker
                            timeFormat={form.timeFormat}
                            value={period.endTime}
                            onChange={(nextValue) =>
                              updateOverridePeriod(
                                overrideIndex,
                                periodIndex,
                                (current) => ({
                                  ...current,
                                  endTime: nextValue,
                                })
                              )
                            }
                          />
                        </InlineField>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label="Remove period"
                          onClick={() =>
                            removeOverridePeriod(overrideIndex, periodIndex)
                          }
                        >
                          <Trash2Icon className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={() => addOverridePeriod(overrideIndex, "WORK")}
                      >
                        Add work period
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => addOverridePeriod(overrideIndex, "BREAK")}
                      >
                        Add break
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Closed for this day.
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No overrides yet.
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button disabled={!canEdit} onClick={save} loading={saving} loadingText="Saving...">
          Save settings
        </Button>
      </div>
      </fieldset>
    </div>
  )
}

