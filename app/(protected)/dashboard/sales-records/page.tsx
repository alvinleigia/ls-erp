import { Suspense } from "react"
import { DashboardRecords } from "@/application/dashboard/records"
export default function Page(){return <Suspense fallback={<p>Loading dashboard records...</p>}><DashboardRecords /></Suspense>}
