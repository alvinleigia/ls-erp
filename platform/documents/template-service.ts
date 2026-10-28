import type { Prisma, PrismaClient } from "@prisma/client"
import { authorizeBusinessOperation } from "../access/operation"
import { satisfies } from "../access/policy"
import type { BusinessActor } from "../policy"
import { lockTenantOperations } from "../transactions/tenant-lock"
import { BusinessError } from "../policy"
import { moduleEnabled, type BusinessModuleKey } from "../modules"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { documentKey, documentTemplateSchema,documentCatalogSchema } from "./validation"
import type { DocumentContent } from "./validation"
import type { DocumentIdentity } from "./contracts"
export type DocumentTypeInfo = { key: string; name: string; modules: readonly BusinessModuleKey[]; defaults: DocumentContent }
export function createDocumentTemplateService(db: PrismaClient, identity: DocumentIdentity, providers: readonly DocumentTypeInfo[]) {
  const registry=new Map(providers.map(row=>[row.key,row]))
  async function run<T>(write: boolean, operation: (tx: Prisma.TransactionClient,actor:BusinessActor) => Promise<T>) {
    return db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${identity.tenantId} FOR UPDATE`
      await lockTenantOperations(tx,identity.tenantId)
      const actor=await authorizeBusinessOperation(tx,identity,write?["documentTemplates.read","documentTemplates.edit"]:"documentTemplates.read")
      if(write&&actor.role!=="ADMIN")throw new BusinessError(403,"A tenant administrator must publish company document templates.")
      return operation(tx,actor)
    },{isolationLevel:"ReadCommitted",maxWait:20000,timeout:20000})
  }
  return {
    catalog(input:unknown={}) {
      const {q,page,pageSize}=documentCatalogSchema.parse(input)
      return run(false,async(tx,actor)=>{
        const [[population],flags]=await Promise.all([tx.$queryRaw<{items:{id:string;name:string}[];total:number}[]>`
          WITH permitted AS MATERIALIZED (SELECT id,name FROM app.document_template_companies(${identity.tenantId}) WHERE NOT archived AND strpos(lower(name),lower(${q}))>0),
          page AS (SELECT * FROM permitted ORDER BY name,id LIMIT ${pageSize} OFFSET ${(page-1)*pageSize})
          SELECT coalesce((SELECT jsonb_agg(p ORDER BY name,id) FROM page p),'[]'::jsonb) AS items,(SELECT count(*)::integer FROM permitted) AS total`,tx.tenantModule.findMany({where:{tenantId:identity.tenantId}})])
        const {items,total}=population
        return {items,total,page,pageSize,totalPages:Math.max(1,Math.ceil(total/pageSize)),canPublish:actor.role==="ADMIN"&&satisfies(actor,"documentTemplates.edit"),providers:providers.filter(provider=>provider.modules.every(key=>moduleEnabled(flags,key))).map(({key,name})=>({key,name}))}
      })
    },
    get(companyId:string,providerKey:string) {
      documentKey.parse(providerKey)
      return run(false,async(tx,actor)=>{
        const provider=registry.get(providerKey);if(!provider)throw new BusinessError(400,"Choose a registered document type.")
        const current=await tx.businessDocumentTemplate.findFirst({where:{tenantId:identity.tenantId,companyId,providerKey},orderBy:{version:"desc"}})
        if(!current&&actor.role!=="ADMIN")throw new BusinessError(404,"Published document template not found.")
        const [company]=await tx.$queryRaw<{id:string;name:string;archived:boolean}[]>`SELECT * FROM app.document_template_companies(${identity.tenantId}) WHERE id=${companyId}`
        if(!company)throw new BusinessError(404,"Issuing company not found.")
        return {company,providerKey,version:current?.version??0,content:current?.content??provider.defaults}
      })
    },
    publish(input:unknown) {
      const data=documentTemplateSchema.parse(input),provider=registry.get(data.providerKey)
      if(!provider)throw new BusinessError(400,"Choose a registered document type.")
      return run(true,async tx=>{
        await authorizeBusinessOperation(tx,identity,["documentTemplates.read","documentTemplates.edit"],provider.modules)
        const company=await tx.businessCompany.findFirst({where:{tenantId:identity.tenantId,id:data.companyId,archived:false}})
        if(!company)throw new BusinessError(409,"Choose an active issuing company.")
        const before=await tx.businessDocumentTemplate.findFirst({where:{tenantId:identity.tenantId,companyId:data.companyId,providerKey:data.providerKey},orderBy:{version:"desc"}})
        if((before?.version??0)!==data.version)throw new BusinessError(409,"This template changed. Reload before publishing; your draft is retained.")
        const row=await tx.businessDocumentTemplate.create({data:{tenantId:identity.tenantId,companyId:data.companyId,providerKey:data.providerKey,version:data.version+1,content:data.content,createdBy:identity.userId}})
        await recordDomainAuditEvent(tx,{tenantId:identity.tenantId,actorUserId:identity.userId,actorRole:"ADMIN",requestId:identity.requestId,entityType:"BusinessCompany",entityId:company.id,event:"documentTemplate.published",after:{companyId:company.id,providerKey:row.providerKey,version:row.version,title:data.content.title,enabled:data.content.enabled}})
        return {version:row.version}
      })
    },
  }
}
