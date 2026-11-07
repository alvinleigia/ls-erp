"use client"
import { InfoHelp } from "@/components/erp/info-help"
import { FormField } from "@/components/form-field"
import { Select } from "@/components/erp/controls"
import { Input } from "@/components/ui/input"
import type { CompanyLetterhead, DocumentLetterhead } from "./letterhead"

export function DocumentLetterheadControls({ value, companyDefault, disabled, onChange }: { value?: DocumentLetterhead; companyDefault?: CompanyLetterhead; disabled: boolean; onChange: (value: DocumentLetterhead | undefined) => void }) {
  const mode=value===undefined?"company":value.enabled?"document":"disabled"
  return <fieldset disabled={disabled} className="min-w-0 space-y-5">
    <div className="flex items-center gap-2"><h3 className="text-sm font-medium">Print on preprinted letterhead</h3><InfoHelp title="Print on preprinted letterhead">This setting applies to this document template only. The digital PDF uses its configured company header and footer. A letterhead copy omits automatic company branding for preprinted paper. Both copies retain the same document content, page breaks, reference and page numbers. Issued files retain their saved settings. Reserved space must accommodate both the digital header and the physical letterhead.</InfoHelp></div>
    <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
    <FormField id="template-letterhead-mode" label="Letterhead printing"><Select id="template-letterhead-mode" value={mode} onValueChange={mode=>onChange(mode==="company"?undefined:mode==="disabled"?{enabled:false}:{enabled:true,topMm:companyDefault?.topMm??65,bottomMm:companyDefault?.bottomMm??25})}>
      <option value="company">Use company setting</option><option value="document">Enable for this document</option><option value="disabled">Disable for this document</option>
    </Select></FormField>
    {mode==="company"&&companyDefault&&<p className="pb-2 text-sm text-muted-foreground">Company setting: {companyDefault.enabled?"enabled":"disabled"}.</p>}
    </div>
    {value?.enabled&&<div className="grid gap-4 sm:grid-cols-2">
      <FormField id="template-letterhead-top" label="Reserved header space (mm)" help="Measured from the top edge. Use 20-80 mm."><Input id="template-letterhead-top" type="number" min={20} max={80} step="0.5" value={value.topMm} onChange={event=>onChange({...value,topMm:Number(event.target.value)})}/></FormField>
      <FormField id="template-letterhead-bottom" label="Reserved footer space (mm)" help="Measured from the bottom edge. Use 15-50 mm."><Input id="template-letterhead-bottom" type="number" min={15} max={50} step="0.5" value={value.bottomMm} onChange={event=>onChange({...value,bottomMm:Number(event.target.value)})}/></FormField>
    </div>}
  </fieldset>
}
