import { BusinessViewGuard } from '@/platform/access/view-guard'
export default function Layout({children}:{children:React.ReactNode}){return <BusinessViewGuard module="invoicing">{children}</BusinessViewGuard>}
