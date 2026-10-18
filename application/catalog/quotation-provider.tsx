"use client"
import type { ReactNode } from "react"
import { QuotationLineAddonContext } from "@/modules/sales-documents/components/line-addon"
import { CatalogQuotationPicker } from "@/modules/catalog/components/quotation-picker"
export function CatalogQuotationProvider({ children }: { children: ReactNode }) {
  return <QuotationLineAddonContext.Provider value={CatalogQuotationPicker}>{children}</QuotationLineAddonContext.Provider>
}
