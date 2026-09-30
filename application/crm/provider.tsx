"use client"

import { useMemo } from "react"
import { useBusinessModules } from "@/platform/module-provider"
import { CrmExtensionProvider } from "@/modules/crm/components/extension-provider"
import { realEstateCrmView } from "@/modules/real-estate/components/crm-extension"

import { OpportunityDocuments } from "@/modules/sales-documents/components/quotations"

export function ApplicationCrmProvider({ children }: { children: React.ReactNode }) {
  const { enabled, can } = useBusinessModules()
  const documents = enabled("salesDocuments") && can("quotations.read")
  const view = useMemo(() => ({ ...realEstateCrmView, OpportunityPanels: documents ? OpportunityDocuments : undefined }), [documents])
  return <CrmExtensionProvider view={view}>{children}</CrmExtensionProvider>
}
