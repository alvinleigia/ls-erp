import { NextResponse } from "next/server"
import { withCatalogApi } from "@/application/catalog/http"
export const runtime = "nodejs"
export const GET = (request: Request) => withCatalogApi(request, async service => {
  const file = await service.downloadCatalogImportTemplate(new URL(request.url).searchParams.get("profile") || "catalog")
  return new NextResponse(Buffer.from(file.bytes), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${file.name}"` } })
})
