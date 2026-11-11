import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { applicationVerificationEvidence } from "@/application/verification/service"
export const GET = (request: Request, context: { params: Promise<{ id: string }> }) => withBusinessApi(request, async actor => {
  const response = NextResponse.redirect((await applicationVerificationEvidence(prisma, actor).download((await context.params).id)).url, 303)
  response.headers.set("Referrer-Policy", "no-referrer")
  return response
})
