import { ReceivableOverviewPage } from "@/modules/receivables/components/overview"
import { BusinessViewGuard } from "@/platform/access/view-guard"
export default function Page() { return <BusinessViewGuard module="receivables"><ReceivableOverviewPage /></BusinessViewGuard> }
