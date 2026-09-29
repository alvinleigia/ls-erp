"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { CrmEditPanel, CrmRecordTabs, CrmReadOnlyFields } from "./crm-record-detail"
import { CrmSection } from "./crm-section"
import { EditSections } from "./crm-edit-sections"

type View = { existing: boolean; editing: boolean; section: string; tab: string; setTab: (tab: string) => void; begin: (section?: string) => void; done: () => void; discard: () => void }
const Context = React.createContext<View | null>(null)
export const useCrmRecordView = () => React.useContext(Context)

// Discard remounts the record controller to reload its authoritative state,
// including extension drafts and custom fields. No editor-specific reset copies.
function RecordView({ existing, children }: { existing: boolean; children: React.ReactNode }) {
  const [editing, setEditing] = React.useState(false), [section, setSection] = React.useState("")
  const [revision, setRevision] = React.useState(0), [tab, setTab] = React.useState("overview")
  const begin = React.useCallback((section = "") => { setSection(section); setEditing(true) }, [])
  const done = React.useCallback(() => setEditing(false), [])
  const discard = React.useCallback(() => { setEditing(false); setRevision(value => value + 1) }, [])
  return <Context.Provider value={{ existing, editing, section, tab, setTab, begin, done, discard }}><React.Fragment key={revision}>{children}</React.Fragment></Context.Provider>
}
export function withCrmRecordView<P extends { id?: string }>(Editor: React.ComponentType<P>) {
  return function RecordEditor(props: P) { return <RecordView key={props.id || "new"} existing={!!props.id}><Editor {...props} /></RecordView> }
}

export function CrmSectionEdit({ section, allowed = true }: { section: string; allowed?: boolean }) {
  const view = useCrmRecordView()
  return allowed && view?.existing ? <Button type="button" variant="outline" size="sm" aria-label={`Edit ${section.toLowerCase()}`} onClick={() => view.begin(section)}>Edit</Button> : null
}
export function CrmSummarySection({ title, fields, canEdit = true, children }: { title: string; fields: React.ComponentProps<typeof CrmReadOnlyFields>["fields"]; canEdit?: boolean; children?: React.ReactNode }) {
  return <CrmSection title={title} actions={<CrmSectionEdit section={title} allowed={canEdit} />}><CrmReadOnlyFields fields={fields} />{children}</CrmSection>
}

type RecordFormProps = {
  id: string; children: React.ReactNode; overview: React.ReactNode; initialSection: string; createSection?: string;
  onSubmit: React.FormEventHandler<HTMLFormElement>; saving: boolean; disabled?: boolean;
  error?: string; fingerprint: unknown; saveLabel?: string; className?: string;
  tabs?: { value: string; label: string; content: React.ReactNode }[];
}
export function CrmRecordForm(props: RecordFormProps) {
  const view = useCrmRecordView()
  if (!view?.existing) return <form id={props.id} onSubmit={props.onSubmit} className={props.className || "space-y-5"} onInvalidCapture={event => { const section = (event.target as HTMLElement).closest("details"); if (section) section.open = true }}>{props.error && <p role="alert" className="text-sm text-destructive">{props.error}</p>}<EditSections initial={props.createSection || props.initialSection}>{props.children}</EditSections></form>
  const tabs = [{ value: "overview", label: "Overview", content: props.overview }, ...(props.tabs || [])]
  return <>
    {!view.editing && props.error && <p role="alert" className="text-sm text-destructive">{props.error}</p>}
    {tabs.length > 1 ? <CrmRecordTabs value={tabs.some(tab => tab.value === view.tab) ? view.tab : "overview"} onChange={view.setTab} tabs={tabs} /> : props.overview}
    {view.editing && <EditingForm {...props} view={view} />}
  </>
}
function EditingForm({ view, fingerprint, initialSection, children, onSubmit, saving, disabled, error, saveLabel }: RecordFormProps & { view: View }) {
  const [baseline] = React.useState(() => JSON.stringify(fingerprint))
  return <CrmEditPanel open title="Edit record" description="Open a section to make changes, then save." onClose={view.discard} onSubmit={onSubmit} saving={saving} disabled={disabled} dirty={baseline !== JSON.stringify(fingerprint)} error={error} saveLabel={saveLabel}>
    <EditSections initial={view.section || initialSection}>{children}</EditSections>
  </CrmEditPanel>
}
