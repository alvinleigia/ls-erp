"use client"
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
    <Section title={group.title} description={group.description}><div className="grid gap-3 md:grid-cols-3">{group.items.filter(item => can(routeRequirement(item.href)!)).map(item => <Link key={item.href} href={item.href} className="rounded-lg border bg-background p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="flex items-center justify-between gap-2"><h3 className="font-medium">{item.title}</h3><ArrowRight aria-hidden="true" className="size-4 shrink-0" /></div><p className="mt-2 text-sm text-muted-foreground">{item.description}</p></Link>)}</div></Section>
  </div>
}
