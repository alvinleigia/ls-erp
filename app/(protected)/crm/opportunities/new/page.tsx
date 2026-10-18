import { NewOpportunity } from "@/application/crm/create-pages"
import type { CrmCreateQuery } from "@/modules/crm/view-context"

export default async function Page({ searchParams }: { searchParams: Promise<CrmCreateQuery> }) {
  return <NewOpportunity query={await searchParams} />
}
