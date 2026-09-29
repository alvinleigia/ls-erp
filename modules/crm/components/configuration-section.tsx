import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { CrmPageHeader, crmPageClass } from "./crm-page"
import { CrmSection } from "./crm-section"
import { crmConfigurationGroups } from "../configuration"

export function ConfigurationSection({ activities = false }: { activities?: boolean }) {
  const group = crmConfigurationGroups[activities ? 1 : 0]
  return <div className={crmPageClass}><CrmPageHeader title={activities ? "Activity configuration" : "CRM configuration"} description="Managers and administrators can configure these options." />
    <CrmSection title={group.title} description={group.description}><div className="grid gap-3 md:grid-cols-3">{group.items.map(item => <Link key={item.href} href={item.href} className="rounded-lg border bg-background p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="flex items-center justify-between gap-2"><h3 className="font-medium">{item.title}</h3><ArrowRight aria-hidden="true" className="size-4 shrink-0" /></div><p className="mt-2 text-sm text-muted-foreground">{item.description}</p></Link>)}</div></CrmSection>
  </div>
}
