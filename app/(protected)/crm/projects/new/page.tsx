import { ProjectEditor } from "@/modules/real-estate/components/project-editor"
export default async function Page({ searchParams }: { searchParams: Promise<{ parentId?: string }> }) {
  const { parentId } = await searchParams
  return <ProjectEditor key={parentId || "new"} parentId={parentId} />
}
