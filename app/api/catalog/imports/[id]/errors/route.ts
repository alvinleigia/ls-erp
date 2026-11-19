import { NextResponse } from "next/server"
import { withCatalogApi } from "@/application/catalog/http"
export const GET = (request: Request, context: { params: Promise<{ id: string }> }) => withCatalogApi(request, async service => new NextResponse(await service.catalogImportCorrections((await context.params).id), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="catalog-corrections.csv"' } }))
