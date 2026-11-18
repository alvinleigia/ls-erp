"use client"
import { ReadOnlyFields } from "@/components/erp/record-detail"
import type { RecordOffice } from "@/types/companies"

export const recordOfficeFields = (office?: RecordOffice | null) => office ? [
    { label: "Owning company", value: office.companyName },
    { label: "Office", value: `${office.name}${office.active ? "" : " (archived)"}` },
  ] : []

export function RecordOfficeFields({ office }: { office?: RecordOffice | null }) {
  if (!office) return null
  return <ReadOnlyFields fields={recordOfficeFields(office)} />
}
