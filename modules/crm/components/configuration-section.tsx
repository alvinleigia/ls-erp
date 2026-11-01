"use client"
import { InfoHelp } from "@/components/erp/info-help"
import { useBusinessModules } from "@/platform/module-provider"
import { useRouteAccess } from "@/platform/access/route-provider"
import Link from "@/platform/access/link"
import { ArrowRight } from "lucide-react"
import { AccessPageHeader } from "@/platform/access/record-page"
import { pageClass } from "@/components/erp/page"
import { Section } from "@/components/erp/section"
import { getCrmConfigurationGroups } from "../configuration"
import { useTerminology } from "@/platform/terminology/provider"

export function ConfigurationSection({ activities = false }: { activities?: boolean }) {
  const term = useTerminology()
  const { routeRequirement } = useRouteAccess()
  const { can } = useBusinessModules()
  const group = getCrmConfigurationGroups(term)[activities ? 1 : 0]
  return <div className={pageClass}><AccessPageHeader title={activities ? term("crm.activity.singular", "Activity configuration", "{label} configuration") : "CRM configuration"} description="Configure the options included in your access profile." />
    <Section title={group.title} description={group.description}><div className="grid gap-3 md:grid-cols-3">{group.items.filter(item => can(routeRequirement(item.href)!)).map(item => <div key={item.href} className="relative rounded-lg border bg-background p-4 transition-colors hover:bg-accent"><div className="flex items-center justify-between gap-2"><Link href={item.href} className="flex min-w-0 flex-1 items-center justify-between gap-2 after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><h3 className="font-medium">{item.title}</h3><ArrowRight aria-hidden="true" className="size-4 shrink-0" /></Link><InfoHelp title={item.title} className="relative z-10">{item.description}</InfoHelp></div></div>)}</div></Section>
  </div>
}
