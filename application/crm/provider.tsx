"use client"

import { CrmExtensionProvider } from "@/modules/crm/components/extension-provider"
import { realEstateCrmView } from "@/modules/real-estate/components/crm-extension"

import { OpportunityDocuments } from "@/modules/sales-documents/components/quotations"

const view = { ...realEstateCrmView, OpportunityPanels: OpportunityDocuments }
export function ApplicationCrmProvider({ children }: { children: React.ReactNode }) {
  return <CrmExtensionProvider view={view}>{children}</CrmExtensionProvider>
}
