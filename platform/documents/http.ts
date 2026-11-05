import { NextResponse } from "next/server"

export function documentPdfResponse(result: string | Uint8Array) {
  if (typeof result === "string") return NextResponse.redirect(result, 303)
  return new NextResponse(Buffer.from(result), { headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=document-letterhead.pdf", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } })
}
