import { PropertyConfigurationLinks } from "@/modules/real-estate/components/configuration-links"
import { AccessPageHeader } from "@/platform/access/record-page"
import { pageClass } from "@/components/erp/page"
export default function Page() { return <div className={pageClass}><AccessPageHeader title="Real Estate configuration" backHref="/crm/projects" /><PropertyConfigurationLinks /></div> }
