import { NextResponse } from "next/server"
import { z } from "zod"
import { withCrmApi } from "@/application/crm/http"
import { buildQuotationPdf } from "@/modules/sales-documents/quotation-pdf"
export const runtime = "nodejs"
export const GET = (request: Request, context: { params: Promise<{ id: string }> }) => withCrmApi(request, async service => {
  const raw = new URL(request.url).searchParams.get("revision")
  const row = await service.getQuotation((await context.params).id, raw ? z.coerce.number().int().positive().parse(raw) : undefined, true)
  const bytes = await buildQuotationPdf(row)
  return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="quotation-${row.id}-v${row.revision}.pdf"` } })
})
