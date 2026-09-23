import type {
  AppSettingsPayload,
  CurrencySymbolPlacement,
  NumberFormatStyle,
  TimeFormat,
  Weekday,
} from "@/types/scheduling"

const DEFAULTS = {
  locale: "en-US",
  currency: "USD",
  currencySymbolPlacement: "BEFORE" as CurrencySymbolPlacement,
  timeFormat: "H24" as TimeFormat,
  numberFormat: "US_UK" as NumberFormatStyle,
}

const NUMBER_SEPARATORS: Record<
  NumberFormatStyle,
  { thousands: string; decimal: string; grouped: boolean }
> = {
  US_UK: { thousands: ",", decimal: ".", grouped: true },
  EUROPEAN: { thousands: ".", decimal: ",", grouped: true },
  ISO_DECIMAL_POINT: { thousands: " ", decimal: ".", grouped: true },
  ISO_DECIMAL_COMMA: { thousands: " ", decimal: ",", grouped: true },
  COMPACT_DECIMAL_POINT: { thousands: "", decimal: ".", grouped: false },
  COMPACT_DECIMAL_COMMA: { thousands: "", decimal: ",", grouped: false },
}

const addGrouping = (value: string, separator: string) =>
  value.replace(/\B(?=(\d{3})+(?!\d))/g, separator)

// Decimal strings preserve CRM values beyond JavaScript's safe numeric precision.
// Currency codes keep different currencies unambiguous in the same sales view.
export const formatDecimalCurrency = (
  value: string,
  currency: string,
  settings?: Pick<AppSettingsPayload, "numberFormat" | "currencySymbolPlacement">
) => {
  const [integerPart, decimalPart = ""] = value.split(".")
  const separators = NUMBER_SEPARATORS[settings?.numberFormat ?? DEFAULTS.numberFormat]
  const integer = separators.grouped ? addGrouping(integerPart, separators.thousands) : integerPart
  const minimumDigits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().minimumFractionDigits ?? 2
  const fraction = decimalPart.padEnd(minimumDigits, "0")
  const number = fraction ? `${integer}${separators.decimal}${fraction}` : integer
  return settings?.currencySymbolPlacement === "AFTER" ? `${number} ${currency}` : `${currency} ${number}`
}

export const formatNumberValue = (
  value: number,
  style: NumberFormatStyle = DEFAULTS.numberFormat,
  fractionDigits = 2
) => {
  const abs = Math.abs(value)
  const fixed = abs.toFixed(fractionDigits)
  const [integerPart, decimalPart = ""] = fixed.split(".")
  const separators = NUMBER_SEPARATORS[style]
  const groupedInteger = separators.grouped
    ? addGrouping(integerPart, separators.thousands)
    : integerPart
  const withDecimals = fractionDigits
    ? `${groupedInteger}${separators.decimal}${decimalPart}`
    : groupedInteger
  return value < 0 ? `-${withDecimals}` : withDecimals
}

const resolveCurrencySymbol = (currency: string, locale: string) => {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).formatToParts(1)
    return parts.find((part) => part.type === "currency")?.value ?? currency
  } catch {
    return currency
  }
}

export const formatCurrencyFromCents = (
  cents: number,
  settings?: Pick<
    AppSettingsPayload,
    "currency" | "locale" | "currencySymbolPlacement" | "numberFormat"
  >
) => {
  const value = cents / 100
  const locale = settings?.locale ?? DEFAULTS.locale
  const currency = settings?.currency ?? DEFAULTS.currency
  const placement =
    settings?.currencySymbolPlacement ?? DEFAULTS.currencySymbolPlacement
  const numberFormat = settings?.numberFormat ?? DEFAULTS.numberFormat

  const symbol = resolveCurrencySymbol(currency, locale)
  const number = formatNumberValue(value, numberFormat, 2)
  return placement === "BEFORE" ? `${symbol} ${number}` : `${number} ${symbol}`
}

const parseTime24 = (value: string) => {
  const match = value.match(/^(\d{2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return { hours, minutes }
}

export const formatTimeFrom24h = (
  value: string,
  settings?: Pick<AppSettingsPayload, "timeFormat">
) => {
  const parsed = parseTime24(value)
  if (!parsed) return value
  const timeFormat = settings?.timeFormat ?? DEFAULTS.timeFormat
  if (timeFormat === "H24") {
    return `${String(parsed.hours).padStart(2, "0")}:${String(parsed.minutes).padStart(2, "0")}`
  }
  const period = parsed.hours >= 12 ? "PM" : "AM"
  const hour12 = parsed.hours % 12 || 12
  return `${String(hour12).padStart(2, "0")}:${String(parsed.minutes).padStart(2, "0")} ${period}`
}

export const formatTimeFromDate = (
  value: string | Date,
  settings?: Pick<AppSettingsPayload, "timeFormat">
) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : ""
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return formatTimeFrom24h(`${hours}:${minutes}`, settings)
}

export const weekdayToSchedulerFirstDay = (weekday?: Weekday) => {
  switch (weekday) {
    case "MONDAY":
      return 1
    case "TUESDAY":
      return 2
    case "WEDNESDAY":
      return 3
    case "THURSDAY":
      return 4
    case "FRIDAY":
      return 5
    case "SATURDAY":
      return 6
    case "SUNDAY":
    default:
      return 0
  }
}
