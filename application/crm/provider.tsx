"use client"

import { CrmExtensionProvider } from "@/modules/crm/components/extension-provider"
import { realEstateCrmView } from "@/modules/real-estate/components/crm-extension"

export function ApplicationCrmProvider({ children }: { children: React.ReactNode }) {
  return <CrmExtensionProvider view={realEstateCrmView}>{children}</CrmExtensionProvider>
}
