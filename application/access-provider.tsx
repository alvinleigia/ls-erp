"use client"
import type { ReactNode } from "react"
import { RouteAccessProvider } from "@/platform/access/route-provider"
import { applicationRouteAccess } from "./access-routes"
import { CatalogQuotationProvider } from "./catalog/quotation-provider"

export function ApplicationAccessProvider({ children }: { children: ReactNode }) {
  return <RouteAccessProvider access={applicationRouteAccess}><CatalogQuotationProvider>{children}</CatalogQuotationProvider></RouteAccessProvider>
}
