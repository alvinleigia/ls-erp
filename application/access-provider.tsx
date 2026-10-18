"use client"
import type { ReactNode } from "react"
import { RouteAccessProvider } from "@/platform/access/route-provider"
import { applicationRouteAccess } from "./access-routes"

export function ApplicationAccessProvider({ children }: { children: ReactNode }) {
  return <RouteAccessProvider access={applicationRouteAccess}>{children}</RouteAccessProvider>
}
