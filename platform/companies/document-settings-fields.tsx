"use client"
import { FormField } from "@/components/form-field"
import { InfoHelp } from "@/components/erp/info-help"
import { Input } from "@/components/ui/input"
import { Checkbox, Textarea } from "@/components/erp/controls"
import { SectionTabs } from "@/components/erp/section-tabs"
import type { CompanyDocumentSettings } from "./document-settings"

export function CompanyDocumentSettingsFields({ value, onChange }: { value: CompanyDocumentSettings; onChange: (value: CompanyDocumentSettings) => void }) {
  const details = <div className="grid gap-4 md:grid-cols-2">
    <FormField id="company-document-address" label="Document address" help="The issuing company's address. Leave blank to omit it from correspondence."><Textarea id="company-document-address" maxLength={1500} rows={3} value={value.address} onChange={e => onChange({ ...value, address: e.target.value })} /></FormField>
    <FormField id="company-document-contact" label="Document contact details"><Textarea id="company-document-contact" maxLength={800} rows={3} value={value.contact} onChange={e => onChange({ ...value, contact: e.target.value })} /></FormField>
    <FormField id="company-document-website" label="Website"><Input id="company-document-website" type="url" maxLength={1000} value={value.website} onChange={e => onChange({ ...value, website: e.target.value })} /></FormField>
    <FormField id="company-document-signatory" label="Default signatory caption"><Input id="company-document-signatory" required maxLength={200} value={value.signatory} onChange={e => onChange({ ...value, signatory: e.target.value })} /></FormField>
    <FormField id="company-document-footer" label="Document footer" className="md:col-span-2" help="Up to three lines. Templates using company details repeat this footer on every page."><Textarea id="company-document-footer" maxLength={300} rows={3} value={value.footer} onChange={e => onChange({ ...value, footer: e.target.value })} /></FormField>
  </div>
  const bank = <div className="grid gap-4 md:grid-cols-2">{([
    ["accountName", "Account name"], ["accountNumber", "Account number"], ["accountType", "Account type"], ["bankName", "Bank name"], ["branch", "Branch"], ["routingCode", "IFSC / routing code"],
  ] as const).map(([key, label]) => <FormField key={key} id={`company-bank-${key}`} label={label}><Input id={`company-bank-${key}`} maxLength={key === "accountName" || key === "bankName" || key === "branch" ? 200 : 100} value={value.bank[key]} onChange={e => onChange({ ...value, bank: { ...value.bank, [key]: e.target.value } })} /></FormField>)}</div>
  const profile = value.letterhead ?? { enabled: false, topMm: 65, bottomMm: 25 }
  const letterhead = <div className="space-y-4"><div className="flex items-center gap-2"><label className="flex items-center gap-2"><Checkbox checked={profile.enabled} onChange={e => onChange({ ...value, letterhead: { ...profile, enabled: e.target.checked } })} />Enable printing on preprinted letterhead</label><InfoHelp title="Letterhead printing">New company documents share one body and page layout. Digital PDFs include company branding; letterhead copies omit it. Existing issued PDFs retain their saved settings. The reserved space must accommodate the digital header and the physical letterhead.</InfoHelp></div><div className="grid gap-4 md:grid-cols-2"><FormField id="letterhead-top" label="Reserved header space (mm)" help="Measured from the top edge of the paper. Use 20–80 mm."><Input id="letterhead-top" type="number" min={20} max={80} step="0.5" disabled={!profile.enabled} value={profile.topMm} onChange={e => onChange({ ...value, letterhead: { ...profile, topMm: Number(e.target.value) } })} /></FormField><FormField id="letterhead-bottom" label="Reserved footer space (mm)" help="Measured from the bottom edge. Use 15–50 mm."><Input id="letterhead-bottom" type="number" min={15} max={50} step="0.5" disabled={!profile.enabled} value={profile.bottomMm} onChange={e => onChange({ ...value, letterhead: { ...profile, bottomMm: Number(e.target.value) } })} /></FormField></div></div>
  return <SectionTabs scope="company-document-settings" keepMounted tabs={[{ value: "details", label: "Document details", content: details }, { value: "bank", label: "Bank instructions", content: bank }, { value: "letterhead", label: "Letterhead printing", content: letterhead }]} />
}
