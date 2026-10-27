import { Prisma } from "@prisma/client"
import { moduleEnabled, type ModuleFlag } from "@/platform/modules"
import { permits } from "@/platform/access/policy"
import type { BusinessActor } from "@/platform/policy"
import type { DashboardPeriod } from "@/types/dashboard"
import { introductionWhere, responsibleUserWhere } from "@/platform/collaborators/report-scope"
import type { AttributionFilter } from "@/platform/collaborators/report-validation"
import { enquiryScope, opportunityScope } from "./policy"
import { crmDashboardSets } from "./dashboard-sets"
import type { CrmDashboard } from "./dashboard-types"

const label = (value:string) => value.toLowerCase().replace(/_/g," ").replace(/^./,c=>c.toUpperCase())
const rate = (part:number,total:number) => total ? Math.round(part/total*1000)/10 : null
// Project-directory counts remain independent; only their sales columns use these scopes.
export function dashboardSalesScopes(actor:BusinessActor,flags:ModuleFlag[],period:DashboardPeriod,filter:AttributionFilter={}) {
  const crm=moduleEnabled(flags,"crm") && permits(actor,"reports.read")
  const sales={assignee:responsibleUserWhere(filter),...introductionWhere(filter)}
  return {
    enquiries:crm && permits(actor,"enquiries.read") ? {AND:[enquiryScope(actor,"read"),sales],createdAt:{gte:period.start,lt:period.end}} : null,
    opportunities:crm && permits(actor,"opportunities.read") ? {AND:[opportunityScope(actor,"read"),sales],stage:{kind:"OPEN" as const,archived:false},pipeline:{archived:false},contact:{archived:false}} : null,
  }
}
export async function crmDashboard(tx:Prisma.TransactionClient,actor:BusinessActor,flags:ModuleFlag[],period:DashboardPeriod,filter:AttributionFilter={}):Promise<CrmDashboard> {
  const sets=crmDashboardSets(actor,flags,period,filter),result:CrmDashboard={enquiries:null,opportunities:null,activities:null}
  const count=async(sql:Prisma.Sql)=> (await tx.$queryRaw<{count:number}[]>(Prisma.sql`SELECT count(*)::int AS count FROM (${sql}) s`))[0].count
  if(sets.enquiries){
    const statuses=await tx.$queryRaw<{status:string;count:number}[]>(Prisma.sql`SELECT status::text,count(*)::int AS count FROM (${sets.enquiries}) s GROUP BY status ORDER BY status`)
    const total=statuses.reduce((n,r)=>n+r.count,0),converted=sets.pipeline ? await count(sets.converted!) : null
    result.enquiries={total,converted,conversionPercent:converted===null?null:rate(converted,total),statuses:statuses.map(r=>({label:r.status==="CLOSED"?"Lost":label(r.status),count:r.count}))}
  }
  if(sets.pipeline){
    const [open,won,lost,stages,values]=await Promise.all([count(sets.pipeline),count(sets.won!),count(sets.lost!),
      tx.$queryRaw<{label:string;count:number}[]>(Prisma.sql`SELECT "pipelineName"||' / '||"stageName" AS label,count(*)::int AS count FROM (${sets.pipeline}) s GROUP BY "stageId","pipelineName","stageName" ORDER BY count DESC,"stageId" LIMIT 8`),
      tx.$queryRaw<{currency:string;count:number;amount:string}[]>(Prisma.sql`SELECT currency,count(*)::int AS count,sum(amount)::text AS amount FROM (${sets.pipeline}) s GROUP BY currency ORDER BY currency`),
    ])
    result.opportunities={open,won,lost,winPercent:rate(won,won+lost),stages,values:values.map(r=>({...r,amount:new Prisma.Decimal(r.amount).toString()}))}
  }
  if(sets.completedActivities){
    const [calls,overdue,total,connected,types,upcoming]=await Promise.all([count(sets.completedCalls!),count(sets.overdueActivities!),count(sets.completedActivities),
      count(Prisma.sql`SELECT * FROM (${sets.completedCalls!}) s WHERE outcome='CONNECTED'`),
      tx.$queryRaw<{type:string;activityTypeName:string|null;count:number}[]>(Prisma.sql`SELECT type::text,"activityTypeId","activityTypeName",count(*)::int AS count FROM (${sets.completedActivities}) s GROUP BY type,"activityTypeId","activityTypeName" ORDER BY count DESC,"activityTypeId","activityTypeName",type LIMIT 8`),
      tx.$queryRaw<{id:string;title:string;type:string;activityTypeName:string|null;dueOn:Date;startsAt:Date|null}[]>(Prisma.sql`SELECT id,title,type::text,"activityTypeName","dueOn","startsAt" FROM (${sets.openActivities!}) s ORDER BY "dueOn","startsAt",id LIMIT 6`),
    ])
    result.activities={calls,connected,overdue,completed:total,types:types.map(r=>({label:r.activityTypeName||label(r.type),count:r.count})),upcoming:upcoming.map(r=>({id:r.id,title:r.title,type:r.activityTypeName||label(r.type),dueOn:r.dueOn.toISOString().slice(0,10),startsAt:r.startsAt?.toISOString()||null}))}
  }
  return result
}
