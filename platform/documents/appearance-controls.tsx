"use client"
import { InfoHelp } from "@/components/erp/info-help"
import { SpacingInput } from "./spacing-input"
import { FormField } from "@/components/form-field"
import { Select, Checkbox, Textarea } from "@/components/erp/controls"
import { SectionTabs } from "@/components/erp/section-tabs"
import { defaultDocumentAppearance, type DocumentAppearance } from "./appearance"

export function DocumentAppearanceControls({ value, disabled, footerReadOnly = false, companyFooter, onCompanyFooterChange, onChange }: { companyFooter?: string; onCompanyFooterChange?: (value: boolean) => void; value?: DocumentAppearance; disabled: boolean; footerReadOnly?: boolean; onChange: (value: DocumentAppearance | undefined) => void }) {
  const style = value ?? defaultDocumentAppearance
  const footerError = !footerReadOnly && style.footer.split("\n").length > 3 ? "Keep the footer to three text lines." : undefined
  function change<K extends keyof DocumentAppearance>(key: K, next: DocumentAppearance[K]) { onChange({ ...style, [key]: next }) }
  function spacing(key: "lineHeight" | "spaceAfter", next: number | null) { const value={...style};if(next===null)delete value[key];else value[key]=next;onChange(value) }
  function choice<K extends keyof DocumentAppearance>(key: K, label: string, options: [string, string][], numeric = false) {
    return <FormField id={`pdf-style-${key}`} label={label}><Select id={`pdf-style-${key}`} value={String(style[key])} onValueChange={next => change(key, (numeric ? Number(next) : next) as DocumentAppearance[K])}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></FormField>
  }
  return <div className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 px-4 py-3"><label className="flex items-center gap-2 text-sm font-medium"><Checkbox disabled={disabled} checked={!!value} onChange={event => onChange(event.target.checked ? { ...defaultDocumentAppearance } : undefined)} />Customise document styling</label><InfoHelp title="Custom document styling">Enable to adjust text, branding, tables and footer for this template. Leaving this off uses the default PDF appearance. Print-copy availability is configured separately.</InfoHelp></div>
    {value && <>
      <SectionTabs scope="document-appearance" keepMounted validationErrors={footerError} tabs={[{ value: "text", label: "Text and spacing", content: <fieldset disabled={disabled} className="grid min-w-0 gap-4 sm:grid-cols-2">
        {choice("fontSize", "Body text size", [9, 10, 11, 12].map(size => [String(size), `${size} pt`]), true)}
        <div className="sm:col-span-2"><div className="mb-2 flex items-center gap-2"><span className="text-sm font-medium">Document spacing</span><InfoHelp title="Document spacing">Line height is the distance between text lines (1-3 times the text size). Space after is the gap after a paragraph or heading (0-48 pt). These settings apply throughout the PDF, including generated sections and table text. Enter starts a new paragraph; Shift + Enter starts a new line in the same paragraph. Empty values use the saved defaults. Table padding and protected footer spacing are separate.</InfoHelp></div><div className="grid gap-4 sm:grid-cols-2">
          <SpacingInput key={`line:${style.lineHeight??"default"}`} label="Line height" value={style.lineHeight} min={1} max={3} step={0.05} disabled={disabled} onChange={next=>spacing("lineHeight",next)} />
          <SpacingInput key={`after:${style.spaceAfter??"default"}`} label="Space after (pt)" value={style.spaceAfter} min={0} max={48} step={1} disabled={disabled} onChange={next=>spacing("spaceAfter",next)} />
        </div></div>
        {choice("margins", "Page margins", [["standard", "Standard"], ["narrow", "Narrow"], ["wide", "Wide"]])}
        {choice("colour", "Document colours", [["navy", "Navy"], ["black", "Black"], ["teal", "Teal"]])}
        {choice("referenceLayout", "Reference and date layout", [["line", "Together"], ["split", "Reference left, date right"]])}
      </fieldset> }, { value: "letterhead", label: "Branding", content: <fieldset disabled={disabled} className="space-y-4"><div className="flex items-center gap-2"><h3 className="text-sm font-medium">Digital PDF branding</h3><InfoHelp title="Digital PDF branding">These settings control the company branding shown in the digital PDF. The print-on-letterhead copy omits automatic company branding and retains the document content.</InfoHelp></div><div className="grid min-w-0 gap-4 sm:grid-cols-2">
        {choice("logoAlign", "Logo alignment", [["left", "Left"], ["center", "Centre"], ["right", "Right"]])}
        {choice("logoSize", "Logo size", [["small", "Small"], ["medium", "Medium"], ["large", "Large"]])}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{([['companyHeading', 'Show company name above the title'], ['repeatLogo', 'Repeat logo on later pages'], ['watermark', 'Use the selected document logo as a watermark']] as const).map(([key, label]) => <label key={key} className="flex items-start gap-2"><Checkbox checked={style[key]} onChange={event => change(key, event.target.checked)} />{label}</label>)}</div>
      </fieldset> }, { value: "footer", label: "Tables and footer", content: <fieldset disabled={disabled} className="space-y-4">
        {choice("tableStyle", "Table style", [["shaded", "Shaded header"], ["grid", "Bordered grid"], ["minimal", "Minimal lines"]])}
        {onCompanyFooterChange&&<label className="flex items-center gap-2"><Checkbox checked={footerReadOnly} onChange={event=>onCompanyFooterChange(event.target.checked)}/>Use company footer</label>}
        <FormField id="pdf-style-footer" label="Repeating footer" error={footerError} help="Up to 300 characters across three text lines. Page numbers and the document reference remain visible. Logo options use the selected document logo; no additional upload is needed."><Textarea id="pdf-style-footer" disabled={footerReadOnly} rows={3} maxLength={300} value={footerReadOnly&&companyFooter!==undefined?companyFooter:style.footer} onChange={event => change("footer", event.target.value)} /></FormField>
      </fieldset> }]} />
    </>}
  </div>
}
