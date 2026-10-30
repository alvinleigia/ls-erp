export type Weekday =
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY"
  | "SUNDAY"

export type PeriodKind = "WORK" | "BREAK"
export type CurrencySymbolPlacement = "BEFORE" | "AFTER"
export type TimeFormat = "H12" | "H24"
export type NumberFormatStyle =
  | "US_UK"
  | "EUROPEAN"
  | "ISO_DECIMAL_POINT"
  | "ISO_DECIMAL_COMMA"
  | "COMPACT_DECIMAL_POINT"
  | "COMPACT_DECIMAL_COMMA"

export type WeekdayOption = {
  value: Weekday
  label: string
}

export const WEEKDAY_OPTIONS: WeekdayOption[] = [
  { value: "MONDAY", label: "Monday" },
  { value: "TUESDAY", label: "Tuesday" },
  { value: "WEDNESDAY", label: "Wednesday" },
  { value: "THURSDAY", label: "Thursday" },
  { value: "FRIDAY", label: "Friday" },
  { value: "SATURDAY", label: "Saturday" },
  { value: "SUNDAY", label: "Sunday" },
]

export const DATE_FORMAT_OPTIONS = [
  { value: "MM/dd/yyyy", label: "MM/dd/yyyy" },
  { value: "dd/MM/yyyy", label: "dd/MM/yyyy" },
  { value: "yyyy-MM-dd", label: "yyyy-MM-dd" },
  { value: "dd-MM-yyyy", label: "dd-MM-yyyy" },
] as const

export const CURRENCY_SYMBOL_PLACEMENT_OPTIONS: Array<{
  value: CurrencySymbolPlacement
  label: string
}> = [
  { value: "BEFORE", label: "Before amount ($ 1,234.56)" },
  { value: "AFTER", label: "After amount (1,234.56 $)" },
]

export const NUMBER_FORMAT_OPTIONS: Array<{ value: NumberFormatStyle; label: string }> = [
  { value: "US_UK", label: "1,000,000.00 (US/UK format)" },
  { value: "EUROPEAN", label: "1.000.000,00 (European format)" },
  { value: "ISO_DECIMAL_POINT", label: "1 000 000.00 (ISO 80000-1 with decimal point)" },
  { value: "ISO_DECIMAL_COMMA", label: "1 000 000,00 (ISO 80000-1 with decimal comma)" },
  { value: "COMPACT_DECIMAL_POINT", label: "1000000.00 (Compact format with decimal point)" },
  { value: "COMPACT_DECIMAL_COMMA", label: "1000000,00 (Compact format with decimal comma)" },
]

export const TIME_FORMAT_OPTIONS: Array<{ value: TimeFormat; label: string }> = [
  { value: "H12", label: "12-hour (02:30 PM)" },
  { value: "H24", label: "24-hour (14:30)" },
]

export type WorkingPeriod = {
  id?: string
  kind: PeriodKind
  startTime: string
  endTime: string
  sortOrder?: number
}

export type WorkingDay = {
  id?: string
  day: Weekday
  isOpen: boolean
  periods: WorkingPeriod[]
}

export type DateOverrideDay = {
  id?: string
  date: string
  isOpen: boolean
  periods: WorkingPeriod[]
}

export type AppSettingsPayload = {
  locale?: string
  currency?: string
  timeZone?: string
  dateFormat?: string
  timeFormat?: TimeFormat
  firstDayOfWeek?: Weekday
  emailNotificationsEnabled?: boolean
  currencySymbolPlacement?: CurrencySymbolPlacement
  numberFormat?: NumberFormatStyle
  workingHours?: WorkingDay[]
  overrides?: DateOverrideDay[]
}

export type EmailDeliveryStatus = {
  configured: boolean
  host: string | null
  port: number | null
  from: string | null
  usernameMasked: string | null
}

export type TaxRow = {
  id: string
  name: string
  percent: string
  isActive: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}
