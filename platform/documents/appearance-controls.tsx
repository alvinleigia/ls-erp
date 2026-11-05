"use client"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/form-field"
import { Select, Checkbox, Textarea } from "@/components/erp/controls"
import { SectionTabs } from "@/components/erp/section-tabs"
import { defaultDocumentAppearance, documentStylePresets, type DocumentAppearance } from "./appearance"

export function DocumentAppearanceControls({ value, disabled, footerReadOnly = false, onChange }: { value?: DocumentAppearance; disabled: boolean; footerReadOnly?: boolean; onChange: (value: DocumentAppearance | undefined) => void }) {
  const style = value ?? defaultDocumentAppearance
  const footerError = !footerReadOnly && style.footer.split("\n").length > 3 ? "Keep the footer to three text lines." : undefined
  function change<K extends keyof DocumentAppearance>(key: K, next: DocumentAppearance[K]) { onChange({ ...style, [key]: next }) }
  function choice<K extends keyof DocumentAppearance>(key: K, label: string, options: [string, string][], numeric = false) {
    return <FormField id={`pdf-style-${key}`} label={label}><Select id={`pdf-style-${key}`} value={String(style[key])} onValueChange={next => change(key, (numeric ? Number(next) : next) as DocumentAppearance[K])}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></FormField>
  }
  return <div className="min-w-0 space-y-5">
    <label className="flex items-center gap-2"><Checkbox disabled={disabled} checked={!!value} onChange={event => onChange(event.target.checked ? { ...defaultDocumentAppearance } : undefined)} />Customise document styling</label>
    {value && <>
      <div className="flex flex-wrap gap-2" aria-label="Document style presets">{Object.entries(documentStylePresets).map(([key, preset]) => <Button key={key} type="button" disabled={disabled} variant="outline" onClick={() => onChange({ ...style, ...preset })}>{key === "standard" ? "Standard style" : key === "letter" ? "Letter style" : "Compact style"}</Button>)}</div>
      <SectionTabs scope="document-appearance" keepMounted validationErrors={footerError} tabs={[{ value: "text", label: "Text and spacing", content: <fieldset disabled={disabled} className="grid min-w-0 gap-4 sm:grid-cols-2">
        {choice("fontSize", "Body text size", [9, 10, 11, 12].map(size => [String(size), `${size} pt`]), true)}
        {choice("titleSize", "Document title size", [12, 14, 16, 18, 20, 22, 24].map(size => [String(size), `${size} pt`]), true)}
        {choice("spacing", "Text spacing", [["comfortable", "Comfortable"], ["compact", "Compact"]])}
        {choice("margins", "Page margins", [["standard", "Standard"], ["narrow", "Narrow"], ["wide", "Wide"]])}
        {choice("colour", "Document colours", [["navy", "Navy"], ["black", "Black"], ["teal", "Teal"]])}
        {choice("titleAlign", "Document title alignment", [["left", "Left"], ["center", "Centre"]])}
        {choice("referenceLayout", "Reference and date layout", [["line", "Together"], ["split", "Reference left, date right"]])}
      </fieldset> }, { value: "letterhead", label: "Letterhead", content: <fieldset disabled={disabled} className="space-y-4"><div className="grid min-w-0 gap-4 sm:grid-cols-2">
        {choice("logoAlign", "Logo alignment", [["left", "Left"], ["center", "Centre"], ["right", "Right"]])}
        {choice("logoSize", "Logo size", [["small", "Small"], ["medium", "Medium"], ["large", "Large"]])}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{([['companyHeading', 'Show company name above the title'], ['repeatLogo', 'Repeat logo on later pages'], ['watermark', 'Use the selected document logo as a watermark']] as const).map(([key, label]) => <label key={key} className="flex items-start gap-2"><Checkbox checked={style[key]} onChange={event => change(key, event.target.checked)} />{label}</label>)}</div>
      </fieldset> }, { value: "footer", label: "Tables and footer", content: <fieldset disabled={disabled} className="space-y-4">
        {choice("tableStyle", "Table style", [["shaded", "Shaded header"], ["grid", "Bordered grid"], ["minimal", "Minimal lines"]])}
        <FormField id="pdf-style-footer" label="Repeating footer" error={footerError} help="Up to 300 characters across three text lines. Page numbers and the document reference remain visible. Logo options use the selected document logo; no additional upload is needed."><Textarea id="pdf-style-footer" disabled={footerReadOnly} rows={3} maxLength={300} value={style.footer} onChange={event => change("footer", event.target.value)} /></FormField>
      </fieldset> }]} />
    </>}
  </div>
}
