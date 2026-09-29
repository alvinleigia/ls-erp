import { PipelineEditor } from "@/modules/crm/components/pipeline-editor"
import { propertySalesPipeline } from "@/modules/real-estate/pipeline-template"
export default async function Page({ searchParams }: { searchParams: Promise<{ template?: string }> }) { return <PipelineEditor template={(await searchParams).template === "property" ? propertySalesPipeline : undefined} /> }
