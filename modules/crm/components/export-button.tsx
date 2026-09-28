"use client"
import { useState } from "react"
import { Download } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

export function ExportButton({ href, filename, disabled = false }: { href: string; filename: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  async function download() {
    setBusy(true)
    try {
      const response = await fetch(href, { cache: "no-store" })
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || "Unable to export records.") }
      if (!response.headers.get("content-type")?.includes("text/csv")) throw new Error("Unable to export. Refresh your session and try again.")
      const url = URL.createObjectURL(await response.blob()), link = document.createElement("a")
      link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { toast.error((error as Error).message) } finally { setBusy(false) }
  }
  return <Button type="button" variant="outline" loading={busy} disabled={disabled} onClick={() => void download()} title="Export all matching records, up to 2,000 rows"><Download aria-hidden="true" />Export CSV</Button>
}
