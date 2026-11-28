import { NextResponse } from "next/server"
import { z } from "zod"
import { withCrmApi } from "@/application/crm/http"
import { buildQuotationPdf } from "@/modules/sales-documents/quotation-pdf"
import { documentVariantSchema } from "@/platform/documents/letterhead"
import { letterheadPdf } from "@/platform/documents/letterhead-pdf"
import { BusinessError } from "@/platform/policy"
import { readArchivedDocumentPdf, archivedPdfUrl } from "@/platform/storage/documents"
export const runtime = "nodejs"
export const GET = (request: Request, context: { params: Promise<{ id: string }> }) => withCrmApi(request, async service => {
  const query = new URL(request.url).searchParams, raw = query.get("revision"), variant = documentVariantSchema.parse(query.get("variant")??"digital")
  const row = await service.getQuotation((await context.params).id, raw ? z.coerce.number().int().positive().parse(raw) : undefined, true)
  const filename = `quotation-${row.id}-v${row.revision}.pdf`
  if (row.archivedPdf && variant === "digital") return NextResponse.redirect(await archivedPdfUrl(row.archivedPdf.path, filename), 303)
  if(row.archivedPdf && !row.archivedPdf.letterhead)throw new BusinessError(409,"Letterhead printing is unavailable for this issued version. Use its original PDF.")
  const bytes = row.archivedPdf ? await letterheadPdf(await readArchivedDocumentPdf(row.archivedPdf)) : await buildQuotationPdf(row, true, variant)
  return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${row.archivedPdf?"":"preview-"}${variant==="letterhead"?"letterhead-":""}${filename}"` } })
})
