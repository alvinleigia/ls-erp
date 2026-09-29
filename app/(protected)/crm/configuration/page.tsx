import { PropertyConfigurationLinks } from "@/modules/real-estate/components/configuration-links"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { CrmPageHeader, crmPageClass } from "@/modules/crm/components/crm-page"
import { CrmSection } from "@/modules/crm/components/crm-section"
import { crmConfigurationGroups } from "@/modules/crm/configuration"

export default function CrmConfigurationPage() {
  return <div className={crmPageClass}>
    <CrmPageHeader title="CRM Configuration" description="Manage your sales process and activity settings in one place. Managers and administrators can make changes." />
    {crmConfigurationGroups.map(group => <CrmSection key={group.title} title={group.title} description={group.description}>
      <div className="grid gap-3 md:grid-cols-3">{group.items.map(item => <Link key={item.href} href={item.href} className="group rounded-lg border bg-background p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex items-center justify-between gap-2"><h3 className="font-medium">{item.title}</h3><ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /></div>
        <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
      </Link>)}</div>
    </CrmSection>)}
    <PropertyConfigurationLinks />
  </div>
}
