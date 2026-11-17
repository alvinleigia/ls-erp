"use client"
/* eslint-disable @next/next/no-img-element -- Private local blob previews must not use the server image optimizer. */
import * as React from "react"
import dynamic from "next/dynamic"
import { Crop } from "lucide-react"
import { Button } from "@/components/ui/button"

const ImageCropDialog = dynamic(() => import("./image-crop-dialog").then(m => m.ImageCropDialog), { ssr: false })
type Props = { id: string; value: File | null; onChange: (file: File | null) => void; maxBytes: number; accept: string; disabled?: boolean; aspect?: number }
export function ImageFileInput({ id, value, onChange, maxBytes, accept, disabled, aspect }: Props) {
  const input = React.useRef<HTMLInputElement>(null)
  const [original, setOriginal] = React.useState<File | null>(null), [editing, setEditing] = React.useState(false), [preview, setPreview] = React.useState("")
  React.useEffect(() => { if (!value) { if (input.current) input.current.value = ""; setOriginal(null); setEditing(false) } }, [value])
  React.useEffect(() => {
    if (!value || !original || value === original) { setPreview(""); return }
    const url = URL.createObjectURL(value); setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [value, original])
  const source = original ?? value, canCrop = source && ["image/jpeg", "image/png"].includes(source.type)
  return <div className="min-w-0 space-y-2"><input ref={input} id={id} type="file" accept={accept} disabled={disabled} className="block w-full min-w-0 text-sm file:mr-2 file:rounded-md file:border file:bg-background file:px-3 file:py-2" onChange={e => { const next = e.target.files?.[0] ?? null; setOriginal(next); setEditing(false); onChange(next) }} />
    {canCrop && <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setEditing(true)}><Crop aria-hidden="true" />{value === source ? "Crop image" : "Edit crop"}</Button>}
    {preview && value && <div className="space-y-1"><img src={preview} alt="Cropped image preview" className="max-h-32 max-w-full rounded-md border object-contain" /><p className="break-all text-xs text-muted-foreground">Ready to upload: {value.name} ({Math.ceil(value.size / 1024)} KB)</p></div>}
    {editing && source && <ImageCropDialog file={source} maxBytes={maxBytes} aspect={aspect} onCancel={() => setEditing(false)} onApply={file => { onChange(file); setEditing(false) }} />}
  </div>
}
