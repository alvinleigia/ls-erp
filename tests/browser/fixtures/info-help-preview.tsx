"use client"
import { useState } from "react"
import { InfoHelp } from "@/components/erp/info-help"
import { PageHeader } from "@/components/erp/page"
import { Section } from "@/components/erp/section"
import { EditSections } from "@/components/erp/edit-sections"
import { FormField } from "@/components/form-field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Dialog, DialogTrigger } from "@/components/ui/dialog"
import { ActionDialogContent } from "@/components/erp/action-dialog"
import { DraftPanel } from "@/components/erp/record-detail"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export function InfoHelpPreview() {
  const [submits, setSubmits] = useState(0), [value, setValue] = useState("Saved draft"), [guide, setGuide] = useState(false)
  const [placementDraft, setPlacementDraft] = useState(false)
  return <form className="space-y-5" onSubmit={event => { event.preventDefault(); setSubmits(count => count + 1) }}>
    <PageHeader title="Help preview" description="Optional page explanation stays available without filling the header." />
    <Section title="Report overview" description={<><p>Report calculations explain this selection without changing its figures.</p><ul><li>Creation dates and completion dates have different meanings.</li><li>Access filters always apply.</li></ul>{Array.from({ length: 40 }, (_, i) => <p key={i}>Guidance paragraph {i + 1}. This is a long explanation that needs readable wrapping and keyboard scrolling on a small screen.</p>)}<a className="underline" href="#guide" onClick={event => { event.preventDefault(); setGuide(true) }}>Read the guide</a></>}>
      <p>Selected period: November 2026</p><p>Enquiries: 40</p>
      <FormField id="help-name" label="Customer name" help="Optional name explanation. Required fields still show their required marker and validation message." error="Please enter the required name."><Input id="help-name" value={value} onChange={event => setValue(event.target.value)} /></FormField>
      <fieldset disabled><legend>Saved fields</legend><label>Locked value<Input value="Read-only value" readOnly /><InfoHelp title="Locked value">Help remains available even when the fieldset is disabled.</InfoHelp></label></fieldset>
    </Section>
    <EditSections initial=""><Section title="Collapsed section" description="Reading this explanation must not expand the editor or discard a draft."><Input aria-label="Draft field" value={value} onChange={event => setValue(event.target.value)} /></Section></EditSections>
    <Section title="Action warning" descriptionDisplay="inline" description="This reviewed action permanently deletes the selected test record."><p role="alert">Resolve the validation error before saving.</p></Section>
    <Dialog><DialogTrigger asChild><Button type="button">Review action</Button></DialogTrigger><ActionDialogContent title="Review action" description="Confirming changes the selected record. This warning stays visible." actions={<Button type="button">Confirm action</Button>}><InfoHelp title="Dialog guidance">Supplementary guidance opens within the action dialog.</InfoHelp></ActionDialogContent></Dialog>
    <Popover><PopoverTrigger asChild><Button type="button">Open filters</Button></PopoverTrigger><PopoverContent aria-label="Test filters" className="p-4"><Input aria-label="Filter text" /><InfoHelp title="Filter guidance">Help can open inside a filter popover without clearing its values.</InfoHelp></PopoverContent></Popover>
    <InfoHelp title="No content">{null}</InfoHelp>
    <Section title="Placement notes" descriptionDisplay="inline" description="Essential placement notice stays visible." help={<p>Supplementary placement guidance belongs in this heading.</p>}>
      <PageHeader title="Placement page" descriptionDisplay="inline" description="Current office: Sample office" help="Page guidance belongs beside the title." />
      <Section title="No extra help" help={false}><p>Normal section body</p></Section>
      <Section title="Information only" help="Guidance without an empty body row.">{null}</Section>
      <Button type="button" onClick={() => setPlacementDraft(true)}>Open placement draft</Button>
    </Section>
    {placementDraft && <DraftPanel title="Placement draft" description="Draft notice stays visible." help="Optional draft guidance belongs in the sheet header." fingerprint={value} saving={false} onClose={() => setPlacementDraft(false)} onSubmit={event => event.preventDefault()}><Input aria-label="Placement draft value" value={value} onChange={event => setValue(event.target.value)} /></DraftPanel>}
    <Section title="Alignment samples" description="Header guidance" actions={<Button type="button">Header action</Button>}>
      <div className="grid grid-cols-2 gap-4">
        <FormField id="alignment-help" label="Field with help" help="Aligned field guidance"><Input id="alignment-help" /></FormField>
        <FormField id="alignment-plain" label="Field without help"><Input id="alignment-plain" /></FormField>
      </div>
      <Section title="A longer section heading that wraps onto multiple lines on a narrow screen" description="Wrapped heading guidance"><p>Section content</p></Section>
      <Section title="Inline description" descriptionDisplay="inline" description="Essential context stays below the heading without shifting its leading icon."><p>Visible content</p></Section>
      <PageHeader title="A longer page heading that wraps onto multiple lines on a narrow screen" description="Wrapped page guidance" badge={<span>Badge</span>} />
    </Section>
    <p aria-live="polite">Submissions: {submits}</p>{guide && <p>Guide opened</p>}
    <Button type="submit">Save preview</Button>
  </form>
}
