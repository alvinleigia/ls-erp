"use client"
import type { ReactNode } from "react"
import { useBusinessModules } from "@/platform/module-provider"
import type { Requirement } from "@/platform/access/catalog"
import { RecordTabs } from "@/components/erp/record-detail"
export { ReadOnlyFields as CrmReadOnlyFields, RecordMenu as CrmRecordMenu, EditPanel as CrmEditPanel, DraftPanel as CrmDraftPanel } from "@/components/erp/record-detail"

export function CrmRecordTabs({ tabs, ...props }: {
  tabs: { value: string; label: string; content: ReactNode; permission?: Requirement }[];
  value: string; onChange: (value: string) => void;
}) {
  const { can } = useBusinessModules()
  return <RecordTabs {...props} tabs={tabs.filter(tab => !tab.permission || can(tab.permission))} />
}
