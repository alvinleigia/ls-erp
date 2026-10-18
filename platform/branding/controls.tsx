"use client"
import * as React from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { PageHeader, FormActions, pageClass } from "@/components/erp/page"
import { Section } from "@/components/erp/section"
import { ConfirmAction } from "@/components/erp/confirm-action"
import { FormField } from "@/components/form-field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { LOGO_UPLOAD_LIMIT, type BrandingState } from "./types"
type Preview = { preview: string; width: number; height: number; bytes: number; sidebarBytes: number; warning: string | null }

export function BrandingControls() {
  const router = useRouter()
  const [state, setState] = React.useState<BrandingState | null>(null)
  const [name, setName] = React.useState("")
  const [file, setFile] = React.useState<File | null>(null)
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [remove, setRemove] = React.useState(false)
  const [confirm, setConfirm] = React.useState(false)
  const [error, setError] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [processing, setProcessing] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const generation = React.useRef(0)
  const accept = React.useCallback((data: BrandingState) => { setState(data); setName(data.branding.name || ""); setFile(null); setPreview(null); setRemove(false); setError("") }, [])
  const load = React.useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/settings/branding", { cache: "no-store", signal }), data = await response.json()
    if (!response.ok) throw new Error(data.error || "Unable to load branding.")
    accept(data)
  }, [accept])
  React.useEffect(() => {
    const abort = new AbortController()
    load(abort.signal).catch(e => { if (!abort.signal.aborted) setError(e.message) }).finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [load])
  async function selectFile(next: File | undefined) {
    const current = ++generation.current
    setFile(null); setPreview(null); setError(""); setProcessing(false)
    if (!next) return
    if (next.size > LOGO_UPLOAD_LIMIT) { setError("Choose an image up to 2 MB."); return }
    setProcessing(true)
    try {
      const form = new FormData(); form.set("logo", next)
      const response = await fetch("/api/settings/branding/preview", { method: "POST", body: form }), data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to prepare this image.")
      if (current !== generation.current) return
      setFile(next); setPreview(data); setRemove(false)
    } catch (e) { if (current === generation.current) setError((e as Error).message) }
    finally { if (current === generation.current) setProcessing(false) }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!state?.canManage || saving || processing) return
    setSaving(true); setError("")
    try {
      const form = new FormData(); form.set("name", name); form.set("version", String(state.version)); form.set("removeLogo", String(remove)); if (file) form.set("logo", file)
      const response = await fetch("/api/settings/branding", { method: "PATCH", body: form }), data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to save branding.")
      accept(data); router.refresh(); toast.success("Branding saved.")
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }
  const image = remove ? null : preview?.preview || state?.logoUrl
  const dimensions = preview || state?.branding.logo?.document
  const dirty = !!file || remove || name !== (state?.branding.name || "")
  return <div className={pageClass}>
    <PageHeader title="Branding" description="Your business identity in the application and on new documents." actions={<FormActions form="branding-form" cancelHref="/settings" saveLabel="Save branding" saving={saving} disabled={loading || processing || !dirty} canSave={state?.canManage ?? false} />} />
    {loading && <p>Loading branding...</p>}
    {error && <div role="alert" className="space-y-2 text-destructive"><p>{error}</p><Button variant="outline" disabled={saving || processing} onClick={() => { setLoading(true); load().catch(e => setError(e.message)).finally(() => setLoading(false)) }}>Refresh branding</Button></div>}
    {state && <form id="branding-form" onSubmit={save} className="space-y-6"><fieldset disabled={!state.canManage || saving} className="min-w-0 space-y-6">
      <Section title="Business identity"><FormField id="brand-name" label="Business display name"><Input id="brand-name" maxLength={200} placeholder={state.defaultName} value={name} onChange={e => setName(e.target.value)} /><p className="text-sm text-muted-foreground">Leave blank to use {state.defaultName}. This does not rename your tenant account.</p></FormField></Section>
      <Section title="Logo" description="Upload one image for the sidebar, invoices and quotations. Saved documents keep their original branding.">
        {!state.storageReady && <p role="status">Logo uploads are unavailable until your platform administrator configures storage.</p>}
        <FormField id="brand-logo" label="Upload logo"><Input key={state.version} id="brand-logo" type="file" accept="image/png,image/jpeg,image/webp" disabled={!state.storageReady || processing} onChange={e => void selectFile(e.target.files?.[0])} /><p className="text-sm text-muted-foreground">PNG, JPEG or WebP, up to 2 MB. We optimize each saved image to 512 KB or less, preserve transparency and never enlarge it.</p></FormField>
        {processing && <p role="status">Preparing optimized preview...</p>}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">{["Light background", "Dark background"].map((label, index) => <div key={label} className="space-y-2"><p className="text-sm">{label}</p><div className={`flex h-40 items-center justify-center rounded-lg border p-5 ${index ? "bg-zinc-900 text-white" : "bg-white text-zinc-900"}`}>
          {image ? <Image unoptimized src={image} alt={`${label} logo preview`} width={240} height={120} className="max-h-full max-w-full object-contain" /> : <span>{remove ? "Default ERP logo after saving" : "No custom logo"}</span>}
        </div></div>)}</div>
        {image && dimensions && <p className="mt-3 text-sm">Document image: {dimensions.width} × {dimensions.height} pixels · {Math.ceil(dimensions.bytes / 1024)} KB</p>}
        {preview?.warning && <p role="status" className="mt-2 text-sm text-amber-700 dark:text-amber-400">{preview.warning}</p>}
        {preview && <p className="text-sm text-muted-foreground">Sidebar image: {Math.ceil(preview.sidebarBytes / 1024)} KB. Review both backgrounds before saving.</p>}
        {image && <Button className="mt-3" type="button" variant="outline" disabled={processing} onClick={() => setConfirm(true)}>Remove logo</Button>}
        {remove && <p className="mt-3 text-sm">The logo will be removed when you save. Existing documents retain their saved logo.</p>}
      </Section>
    </fieldset></form>}
    {confirm && <ConfirmAction title="Remove this logo?" description="The application will return to its default logo after you save. Saved documents will not change." label="Remove logo" busy={false} onCancel={() => setConfirm(false)} onConfirm={() => { generation.current++; setFile(null); setPreview(null); setRemove(true); setConfirm(false) }} />}
  </div>
}
