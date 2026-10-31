import { SalesReports } from "@/modules/crm/components/sales-reports"
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams
  return <SalesReports initialView={view === "team" ? "team" : "sales"} />
}
