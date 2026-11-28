import type { Prisma } from "@prisma/client"
import { BusinessError } from "@/platform/policy"
import { resolveCompanyDocumentContent } from "@/platform/companies/document-settings"
import { documentContentSchema, type DocumentContent } from "@/platform/documents/validation"
import type { DocumentTypeInfo } from "@/platform/documents/template-service"
import { starterDocumentLayout } from "@/platform/documents/layout"
import { quotationLayoutCatalog } from "./quotation-layout-catalog"
import { quotationLayoutSample } from "./quotation-layout-sample"
import { quotationLayoutDocument } from "./quotation-layout"

export type QuotationCompanyDesign = { companyId: string; version: number; content: DocumentContent }

// The caller must first authorize the opportunity and resolve its native office.
// Template permissions govern publication; using a design grants no settings access.
export async function readQuotationCompanyDesign(tx: Prisma.TransactionClient, tenantId: string, company: { id: string; settings: unknown }) {
  const row = await tx.businessDocumentTemplate.findFirst({ where: { tenantId, companyId: company.id, providerKey: "quotation" }, orderBy: { version: "desc" } })
  if (!row) return null
  const content = documentContentSchema.parse(row.content)
  if (!content.enabled) return null
  return { companyId: company.id, version: row.version, content: resolveCompanyDocumentContent({ ...content, layout: content.layout ?? starterDocumentLayout(quotationLayoutCatalog) }, company.settings) } satisfies QuotationCompanyDesign
}

export function requireQuotationDesignVersion(design: QuotationCompanyDesign | null, version: number | undefined) {
  if (version !== undefined && design?.version !== version) throw new BusinessError(409, "The company quotation design changed or was disabled. Load the company design again before saving; your quotation is retained.")
}

export const quotationCompanyTemplate: DocumentTypeInfo = {
  key: "quotation", name: "Quotation", modules: ["salesDocuments"], templateCatalog: quotationLayoutCatalog,
  defaults: { title: "Quotation", opening: "", terms: "", address: "", contact: "", signatory: "Authorised signatory", useTenantLogo: true, useCompanyDetails: true, useCompanyFooter: true, enabled: false, layout: starterDocumentLayout(quotationLayoutCatalog) },
  sample(content, _catalog, company) {
    const snapshot = quotationLayoutSample(content.layout ?? starterDocumentLayout(quotationLayoutCatalog))
    snapshot.content.title = content.title
    snapshot.content.supplierName = company.name
    snapshot.content.appearance = content.appearance
    snapshot.companyDesign = { companyId: company.id, version: 1, content }
    const payload = quotationLayoutDocument({ id: "SAMPLE", revision: 1, revisionCreatedAt: "2026-01-01", snapshot })
    return { ...payload, company }
  },
}
