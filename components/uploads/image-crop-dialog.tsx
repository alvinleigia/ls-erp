"use client"
import * as React from "react"
import ReactCrop, { centerCrop, makeAspectCrop, type PercentCrop } from "react-image-crop"
import "react-image-crop/dist/ReactCrop.css"
import { RotateCcw, RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { croppedImageFile, drawRotatedImage, loadCropImage, rotatedDimensions, type ImageRotation } from "./image-preparation"

export type ImageCropDialogProps = { file: File; maxBytes: number; aspect?: number; onApply: (file: File) => void; onCancel: () => void }
export function ImageCropDialog({ file, maxBytes, aspect, onApply, onCancel }: ImageCropDialogProps) {
  const canvas = React.useRef<HTMLCanvasElement>(null)
  const mounted = React.useRef(false)
  React.useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [image, setImage] = React.useState<ImageBitmap>(), [rotation, setRotation] = React.useState<ImageRotation>(0)
  const [crop, setCrop] = React.useState<PercentCrop>({ unit: "%", x: 0, y: 0, width: 100, height: 100 })
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState("")
  React.useEffect(() => {
    let cancelled = false, owned: ImageBitmap | undefined
    void loadCropImage(file, maxBytes).then(bitmap => { owned = bitmap; if (cancelled) bitmap.close(); else setImage(bitmap) }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to read this image.") })
    return () => { cancelled = true; owned?.close() }
  }, [file, maxBytes])
  React.useEffect(() => {
    if (!image || !canvas.current) return
    try {
      drawRotatedImage(canvas.current, image, rotation)
      const size = rotatedDimensions(image.width, image.height, rotation)
      setCrop(aspect ? centerCrop(makeAspectCrop({ unit: "%", width: 100 }, aspect, size.width, size.height), size.width, size.height) : { unit: "%", x: 0, y: 0, width: 100, height: 100 })
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to rotate this image.") }
  }, [image, rotation, aspect])
  async function apply() {
    if (!canvas.current || !image || busy) return
    setBusy(true); setError("")
    try { const result = await croppedImageFile(file, image, crop, rotation, maxBytes); if (mounted.current) onApply(result) }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Unable to prepare this image.") }
    finally { if (mounted.current) setBusy(false) }
  }
  function reset() { setError(""); if (rotation) setRotation(0); else if (image) setCrop(aspect ? centerCrop(makeAspectCrop({ unit: "%", width: 100 }, aspect, image.width, image.height), image.width, image.height) : { unit: "%", x: 0, y: 0, width: 100, height: 100 }) }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onCancel() }}><DialogContent className="max-w-3xl" onEscapeKeyDown={e => { if (busy) e.preventDefault() }} onPointerDownOutside={e => { if (busy) e.preventDefault() }}>
    <DialogHeader><DialogTitle>Crop image</DialogTitle><DialogDescription>Drag the crop edges or use their arrow-key controls. Keep required text and document edges visible. Nothing is uploaded here.</DialogDescription></DialogHeader>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!image && !error && <p role="status" className="text-sm">Opening image...</p>}
    {image && <><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setRotation(r => ((r + 270) % 360) as ImageRotation)}><RotateCcw aria-hidden="true" />Rotate left</Button><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setRotation(r => ((r + 90) % 360) as ImageRotation)}><RotateCw aria-hidden="true" />Rotate right</Button><Button type="button" variant="outline" size="sm" disabled={busy} onClick={reset}>Reset crop</Button></div>
      <div className="flex min-w-0 justify-center overflow-hidden rounded-md border bg-muted/30 p-2"><ReactCrop crop={crop} onChange={(_, percent) => setCrop(percent)} aspect={aspect} disabled={busy} keepSelection><canvas ref={canvas} role="img" aria-label="Image to crop" className="block h-auto max-h-[44vh] max-w-full object-contain" /></ReactCrop></div>
      <p className="text-xs text-muted-foreground">Rotation: {rotation}°. JPEG/PNG only. The selected crop keeps its pixel resolution.</p></>}
    <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button><Button type="button" variant="outline" disabled={busy} onClick={() => onApply(file)}>Use original</Button><Button type="button" disabled={!image || busy || !crop.width || !crop.height} loading={busy} onClick={() => void apply()}>Apply crop</Button></div>
  </DialogContent></Dialog>
}
