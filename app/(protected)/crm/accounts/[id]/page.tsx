import { AccountEditor } from "@/modules/crm/components/account-editor"
export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) { return <AccountEditor id={(await params).id} /> }
