"use client"

import * as React from "react"

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
  initial: (references: { primaryId: string; secondaryId: string }) => unknown
  load: (record: unknown) => unknown
  payload: (value: unknown) => Record<string, unknown>
  Editor: React.ComponentType<ExtensionEditorProps>
  Caption: React.ComponentType<{ record: unknown }>
  Filter: React.ComponentType<ExtensionFilterProps>
  OpportunityPanels?: React.ComponentType<{ opportunityId: string }>
}
const emptyView: CrmExtensionView = {
  initial: () => undefined, load: () => undefined, payload: () => ({}),
  Editor: () => null, Caption: () => null, Filter: () => null,
}
const ExtensionContext = React.createContext(emptyView)
export function CrmExtensionProvider({ view, children }: { view: CrmExtensionView; children: React.ReactNode }) {
  return <ExtensionContext.Provider value={view}>{children}</ExtensionContext.Provider>
}

// The editor owns only an opaque extension draft. Validation and field rendering
// belong to the installed extension; unchanged drafts are omitted from saves.
export function useCrmExtensionEditor(primaryId = "", secondaryId = "") {
  const view = React.useContext(ExtensionContext)
  const [value, setValue] = React.useState(() => view.initial({ primaryId, secondaryId }))
  const [record, setRecord] = React.useState<unknown>(null)
  const [dirty, setDirty] = React.useState(!!primaryId)
  const load = React.useCallback((next: unknown) => {
    setRecord(next); setValue(view.load(next)); setDirty(false)
  }, [view])
  return {
    load,
    payload: dirty ? view.payload(value) : {},
    fields: (props: Omit<ExtensionEditorProps, "value" | "record" | "onChange">) => <view.Editor {...props} value={value} record={record} onChange={next => { setValue(next); setDirty(true) }} />,
  }
}
export function CrmExtensionCaption(props: { record: unknown }) {
  const { Caption } = React.useContext(ExtensionContext)
  return <Caption {...props} />
}
export function CrmExtensionFilter(props: ExtensionFilterProps) {
  const { Filter } = React.useContext(ExtensionContext)
  return <Filter {...props} />
}
export function CrmOpportunityPanels(props: { opportunityId: string }) {
  const { OpportunityPanels } = React.useContext(ExtensionContext)
  return OpportunityPanels ? <OpportunityPanels {...props} /> : null
}
