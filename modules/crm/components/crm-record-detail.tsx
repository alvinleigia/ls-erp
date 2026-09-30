"use client"

import { useBusinessModules } from "@/platform/module-provider"
import type { Requirement } from "@/platform/access/catalog"
import * as React from "react"
import { MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"

// Record-local navigation. Inactive panels are not mounted, so embedded lists
// fetch only when opened. Business components retain their own permissions.
export function CrmRecordTabs({ tabs, value, onChange }: {
  tabs: { value: string; label: string; content: React.ReactNode; permission?: Requirement }[];
  value: string; onChange: (value: string) => void;
}) {
  const id = React.useId()
  const { can } = useBusinessModules()
  tabs = tabs.filter(tab => !tab.permission || can(tab.permission))
  if (!tabs.some(tab => tab.value === value)) value = tabs[0]?.value || ""
  return <div className="min-w-0 space-y-5">
    <div role="tablist" aria-label="Record sections" className="flex max-w-full gap-1 overflow-x-auto border-b pb-2" onKeyDown={event => {
      const index = tabs.findIndex(tab => tab.value === value)
      const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1
      if (next < 0) return
      event.preventDefault(); onChange(tabs[next].value)
      document.getElementById(`${id}-${tabs[next].value}`)?.focus()
    }}>
      {tabs.map(tab => <Button key={tab.value} type="button" role="tab" id={`${id}-${tab.value}`} aria-selected={value === tab.value} aria-controls={`${id}-panel`} tabIndex={value === tab.value ? 0 : -1} variant={value === tab.value ? "secondary" : "ghost"} className="shrink-0" onClick={() => onChange(tab.value)}>{tab.label}</Button>)}
    </div>
    <div key={value} role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${value}`} tabIndex={0} className="min-w-0 space-y-6">{tabs.find(tab => tab.value === value)?.content}</div>
  </div>
}

export function CrmReadOnlyFields({ fields }: { fields: { label: string; value: React.ReactNode }[] }) {
  return <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">{fields.map(field => <div key={field.label} className="min-w-0"><dt className="text-sm text-muted-foreground">{field.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm font-medium">{field.value === null || field.value === undefined || field.value === "" ? "Not specified" : field.value}</dd></div>)}</dl>
}

export function CrmRecordMenu({ actions }: { actions: { label: string; onSelect: () => void; disabled?: boolean }[] }) {
  return <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" size="icon" aria-label="More actions"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{actions.map(action => <DropdownMenuItem key={action.label} disabled={action.disabled} onSelect={action.onSelect}>{action.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
}

export function CrmEditPanel({ open, title, description, onClose, onSubmit, saving, disabled, dirty, error, children, saveLabel = "Save changes" }: {
  open: boolean; title: string; description: string; onClose: () => void; onSubmit: React.FormEventHandler<HTMLFormElement>;
  saving: boolean; disabled?: boolean; dirty: boolean; error?: string; children: React.ReactNode; saveLabel?: string;
}) {
  const formId = React.useId()
  const [discard, setDiscard] = React.useState(false)
  function close() { if (!saving) { if (dirty) setDiscard(true); else onClose() } }
  return <><Sheet open={open} onOpenChange={next => { if (!next) close() }}><SheetContent className="w-full gap-0 sm:max-w-2xl" onInteractOutside={event => { event.preventDefault() }}>
    <SheetHeader className="shrink-0 border-b p-5 pr-12"><SheetTitle>{title}</SheetTitle><SheetDescription>{description}</SheetDescription></SheetHeader>
    <form id={formId} onSubmit={event => { event.preventDefault(); onSubmit(event) }} onInvalidCapture={event => { const target = event.target as HTMLElement; const section = target.closest("details"); if (section) section.open = true }} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <fieldset disabled={saving} className="min-w-0 space-y-5">{children}</fieldset>
    </form>
    <SheetFooter className="shrink-0 flex-row justify-end border-t bg-background p-4"><Button type="button" variant="outline" disabled={saving} onClick={close}>Cancel</Button><Button type="submit" form={formId} loading={saving} loadingText="Saving..." disabled={disabled}>{saveLabel}</Button></SheetFooter>
  </SheetContent></Sheet>
  <Dialog open={discard} onOpenChange={setDiscard}><DialogContent><DialogHeader><DialogTitle>Discard unsaved changes?</DialogTitle><DialogDescription>Your changes in this section have not been saved.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDiscard(false)}>Keep editing</Button><Button onClick={() => { setDiscard(false); onClose() }}>Discard changes</Button></DialogFooter></DialogContent></Dialog>
  </>
}

// Mount a fresh instance for each small configuration draft.
export function CrmDraftPanel({ fingerprint, ...props }: Omit<React.ComponentProps<typeof CrmEditPanel>, "open" | "dirty"> & { fingerprint: unknown }) {
  const [baseline] = React.useState(() => JSON.stringify(fingerprint))
  return <CrmEditPanel {...props} open dirty={baseline !== JSON.stringify(fingerprint)} />
}
