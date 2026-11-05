import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { BusinessError } from "../policy"
import type { DocumentContent } from "../documents/validation"
import { defaultDocumentAppearance } from "../documents/appearance"
import { letterheadProfileSchema } from "../documents/letterhead"

const text = (max: number) => z.string().trim().max(max).default("")
export const paymentInstructionsSchema = z.object({ accountName: text(200), accountNumber: text(100), accountType: text(100), bankName: text(200), branch: text(200), routingCode: text(100) }).strict()
export const companyDocumentSettingsSchema = z.object({
  address: text(1500), contact: text(800), website: z.union([z.literal(""), z.url().max(1000).refine(value => /^https?:\/\//.test(value))]).default(""),
  signatory: z.string().trim().min(1).max(200).default("Authorised signatory"),
  footer: text(300).refine(value => value.split("\n").length <= 3, "Keep the footer to three lines."),
  bank: paymentInstructionsSchema.default(() => paymentInstructionsSchema.parse({})),
  letterhead: letterheadProfileSchema.extend({ enabled: z.boolean() }).default({ enabled: false, topMm: 65, bottomMm: 25 }),
}).strict()
export type CompanyDocumentSettings = z.infer<typeof companyDocumentSettingsSchema>
export const emptyCompanyDocumentSettings = companyDocumentSettingsSchema.parse({})

// Resolved only while preparing a new document. Issued files never read live settings.
export function resolveCompanyDocumentContent(content: DocumentContent, settings: unknown): DocumentContent {
  const company = companyDocumentSettingsSchema.parse(settings)
  const { letterhead: _ignored, ...appearance } = content.appearance ?? {}
  const letterhead = company.letterhead.enabled ? { topMm: company.letterhead.topMm, bottomMm: company.letterhead.bottomMm } : undefined
  if (!content.useCompanyDetails && !letterhead && !_ignored) return content
  return { ...content, ...(content.useCompanyDetails ? { address: company.address, contact: company.contact, signatory: company.signatory } : {}),
    appearance: { ...defaultDocumentAppearance, ...appearance, ...(content.useCompanyDetails ? { footer: company.footer } : {}), ...(letterhead ? { letterhead } : {}) } }
}

// The application has already authorized the opportunity; the native reader also
// checks tenant, active identity and access to its saved issuing office.
export async function officeDocumentDefaults(tx: Prisma.TransactionClient, tenantId: string, officeId: string) {
  const [company] = await tx.$queryRaw<{ id: string; name: string; settings: unknown }[]>`SELECT * FROM app.office_document_defaults(${tenantId},${officeId})`
  if (!company) throw new BusinessError(404, "The issuing company's document settings are unavailable.")
  return { ...company, settings: companyDocumentSettingsSchema.parse(company.settings) }
}
