import { WorkEditor } from "@/modules/crm/components/work-editor"
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <WorkEditor id={(await params).id} /> }
