import type { DashboardKind } from "@/types/dashboard"
import type { CrmDashboard } from "@/modules/crm/dashboard-types"
import type { ProjectDashboard } from "@/modules/real-estate/dashboard-types"
import type { DocumentDashboard } from "@/modules/sales-documents/dashboard-types"

export type SalesDashboard = CrmDashboard & ProjectDashboard & DocumentDashboard

export type DashboardFilterContext = { from:string;through:string;timeZone:string;canFilterOrigin:boolean;omitted:string[];links:Partial<Record<DashboardKind,string>> }
export type DashboardRecordResponse = DashboardFilterContext & {kind:DashboardKind;dateOnly:boolean;items:{id:string;recordId:string;title:string;owner:string|null;date:string|null;amount:string|null;currency:string|null;detail:string|null;href:string}[];total:number;page:number;pageSize:number;totalPages:number}
