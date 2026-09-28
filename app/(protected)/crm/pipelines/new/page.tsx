import { PipelineEditor } from "@/modules/crm/components/pipeline-editor"
export default async function Page({ searchParams }: { searchParams: Promise<{ template?: string }> }) { return <PipelineEditor propertyTemplate={(await searchParams).template === "property"} /> }
