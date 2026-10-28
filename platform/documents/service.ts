import { randomUUID } from "node:crypto"
import type { Prisma, PrismaClient } from "@prisma/client"
import type { BusinessActor } from "../policy"
import { BusinessError } from "../policy"
import { authorizeBusinessOperation } from "../access/operation"
import type { Permission, Requirement, Resource } from "../access/catalog"
import type { BusinessModuleKey } from "../modules"
import { lockTenantOperations } from "../transactions/tenant-lock"
import { serializationConflict } from "../database-errors"
import { documentIssueSchema, documentPrepareSchema, documentPreviewSchema } from "./validation"
import type { DocumentIdentity, DocumentPayload, DocumentProvider, DocumentStorage, PreparedDocument, StoredDocument } from "./contracts"
import type { ArchivedPdf } from "../storage/documents"
import type { renderBusinessDocument } from "./pdf"
import { documentHash } from "./hash"

type Tx = Prisma.TransactionClient
export type DocumentOwner<C> = {
  resource: Resource; requirements: Requirement; modules: readonly BusinessModuleKey[]; providers: readonly DocumentProvider<C>[]
  context: (tx: Tx, actor: BusinessActor, id: string) => Promise<C>
  lock: (tx: Tx, tenantId: string, id: string) => Promise<void>
  prepare: (tx: Tx, actor: BusinessActor, context: C, provider: DocumentProvider<C>, input: ReturnType<typeof documentPrepareSchema.parse>) => Promise<PreparedDocument>
  find: (tx: Tx, actor: BusinessActor, sourceId: string, selector: { id: string } | { requestKey: string }) => Promise<StoredDocument | null>
  save: (tx: Tx, actor: BusinessActor, sourceId: string, data: { id: string; requestKey: string; requestHash: string; prepared: PreparedDocument; archive: ArchivedPdf; reason: string }) => Promise<StoredDocument>
}
export function createDocumentService<C>(db: PrismaClient, identity: DocumentIdentity, owner: DocumentOwner<C>, storage: DocumentStorage, renderer?: typeof renderBusinessDocument) {
  const render=renderer??(async(payload:DocumentPayload,preview:boolean)=>{const pdf=await import("./pdf");return pdf.renderBusinessDocument(payload,preview)})
  const providers = new Map(owner.providers.map(provider => [provider.key, provider]))
  if(providers.size!==owner.providers.length||new Set(owner.providers.map(row=>row.code)).size!==owner.providers.length||owner.providers.some(row=>! /^[A-Z0-9]{2,8}$/.test(row.code)))throw new Error("Invalid document provider registration")
  const providerFor = (key: string) => { const provider = providers.get(key); if (!provider) throw new BusinessError(400, "Choose a registered document type."); return provider }
  async function run<T>(sourceId: string, provider: DocumentProvider<C>, action: "create" | "export", operation: (tx: Tx, actor: BusinessActor, context: C) => Promise<T>) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${identity.tenantId} FOR SHARE`
          await lockTenantOperations(tx, identity.tenantId)
          const actor = await authorizeBusinessOperation(tx, identity, [`${owner.resource}.read` as Permission, `${owner.resource}.${action}` as Permission, `${owner.resource}.export` as Permission, owner.requirements, provider.requirements], [...owner.modules, ...provider.modules])
          const context=async()=>{
            const value=await owner.context(tx,actor,sourceId)
            if(action==="create")await owner.context(tx,{...actor,operation:{resource:owner.resource,action:"export"}},sourceId)
            return value
          }
          await context()
          await owner.lock(tx, actor.tenantId, sourceId)
          return operation(tx, actor, await context())
        }, { isolationLevel: "ReadCommitted", maxWait: 20000, timeout: 20000 })
      } catch (error) { if (serializationConflict(error) && attempt < 3) continue; if ((error as {code?:string}).code==="P2002") throw new BusinessError(409,"The document chain or request changed. Reload and review before continuing."); throw error }
    }
  }
  async function prepare(sourceId: string, input: unknown) {
      const data = documentPrepareSchema.parse(input), provider = providerFor(data.providerKey)
      return run(sourceId, provider, "create", (tx, actor, context) => owner.prepare(tx, actor, context, provider, data))
  }
  return {
    prepare,
    async preview(sourceId: string, input: unknown) {
      const { previewHash, ...data } = documentPreviewSchema.parse(input)
      const prepared = await prepare(sourceId, data)
      if (prepared.fingerprint !== previewHash) throw new BusinessError(409, "The document facts changed. Prepare and review a new preview.")
      return render(prepared.payload, true)
    },
    async issue(sourceId: string, input: unknown) {
      const data = documentIssueSchema.parse(input), provider = providerFor(data.providerKey), requestHash = documentHash(data)
      const prepared = await run(sourceId, provider, "create", async (tx, actor, context) => {
        const existing = await owner.find(tx, actor, sourceId, { requestKey: data.requestKey })
        if (existing) { if (existing.requestHash !== requestHash) throw new BusinessError(409, "This request was already used for another document."); await provider.authorizeDownload(tx, actor, context, existing.snapshot); return existing }
        const current = await owner.prepare(tx, actor, context, provider, data)
        if (current.fingerprint !== data.previewHash) throw new BusinessError(409, "The document facts changed. Prepare and review a new preview.")
        return current
      })
      if ("archive" in prepared) return prepared
      const id = randomUUID(), candidate = await storage.upload(identity.tenantId, sourceId, id, await render(prepared.payload, false))
      let knownRollback = false, committed: StoredDocument
      try {
        committed = await run(sourceId, provider, "create", async (tx, actor, context) => {
          knownRollback = false
          try {
            const existing = await owner.find(tx, actor, sourceId, { requestKey: data.requestKey })
            if (existing) { if (existing.requestHash !== requestHash) throw new BusinessError(409, "This request was already used for another document."); await provider.authorizeDownload(tx, actor, context, existing.snapshot); return existing }
            const current = await owner.prepare(tx, actor, context, provider, data)
            if (current.fingerprint !== prepared.fingerprint) throw new BusinessError(409, "The document facts changed during generation. Prepare and review a new preview.")
            return await owner.save(tx, actor, sourceId, { id, requestKey: data.requestKey, requestHash, prepared, archive: { ...candidate, issuedAt: new Date().toISOString(), issuedBy: actor.userId }, reason: data.reason })
          } catch (error) { knownRollback = true; throw error }
        })
      } catch (error) {
        // A lost commit acknowledgement may have saved this exact object. Keep
        // that candidate; retries resolve the immutable request key first.
        if (knownRollback || error instanceof BusinessError) await storage.remove(candidate.path).catch(() => {})
        throw error
      }
      if (committed.archive.path !== candidate.path) await storage.remove(candidate.path).catch(() => {})
      return committed
    },
    async download(sourceId: string, id: string, providerKey: string) {
      const provider = providerFor(providerKey)
      const row = await run(sourceId, provider, "export", async (tx, actor, context) => {
        const stored = await owner.find(tx, actor, sourceId, { id })
        if (!stored || stored.providerKey !== provider.key) throw new BusinessError(404, "Issued document not found.")
        await provider.authorizeDownload(tx, actor, context, stored.snapshot)
        return stored
      })
      return storage.url(row.archive.path, `${row.reference.replace(/[^a-zA-Z0-9_-]/g, "-")}.pdf`)
    },
  }
}
export const validateDocumentSize = (payload: DocumentPayload) => { if (Buffer.byteLength(JSON.stringify(payload)) > 512 * 1024) throw new BusinessError(413, "This document contains too much text. Shorten the template or saved details.") }
