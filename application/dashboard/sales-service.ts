import { addDaysToDateKey } from "@/lib/business-time"
import { Prisma, type PrismaClient } from "@prisma/client"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { permits } from "@/platform/access/policy"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { moduleEnabled } from "@/platform/modules"
import { serializationConflict } from "@/platform/database-errors"
import { attributionChoiceSchema, attributionQuery, hasIntroductionFilter } from "@/platform/collaborators/report-validation"
import { readAttributionChoices } from "@/platform/collaborators/report-choices"
import { crmDashboardSets } from "@/modules/crm/dashboard-sets"
import { documentDashboardSets } from "@/modules/sales-documents/dashboard-sets"
import { salesDashboard } from "./sales-summary"
import { dashboardSelectionSchema, dashboardRecordSchema, dashboardPageSchema, type DashboardSelection } from "./validation"
import { getRangeBounds, zonedDateTimeToUtc, toDateKeyInTimeZone } from "./period"
import type { DashboardKind, DashboardPeriod } from "@/types/dashboard"

type Identity=Pick<BusinessActor,"tenantId"|"userId"|"requestId">
type Tx=Prisma.TransactionClient
export function createDashboardSalesService(db:PrismaClient,identity:Identity) {
  async function run<T>(fn:(tx:Tx,actor:BusinessActor)=>Promise<T>):Promise<T>{
    for(let attempt=0;;attempt++)try{return await db.$transaction(async tx=>fn(tx,await authorizeBusinessOperation(tx,identity,"dashboard.read")),{isolationLevel:"Serializable",maxWait:20000,timeout:20000})}
    catch(e){if(serializationConflict(e)&&attempt<2)continue;if(serializationConflict(e))throw new BusinessError(409,"Dashboard access changed. Refresh and try again.");throw e}
  }
  async function context(tx:Tx,actor:BusinessActor,q:DashboardSelection,provided?:DashboardPeriod){
    const [flags,settings]=await Promise.all([tx.tenantModule.findMany({where:{tenantId:actor.tenantId},select:{key:true,allowed:true,enabled:true}}),tx.appSetting.findUnique({where:{tenantId:actor.tenantId},select:{timeZone:true,firstDayOfWeek:true}})])
    const timeZone=settings?.timeZone||"America/New_York",now=provided?.now||new Date()
    const bounds=getRangeBounds(q.range,settings?.firstDayOfWeek||"SUNDAY",q.startDate||null,q.endDate||null,timeZone)
    const period=provided||{start:zonedDateTimeToUtc(bounds.start.toISOString().slice(0,10),timeZone),end:zonedDateTimeToUtc(bounds.endExclusive.toISOString().slice(0,10),timeZone),now,today:toDateKeyInTimeZone(now,timeZone)}
    const from=toDateKeyInTimeZone(period.start,timeZone),through=addDaysToDateKey(toDateKeyInTimeZone(period.end,timeZone),-1)
    const sets={...crmDashboardSets(actor,flags,period,q),...documentDashboardSets(actor,flags,period,q)}
    const canFilterOrigin=!!(sets.enquiries||sets.pipeline||sets.quotations&&permits(actor,"opportunities.read")||sets.openActivities&&permits(actor,"enquiries.read")&&permits(actor,"opportunities.read"))
    const omitted:string[]=[]
    if(hasIntroductionFilter(q)){
      if(moduleEnabled(flags,"crm")&&permits(actor,"reports.read")&&permits(actor,"activities.read")&&!sets.openActivities)omitted.push("Activity widgets need read access to their sales sources for origin filtering.")
      if(moduleEnabled(flags,"salesDocuments")&&permits(actor,"quotations.read")&&!sets.quotations)omitted.push("Document widgets need opportunity Read for origin filtering.")
    }
    const selection={...attributionQuery(q),range:"custom",startDate:from,endDate:through}
    const links=Object.fromEntries(Object.entries(sets).filter(([,sql])=>sql!==null).map(([kind])=>[kind,`/dashboard/sales-records?${new URLSearchParams({...selection,kind})}`])) as Partial<Record<DashboardKind,string>>
    return {flags,period,sets,metadata:{from,through,timeZone,canFilterOrigin,omitted,links}}
  }
  return {
    summary(input:unknown,provided?:DashboardPeriod){
      const q=dashboardSelectionSchema.parse(input)
      return run(async(tx,actor)=>{const c=await context(tx,actor,q,provided);return {data:await salesDashboard(tx,actor,c.flags,c.period,q),metadata:c.metadata}})
    },
    choices(input:unknown){
      const {choice,q:search,selectedId,...filters}=(input&&typeof input==="object"&&!Array.isArray(input)?input:{}) as Record<string,unknown>
      const selection=attributionChoiceSchema.parse({choice,q:search,selectedId}),q=dashboardPageSchema.parse(filters)
      return run(async(tx,actor)=>{
        const c=await context(tx,actor,q)
        if(!c.metadata.canFilterOrigin)throw new BusinessError(403,"Origin choices require readable sales sources.")
        const sources=Prisma.join((["enquiries","pipeline","won","lost","openActivities","completedActivities","quotations","planDocuments"] as const).map(kind=>c.sets[kind]).filter((sql):sql is Prisma.Sql=>sql!==null).map(sql=>Prisma.sql`SELECT id,"createdAt",partner,evidence FROM (${sql}) s`)," UNION ALL ")
        return readAttributionChoices(tx,actor.tenantId,sources,selection,q.page,q.pageSize)
      })
    },
    records(input:unknown){
      const q=dashboardRecordSchema.parse(input)
      return run(async(tx,actor)=>{
        const c=await context(tx,actor,q),sql=c.sets[q.kind]
        if(!sql)throw new BusinessError(403,"This dashboard selection is not available with your current access.")
        const work=["openActivities","overdueActivities","completedActivities","completedCalls"].includes(q.kind),completed=q.kind.startsWith("completed")
        const quote=q.kind==="quotations"||q.kind==="planDocuments",instalment=q.kind.endsWith("Instalments"),lead=q.kind==="enquiries"||q.kind==="converted"
        const closed=q.kind==="won"||q.kind==="lost"
        const date=closed?Prisma.sql`"closedAt"`:work?(completed?Prisma.sql`"completedAt"`:Prisma.sql`"dueOn"`):instalment?Prisma.sql`NULLIF("dueDate",'')::date`:Prisma.sql`"createdAt"`
        const amount=quote?Prisma.sql`consideration::text`:instalment||!work&&!lead?Prisma.sql`amount::text`:Prisma.sql`NULL::text`
        const [{total}]=await tx.$queryRaw<{total:number}[]>(Prisma.sql`SELECT count(*)::int AS total FROM (${sql}) s`)
        const items=await tx.$queryRaw<{id:string;recordId:string;title:string;owner:string|null;date:Date|null;amount:string|null;currency:string|null;detail:string|null}[]>(Prisma.sql`SELECT id,${instalment?Prisma.sql`"documentId"`:Prisma.sql`id`} AS "recordId",title,owner,${date} AS date,${amount} AS amount,${work||lead?Prisma.sql`NULL::text`:Prisma.sql`currency` } AS currency,${instalment?Prisma.sql`label`:work?Prisma.sql`COALESCE("activityTypeName",type::text)`:lead?Prisma.sql`status::text`:quote?Prisma.sql`'Version '||version::text`:Prisma.sql`"pipelineName"||' / '||"stageName"`} AS detail
          FROM (${sql}) s ORDER BY ${instalment?Prisma.sql`"dueDate" ASC NULLS LAST`:work&&!completed?Prisma.sql`"dueOn" ASC`:closed?Prisma.sql`"closedAt" DESC`:Prisma.sql`"createdAt" DESC`},id LIMIT ${q.pageSize} OFFSET ${(q.page-1)*q.pageSize}`)
        const path=work?"/crm/activities":lead?"/crm/enquiries":quote||instalment?"/crm/quotations":"/crm/opportunities"
        return {...c.metadata,kind:q.kind,dateOnly:instalment||work&&!completed,items:items.map(r=>({...r,date:r.date?.toISOString()||null,amount:r.amount===null?null:new Prisma.Decimal(r.amount).toString(),href:`${path}/${encodeURIComponent(r.recordId)}`})),total,page:q.page,pageSize:q.pageSize,totalPages:Math.max(1,Math.ceil(total/q.pageSize))}
      })
    },
  }
}
