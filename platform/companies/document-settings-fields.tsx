"use client"
import { FormField } from "@/components/form-field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/erp/controls"
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
  return <SectionTabs scope="company-document-settings" keepMounted tabs={[{ value: "details", label: "Document details", content: details }, { value: "bank", label: "Bank instructions", content: bank }]} />
}
