"use client"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { CrmSection } from "@/modules/crm/components/crm-section"
import { choiceKinds, choiceTitles } from "../choices"
import { useRealEstateEnabled } from "./property-fields"
export function PropertyConfigurationLinks() {
  const enabled = useRealEstateEnabled()
  if (!enabled) return null
  return <CrmSection title="Real Estate" description="Configure project and buyer choices for this business. Project statuses are separate from opportunity stages.">
    <div className="grid gap-3 md:grid-cols-3">{choiceKinds.map(kind => <Link key={kind} href={`/crm/configuration/real-estate/${kind}`} className="flex items-center justify-between gap-2 rounded-lg border bg-background p-4 font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{choiceTitles[kind]}<ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /></Link>)}</div>
  </CrmSection>
}
