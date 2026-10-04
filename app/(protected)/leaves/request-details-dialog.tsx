"use client"

import { RecordPanel, ReadOnlyFields } from "@/components/erp/record-detail"
import { Section } from "@/components/erp/section"
import { Timeline } from "@/components/erp/timeline"
import { Clock } from "lucide-react"
import { useDateFormatter } from "@/hooks/use-date-formatter"

import * as React from "react"
import { toast } from "sonner"

import type { LeaveRequestDetail } from "@/types/leaves"

type LeaveRequestDetailsDialogProps = {
  requestId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LeaveRequestDetailsDialog({
  requestId,
  open,
  onOpenChange,
}: LeaveRequestDetailsDialogProps) {
  const { formatDate } = useDateFormatter()
  const [loading, setLoading] = React.useState(false)
  const [detail, setDetail] = React.useState<LeaveRequestDetail | null>(null)

  React.useEffect(() => {
    if (!open || !requestId) return
    let active = true
    setLoading(true)
    void fetch(`/api/leaves/requests/${requestId}?includeRuleChecks=true`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string }
          throw new Error(data.error ?? "Unable to load leave request details.")
        }
        return response.json() as Promise<LeaveRequestDetail>
      })
      .then((data) => {
        if (!active) return
        setDetail(data)
      })
      .catch((error: unknown) => {
        if (!active) return
        toast.error(error instanceof Error ? error.message : "Unable to load leave request details.")
        setDetail(null)
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, requestId])

  const item = detail?.item

  if (!open) return null
  return <RecordPanel title="Leave request details" description={item ? `${item.leaveDefinition.code} - ${item.leaveDefinition.name}` : "Request history and rule checks."} onClose={() => onOpenChange(false)}>
    {loading ? <p>Loading...</p> : item && detail ? <>
      <Section title="Request details"><ReadOnlyFields fields={[
        { label: "Staff", value: item.staff.name || item.staff.email }, { label: "Status", value: item.status },
        { label: "Start date", value: formatDate(item.startDate) }, { label: "End date", value: formatDate(item.endDate) },
        { label: "Days", value: item.daysCount }, { label: "Reason", value: item.reason },
      ]} /></Section>
      <Section title="Timeline"><Timeline entries={detail.timeline.map(event => ({ id: event.key, icon: Clock, actor: event.byName || event.byEmail || "System", action: event.title, dateTime: event.at, timeLabel: new Date(event.at).toLocaleString(), detail: event.comment || event.title }))} /></Section>
      <Section title="Rule checks">{detail.ruleChecks.map(check => <div key={check.key} className="space-y-1 border-b pb-3 last:border-0"><p className="font-medium">{check.label}</p><p className={check.passed ? "text-sm text-emerald-600" : "text-sm text-destructive"}>{check.detail}</p></div>)}</Section>
    </> : <p role="alert">Unable to load leave request details.</p>}
  </RecordPanel>
}
