import { ApplicationCatalogEditor } from "@/application/catalog/editor"
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <ApplicationCatalogEditor id={(await params).id} /> }
