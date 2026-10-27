"use client"
import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { PageHeader, Surface, pageClass } from "@/components/erp/page"
import { PreviewTable } from "@/components/dashboard/widgets"
import { Pagination } from "@/components/erp/pagination"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { formatDecimalCurrency } from "@/lib/formatting"
import type { DashboardRecordResponse } from "./types"
import { dashboardKinds, type DashboardKind } from "@/types/dashboard"

const labels:Record<DashboardKind,string>={enquiries:"New enquiries",converted:"Converted enquiries",pipeline:"Open opportunities",won:"Won opportunities",lost:"Lost opportunities",openActivities:"Open activities",overdueActivities:"Overdue activities",completedActivities:"Completed activities",completedCalls:"Completed calls",quotations:"Quotations created",planDocuments:"Quotations with plans",upcomingInstalments:"Upcoming instalments",undatedInstalments:"Instalments without dates"}
export function DashboardRecords(){
  const search=useSearchParams(),[page,setPage]=React.useState(1),[data,setData]=React.useState<DashboardRecordResponse|null>(null),[loading,setLoading]=React.useState(true),[error,setError]=React.useState("")
  const {formatDate,formatDateOnly}=useDateFormatter(),selection=search.toString()
  React.useEffect(()=>setPage(1),[selection])
  React.useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError("");setData(null)
    const params=new URLSearchParams(selection);params.set("page",String(page));params.set("pageSize","20")
    fetch(`/api/dashboard/sales-records?${params}`,{signal:controller.signal,cache:"no-store"}).then(async response=>{const result=await response.json();if(!response.ok)throw Error(result.error||"Unable to load dashboard records.");if(!controller.signal.aborted)setData(result)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[selection,page])
  const kind=search.get("kind") as DashboardKind,title=dashboardKinds.includes(kind)?labels[kind]:"Dashboard records"
  return <section className={pageClass}><PageHeader title={title} description="Records matching the dashboard selection, within your current access." backHref="/dashboard" />
    {data&&<p className="text-sm text-muted-foreground">Period figures: {formatDateOnly(data.from)} through {formatDateOnly(data.through)} in {data.timeZone}. Open work and pipeline use the current position. Planned instalments use current quotation versions and the next 30 days; undated plans have no due date. Currencies remain separate.</p>}
    {error&&<p role="alert" className="text-destructive">{error}</p>}
    {loading?<p role="status">Loading dashboard records...</p>:data&&<Surface><PreviewTable columns={["Record","Assigned user","Date","Details","Value"]} rows={data.items.map(row=>({key:row.id,cells:[<Link key="record" className="font-medium underline" href={row.href}>{row.title}</Link>,row.owner||"Unavailable",row.date?(data.dateOnly?formatDateOnly(row.date.slice(0,10)):formatDate(row.date)):"Undated",row.detail||"",row.amount!==null&&row.currency?formatDecimalCurrency(row.amount,row.currency):""]}))} empty="No matching dashboard records." /><Pagination page={page} pageSize={20} total={data.total} totalPages={data.totalPages} loading={loading} onPageChange={setPage} /></Surface>}
  </section>
}
