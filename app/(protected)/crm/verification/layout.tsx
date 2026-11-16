import type { ReactNode } from "react"
import { BusinessViewGuard } from "@/platform/access/view-guard"
export default function Layout({ children }: { children: ReactNode }) {
  return <BusinessViewGuard module="customerVerification">{children}</BusinessViewGuard>
}
