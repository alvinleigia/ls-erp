"use client"
import { createContext, createElement, useContext, type ComponentType } from "react"
import type { QuotationContent } from "../quotation-validation"
export type QuotationLineAddonProps = { line: QuotationContent["lines"][number]; currency: string; onChange: (line: QuotationContent["lines"][number]) => void; disabled?: boolean; id: string }
export const QuotationLineAddonContext = createContext<ComponentType<QuotationLineAddonProps> | null>(null)
export function QuotationLineAddon(props: QuotationLineAddonProps) {
  const Addon = useContext(QuotationLineAddonContext)
  return Addon ? createElement(Addon, props) : null
}
