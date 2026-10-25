import { CompanyStructureEditor } from "@/platform/companies/controls"
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <CompanyStructureEditor key={id} kind="company" id={id} /> }
