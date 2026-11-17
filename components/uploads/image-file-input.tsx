"use client"
/* eslint-disable @next/next/no-img-element -- Private local blob previews must not use the server image optimizer. */
import * as React from "react"
import dynamic from "next/dynamic"
import { Crop } from "lucide-react"
import { Button } from "@/components/ui/button"

const ImageCropDialog = dynamic(() => import("./image-crop-dialog").then(m => m.ImageCropDialog), { ssr: false })
type Props = { id: string; value: File | null; onChange: (file: File | null) => void; maxBytes: number; accept: string; disabled?: boolean; aspect?: number }
const fileSize = (bytes: number) => bytes >= 1024 * 1024 ? `${Math.ceil(bytes / 1024 / 1024 * 100) / 100} MB` : `${Math.ceil(bytes / 1024)} KB`
export function ImageFileInput({ id, value, onChange, maxBytes, accept, disabled, aspect }: Props) {
  const input = React.useRef<HTMLInputElement>(null)
  const [original, setOriginal] = React.useState<File | null>(null), [editing, setEditing] = React.useState(false), [preview, setPreview] = React.useState<{ file: File; url: string } | null>(null)
  const [selectionError, setSelectionError] = React.useState("")
  React.useEffect(() => { if (!value) { if (input.current) input.current.value = ""; setOriginal(null); setEditing(false) } }, [value])
  React.useEffect(() => {
    let cancelled = false, url: string | undefined
    setPreview(null)
    if (value && ["image/jpeg", "image/png"].includes(value.type)) {
      // Check bounded image headers before asking the browser to decode a thumbnail.
      void import("./image-preparation").then(async ({ imageDimensions }) => {
        imageDimensions(new Uint8Array(await value.arrayBuffer()), value.type)
        if (!cancelled) { url = URL.createObjectURL(value); setPreview({ file: value, url }) }
      }).catch(() => { /* Invalid images remain subject to crop and server validation. */ })
    }
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [value])
  const source = original ?? value, canCrop = source && ["image/jpeg", "image/png"].includes(source.type)
  function select(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null
    setEditing(false); setSelectionError("")
    if (next && (!next.size || next.size > maxBytes)) {
      setSelectionError(next.size ? `Selected file is ${fileSize(next.size)}. Maximum allowed is ${fileSize(maxBytes)}. Choose a smaller file.` : "The selected file is empty. Choose a file with content.")
      setOriginal(null); onChange(null); event.target.value = ""
      return
    }
    setOriginal(next); onChange(next)
  }
  return <div className="min-w-0 space-y-2"><input ref={input} id={id} type="file" accept={accept} disabled={disabled} aria-invalid={selectionError ? true : undefined} aria-describedby={selectionError ? `${id}-error` : undefined} className="block w-full min-w-0 text-sm file:mr-2 file:rounded-md file:border file:bg-background file:px-3 file:py-2" onChange={select} />
    {selectionError && <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{selectionError}</p>}
    {canCrop && <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setEditing(true)}><Crop aria-hidden="true" />{value === source ? "Crop image" : "Edit crop"}</Button>}
    {preview && value && preview.file === value && <div className="space-y-1"><img src={preview.url} alt={original && value !== original ? "Cropped image preview" : "Selected image preview"} className="max-h-32 max-w-full rounded-md border object-contain" /><p className="break-all text-xs text-muted-foreground">Ready to upload: {value.name} ({Math.ceil(value.size / 1024)} KB)</p></div>}
    {editing && source && <ImageCropDialog file={source} maxBytes={maxBytes} aspect={aspect} onCancel={() => setEditing(false)} onApply={file => { onChange(file); setEditing(false) }} />}
  </div>
}
