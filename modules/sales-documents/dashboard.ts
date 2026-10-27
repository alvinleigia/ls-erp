import { Prisma } from "@prisma/client"
import type { ModuleFlag } from "@/platform/modules"
import type { BusinessActor } from "@/platform/policy"
import type { AttributionFilter } from "@/platform/collaborators/report-validation"
import type { DashboardPeriod } from "@/types/dashboard"
import type { DocumentDashboard } from "./dashboard-types"
import { documentDashboardSets } from "./dashboard-sets"

export async function documentDashboard(tx:Prisma.TransactionClient,actor:BusinessActor,flags:ModuleFlag[],period:DashboardPeriod,filter:AttributionFilter={}):Promise<DocumentDashboard> {
  const sets=documentDashboardSets(actor,flags,period,filter),result:DocumentDashboard={quotations:null,paymentPlans:null}
  const count=async(sql:Prisma.Sql)=>(await tx.$queryRaw<{count:number}[]>(Prisma.sql`SELECT count(*)::int AS count FROM (${sql}) s`))[0].count
  const values=async(sql:Prisma.Sql,amount:Prisma.Sql)=>(await tx.$queryRaw<{currency:string;count:number;amount:string}[]>(Prisma.sql`SELECT currency,count(*)::int AS count,sum(${amount})::text AS amount FROM (${sql}) s GROUP BY currency ORDER BY currency`)).map(r=>({...r,amount:new Prisma.Decimal(r.amount).toString()}))
  if(sets.quotations){
    const [total,amounts,recent]=await Promise.all([count(sets.quotations),values(sets.quotations,Prisma.sql`consideration`),tx.$queryRaw<{id:string;title:string;currency:string;amount:string;version:number;createdAt:Date}[]>(Prisma.sql`SELECT id,title,currency,consideration::text AS amount,version,"createdAt" FROM (${sets.quotations}) s ORDER BY "createdAt" DESC,id LIMIT 6`)])
    result.quotations={total,values:amounts,recent:recent.map(r=>({...r,amount:new Prisma.Decimal(r.amount).toString(),createdAt:r.createdAt.toISOString()}))}
  }
  if(sets.planDocuments){
    const [documents,undated,upcomingCount,amounts,upcoming]=await Promise.all([count(sets.planDocuments),count(sets.undatedInstalments!),count(sets.upcomingInstalments!),values(sets.upcomingInstalments!,Prisma.sql`amount::numeric`),tx.$queryRaw<{id:string;title:string;currency:string;label:string;dueDate:string;amount:string}[]>(Prisma.sql`SELECT "documentId" AS id,title,currency,label,"dueDate",amount FROM (${sets.upcomingInstalments!}) s ORDER BY "dueDate","documentId",position LIMIT 6`)])
    result.paymentPlans={documents,undated,upcomingCount,values:amounts,upcoming}
  }
  return result
}
