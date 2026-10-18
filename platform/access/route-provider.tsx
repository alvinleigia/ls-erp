"use client"
import { createContext, useContext, type ReactNode } from "react"
import type { RouteAccess } from "./routes"

const Context = createContext<RouteAccess | null>(null)
export function RouteAccessProvider({ access, children }: { access: RouteAccess; children: ReactNode }) {
  return <Context.Provider value={access}>{children}</Context.Provider>
}
export function useRouteAccess() {
  const access = useContext(Context)
  if (!access) throw new Error("Route access must be configured by the application provider.")
  return access
}
