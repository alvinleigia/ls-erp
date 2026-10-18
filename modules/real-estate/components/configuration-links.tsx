"use client"
import { useTerminology } from "@/platform/terminology/provider"
import Link from "@/platform/access/link"
import { ArrowRight } from "lucide-react"
import { Section } from "@/components/erp/section"
import { choiceKinds, choiceTitles } from "../choices"
import { useRealEstateEnabled } from "./property-fields"
export function PropertyConfigurationLinks() {
  const term = useTerminology()
  const enabled = useRealEstateEnabled()
  if (!enabled) return null
  return <Section title="Real Estate" description={term("realEstate.project.singular", "Configure project and buyer choices for this business.", "Configure {label} and buyer choices for this business.") + " " + term("realEstate.project.singular", "Project statuses are separate from", "{label} statuses are separate from") + " " + term("crm.opportunity.singular", "opportunity stages.", "{label} stages.")}>
    <div className="grid gap-3 md:grid-cols-3">{choiceKinds.map(kind => <Link key={kind} href={`/crm/configuration/real-estate/${kind}`} className="flex items-center justify-between gap-2 rounded-lg border bg-background p-4 font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{choiceTitles[kind]}<ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /></Link>)}</div>
  </Section>
}
