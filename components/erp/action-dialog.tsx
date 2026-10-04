"use client"

import type { ReactNode } from "react"
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

/** Workflow dialogs keep their reviewed action visible while long content scrolls. */
export function ActionDialogContent({ title, description, actions, children, className }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string;
}) {
  return <DialogContent className={cn("flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl", className)}>
    <DialogHeader className="shrink-0 border-b p-5 pr-12"><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
    <div className="min-h-0 space-y-4 overflow-y-auto p-5">{children}</div>
    {actions && <DialogFooter className="shrink-0 flex-wrap border-t bg-background p-4">{actions}</DialogFooter>}
  </DialogContent>
}
