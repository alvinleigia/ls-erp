"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"

export function ReloadDraft({ onReload, label = "Reload saved details", disabled = false }: { onReload: () => void; label?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  return <><Button type="button" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>{label}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Discard draft and reload?</DialogTitle><DialogDescription>Your unsaved changes will be discarded and replaced by the saved data.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Keep editing</Button><Button onClick={() => { setOpen(false); onReload() }}>Discard and reload</Button></DialogFooter></DialogContent></Dialog>
  </>
}
