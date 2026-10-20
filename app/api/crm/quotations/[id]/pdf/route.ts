import { NextResponse } from "next/server"
import { z } from "zod"
import { withCrmApi } from "@/application/crm/http"
import { buildQuotationPdf } from "@/modules/sales-documents/quotation-pdf"
import { archivedPdfUrl } from "@/platform/storage/documents"
export const runtime = "nodejs"
export const GET = (request: Request, context: { params: Promise<{ id: string }> }) => withCrmApi(request, async service => {
  const raw = new URL(request.url).searchParams.get("revision")
  const row = await service.getQuotation((await context.params).id, raw ? z.coerce.number().int().positive().parse(raw) : undefined, true)
  const filename = `quotation-${row.id}-v${row.revision}.pdf`
  if (row.archivedPdf) return NextResponse.redirect(await archivedPdfUrl(row.archivedPdf.path, filename), 303)
  const bytes = await buildQuotationPdf(row, true)
  return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="preview-${filename}"` } })
})
