import { CustomFieldEditor } from "@/modules/crm/components/custom-field-configuration"
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <CustomFieldEditor id={id === "new" ? undefined : id} /> }
