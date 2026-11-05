import type { TemplateField } from "@/platform/documents/layout"

const help = "Individual property fields require exactly one saved property unit. Use the Property units section for multiple units."
export const propertyDocumentFields: TemplateField[] = [
  { key: "property.project-name", label: "Project / phase name" },
  { key: "property.unit-code", label: "Unit code" },
  { key: "property.unit-name", label: "Unit name" },
  { key: "property.area", label: "Area" },
  { key: "property.area-unit", label: "Area unit" },
  { key: "property.location", label: "Property location" },
].map(field => ({ ...field, group: "Property (one unit)", help }))

export const propertyUnitsSection = {
  key: "property-units", label: "Property units", required: true,
  alternativeFields: propertyDocumentFields.map(field => field.key),
}

type SavedUnit = {
  ref: { code: string; name: string }
  property: { project: { name: string; location: string; parent: { name: string; location: string } | null }; area: string | null; areaUnit: "SQ_M" | "SQ_FT" }
}

// The caller supplies already authorised, accepted evidence. Never pick the first
// unit of a multi-unit order or resolve names from current catalogue settings.
export function propertyDocumentValues(units: SavedUnit[]): Record<string, string> {
  if (units.length !== 1) return {}
  const { ref, property: p } = units[0]
  return {
    "property.project-name": [p.project.parent?.name, p.project.name].filter(Boolean).join(" / "),
    "property.unit-code": ref.code,
    "property.unit-name": ref.name,
    "property.area": p.area ?? "Not supplied",
    "property.area-unit": p.area === null ? "" : p.areaUnit === "SQ_M" ? "sq m" : "sq ft",
    "property.location": p.project.location || p.project.parent?.location || "Not supplied",
  }
}
