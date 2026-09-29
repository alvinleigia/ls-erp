import { PropertyConfigurationLinks } from "@/modules/real-estate/components/configuration-links"
import { CrmPageHeader, crmPageClass } from "@/modules/crm/components/crm-page"
export default function Page() { return <div className={crmPageClass}><CrmPageHeader title="Real Estate configuration" backHref="/crm/projects" /><PropertyConfigurationLinks /></div> }
