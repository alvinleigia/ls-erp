import { PipelineEditor } from "@/modules/crm/components/pipeline-editor"
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <PipelineEditor id={(await params).id} /> }
