import { ApplicationCatalogEditor } from "@/application/catalog/editor"
export default async function Page({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams
  return <ApplicationCatalogEditor projectId={projectId} />
}
