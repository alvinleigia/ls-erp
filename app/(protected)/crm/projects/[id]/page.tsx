import { ProjectEditor } from "@/modules/real-estate/components/project-editor"
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ProjectEditor key={id} id={id} />
}
