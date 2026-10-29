import type { Prisma } from "@prisma/client"
import type { Requirement } from "../access/catalog"
import type { BusinessModuleKey } from "../modules"
import type { BusinessActor } from "../policy"
import type { ArchivedPdf } from "../storage/documents"
import type { DocumentBranding } from "../branding/types"
import type { DocumentContent } from "./validation"
import type { DocumentFlow, TemplateCatalog } from "./layout"

export type DocumentBlock = { key?: string; title: string; paragraphs?: string[]; table?: { headings: string[]; rows: string[][]; widths: number[] } }
export type DocumentPayload = { format: 1; title: string; reference: string; date: string; sourceReference: string; company: { id: string; name: string }; issuer: { address: string; contact: string; signatory: string }; opening: string; terms: string; branding: DocumentBranding | null; blocks: DocumentBlock[]; body?: DocumentFlow }
export type DocumentProvider<C> = { key: string; name: string; code: string; modules: readonly BusinessModuleKey[]; requirements: Requirement; defaults: DocumentContent; templateCatalog: TemplateCatalog; sample: (content: DocumentContent, catalog: TemplateCatalog, company: { id: string; name: string }) => DocumentPayload; blocks: (tx: Prisma.TransactionClient, actor: BusinessActor, context: C) => Promise<{ blocks: DocumentBlock[]; evidence: Prisma.InputJsonValue }>; authorizeDownload: (tx: Prisma.TransactionClient, actor: BusinessActor, context: C, snapshot: unknown) => Promise<void> }
export type DocumentIdentity = Pick<BusinessActor, "tenantId" | "userId" | "requestId">
export type StoredDocument = { id: string; sourceId: string; providerKey: string; version: number; reference: string; requestKey: string; requestHash: string; snapshot: unknown; archive: ArchivedPdf; supersedesId: string | null; reason: string; createdAt: Date }
export type PreparedDocument = { providerKey: string; templateVersion: number; version: number; supersedesId: string | null; payload: DocumentPayload; evidence: Prisma.InputJsonValue; fingerprint: string }
export type DocumentStorage = { upload: (tenantId: string, sourceId: string, id: string, bytes: Uint8Array) => Promise<Pick<ArchivedPdf, "path" | "bytes" | "sha256">>; remove: (path: string) => Promise<void>; url: (path: string, filename: string) => Promise<string> }
