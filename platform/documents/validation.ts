import { z } from "zod"
import { documentLayoutSchema } from "./layout"
const text = (max: number) => z.string().trim().max(max)
export const documentKey = z.string().regex(/^[a-z][a-z0-9.-]{1,70}$/)
export const documentContentSchema = z.object({ title: text(160).min(1), opening: text(6000), terms: text(24000), address: text(1500), contact: text(800), signatory: text(200).min(1), useTenantLogo: z.boolean(), enabled: z.boolean(), layout: documentLayoutSchema.optional() }).strict()
export type DocumentContent = z.infer<typeof documentContentSchema>
export const documentCatalogSchema=z.object({q:text(120).default(""),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(20).default(20)}).strict()
export const documentPageSchema=z.object({page:z.coerce.number().int().min(1).max(1000000).default(1)}).strict()
export const documentTemplateSchema = z.object({ companyId: text(100).min(1), providerKey: documentKey, version: z.number().int().min(0), content: documentContentSchema, reviewed: z.literal(true) }).strict()
export const documentPrepareSchema = z.object({ providerKey: documentKey, supersedesId: text(100).min(1).nullable().default(null), reason: text(2000).default("") }).strict().superRefine((value, ctx) => { if (value.supersedesId && !value.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "Explain why the issued document needs replacement." }) })
export const documentPreviewSchema = documentPrepareSchema.safeExtend({ previewHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
export const documentIssueSchema = documentPreviewSchema.safeExtend({ requestKey: z.uuid() }).strict()
