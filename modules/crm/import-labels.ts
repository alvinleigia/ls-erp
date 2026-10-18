import type { TermResolver } from "@/platform/terminology/resolver"
import type { ImportField } from "./import-types"

export function importFieldLabel(field: ImportField, term: TermResolver) {
  if (field.customField) {
    const { name, scope } = field.customField
    const scopeLabel = scope === "ENQUIRY" ? term("crm.enquiry.singular", "enquiry") : scope.toLowerCase()
    return `${name} (${scopeLabel}${field.salesTeamId ? ", team field" : ""})`
  }
  return field.terminologyKey ? term(field.terminologyKey, field.label, field.labelTemplate) : field.label
}

export function importTemplateHeader(field: ImportField, term: TermResolver) {
  if (field.key.startsWith("custom:")) return field.aliases!.at(-1)!
  const label = importFieldLabel(field, term)
  // Renamed headings carry their stable identity, even after terminology changes.
  return label === field.label ? label : `${label} [${field.key}]`
}
