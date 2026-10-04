"use client"

import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"

export function ConfirmAction({ title, description, label, busy, destructive = false, onCancel, onConfirm }: {
  title: string; description: ReactNode; label: string; busy: boolean; destructive?: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  return <Dialog open onOpenChange={open => { if (!open && !busy) onCancel() }}><DialogContent onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onInteractOutside={event => { if (busy) event.preventDefault() }}>
    <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
    <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button><Button type="button" variant={destructive ? "destructive" : "default"} loading={busy} loadingText="Working..." onClick={onConfirm}>{label}</Button></DialogFooter>
  </DialogContent></Dialog>
}
