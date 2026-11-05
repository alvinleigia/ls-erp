"use client"
import { useState, useSyncExternalStore } from "react"
import { SectionTabs } from "@/components/erp/section-tabs"
import { RecordTabs } from "@/components/erp/record-detail"
import { FormField } from "@/components/form-field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const subscribe = () => () => {}

export function SectionTabsPreview() {
  const ready = useSyncExternalStore(subscribe, () => true, () => false)
  const [name, setName] = useState("Saved name"), [submitted, setSubmitted] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({}), [tab, setTab] = useState("overview")
  return <div className="space-y-6"><h1>Record section checks</h1>
    <form onSubmit={event => { event.preventDefault(); setSubmitted(JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))) }}>
      <SectionTabs scope="draft-check" keepMounted validationErrors={errors} tabs={[
        {value:"overview",label:"Details",content:<FormField id="check-name" label="Name"><Input id="check-name" name="name" value={name} onChange={event=>setName(event.target.value)}/></FormField>},
        {value:"contact",label:"Contact",content:<><FormField id="check-email" label="Email" error={errors.email}><Input id="check-email" name="email" type="email" required defaultValue=""/></FormField><FormField id="check-phone" label="Phone"><Input id="check-phone" name="phone" required defaultValue=""/></FormField></>},
        {value:"notes",label:"Notes",content:<FormField id="check-note" label="Note"><Input id="check-note" name="note" defaultValue="Saved note"/></FormField>},
      ]}/>
      <div className="mt-4 flex gap-2"><Button type="submit" disabled={!ready}>Save draft</Button><Button type="button" disabled={!ready} onClick={()=>setErrors({email:"Email already used"})}>Simulate server error</Button></div>
    </form>
    <output aria-label="Submitted draft" className="block break-all">{submitted}</output>
    <SectionTabs scope="readonly-check" tabs={[
      {value:"overview",label:"Saved details",content:<fieldset disabled><Input aria-label="Saved field" defaultValue="Read only"/></fieldset>},
      {value:"other",label:"Saved history",content:<p>History is readable</p>},
    ]}/>
    <RecordTabs value={tab} onChange={setTab} tabs={[
      {value:"overview",label:"First lazy panel",content:<p>First panel content</p>},
      {value:"other",label:"Second lazy panel",content:<p>Second panel content</p>},
    ]}/>
  </div>
}
