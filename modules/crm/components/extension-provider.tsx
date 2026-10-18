"use client"

import * as React from "react"
import type { CrmViewReferences } from "../view-context"

export type ExtensionEditorProps = {
  value: unknown
  record: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
  readOnly?: boolean
  errors: Record<string, string>
}
export type ExtensionFilterProps = {
  primaryId: string
  secondaryId: string
  onChange: (primaryId: string, secondaryId: string) => void
}
export type CrmExtensionView = {
  filterQuery: (primaryId: string, secondaryId: string) => Record<string, string>
  initial: (references: CrmViewReferences) => unknown
  load: (record: unknown) => unknown
  payload: (value: unknown) => Record<string, unknown>
  Editor: React.ComponentType<ExtensionEditorProps>
  Caption: React.ComponentType<{ record: unknown }>
  Summary?: React.ComponentType<{ record: unknown }>
  Filter: React.ComponentType<ExtensionFilterProps>
  OpportunityPanels?: React.ComponentType<{ opportunityId: string }>
}
const emptyView: CrmExtensionView = {
  filterQuery: () => ({}),
  initial: () => undefined, load: () => undefined, payload: () => ({}),
  Editor: () => null, Caption: () => null, Filter: () => null,
}
const ExtensionContext = React.createContext(emptyView)
const ExtensionActiveContext = React.createContext(false)
export function CrmExtensionProvider({ view, active, children }: { view: CrmExtensionView; active: boolean; children: React.ReactNode }) {
  return <ExtensionContext.Provider value={view}><ExtensionActiveContext.Provider value={active}>{children}</ExtensionActiveContext.Provider></ExtensionContext.Provider>
}

// The editor owns only an opaque extension draft. Validation and field rendering
// belong to the installed extension; unchanged drafts are omitted from saves.
export function useCrmExtensionEditor({ primaryId = "", secondaryId = "" }: Partial<CrmViewReferences> = {}) {
  const view = React.useContext(ExtensionContext)
  const active = React.useContext(ExtensionActiveContext)
  const [value, setValue] = React.useState(() => view.initial({ primaryId, secondaryId }))
  const [record, setRecord] = React.useState<unknown>(null)
  const [dirty, setDirty] = React.useState(!!primaryId)
  const loadValue = view.load
  const load = React.useCallback((next: unknown) => {
    setRecord(next); setValue(loadValue(next)); setDirty(false)
  }, [loadValue])
  return {
    load,
    summary: () => active && view.Summary ? <view.Summary record={record} /> : null,
    payload: active && dirty ? view.payload(value) : {},
    fields: (props: Omit<ExtensionEditorProps, "value" | "record" | "onChange">) => active ? <view.Editor {...props} value={value} record={record} onChange={next => { setValue(next); setDirty(true) }} /> : null,
  }
}
export function CrmExtensionCaption(props: { record: unknown }) {
  const { Caption } = React.useContext(ExtensionContext)
  const active = React.useContext(ExtensionActiveContext)
  return active ? <Caption {...props} /> : null
}
export function CrmExtensionFilter(props: ExtensionFilterProps) {
  const { Filter } = React.useContext(ExtensionContext)
  const active = React.useContext(ExtensionActiveContext)
  return active ? <Filter {...props} /> : null
}
export function CrmOpportunityPanels(props: { opportunityId: string }) {
  const { OpportunityPanels } = React.useContext(ExtensionContext)
  return OpportunityPanels ? <OpportunityPanels {...props} /> : null
}

export function useCrmOpportunityPanelsAvailable() { return !!React.useContext(ExtensionContext).OpportunityPanels }

export function useCrmExtensionFilterQuery(primaryId: string, secondaryId: string) {
  const view = React.useContext(ExtensionContext)
  const active = React.useContext(ExtensionActiveContext)
  return active ? view.filterQuery(primaryId, secondaryId) : {}
}
