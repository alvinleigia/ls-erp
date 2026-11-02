/** Display built-in enum codes only; never apply to tenant names or custom labels. */
const acronyms = new Set(["AED", "API", "AUD", "B2B", "B2C", "CAD", "CGST", "CHF", "CNY", "CRM", "EIN", "ERP", "EUR", "GBP", "GST", "GSTIN", "HSN", "ID", "IGST", "INR", "IRN", "IRP", "JPY", "KYC", "NRI", "PAN", "PDF", "SAC", "SEZ", "SGD", "SGST", "SMS", "TDS", "USD", "UTGST", "VAT", "ZAR"])
const exceptions: Readonly<Record<string, string>> = { NON_GST: "Non-GST" }

export function enumLabel(value: string): string {
  if (!/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(value)) return value
  if (Object.hasOwn(exceptions, value)) return exceptions[value]
  return value.split("_").map((word, index) => acronyms.has(word) ? word : index === 0 ? word.charAt(0) + word.slice(1).toLowerCase() : word.toLowerCase()).join(" ")
}
