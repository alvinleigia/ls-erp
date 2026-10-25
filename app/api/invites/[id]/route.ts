import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withCoreApi } from "@/platform/core/api"
import { createInvitationService } from "@/platform/invitations/service"

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withCoreApi(request, "invitations", "archive", async actor =>
    NextResponse.json(await createInvitationService(prisma, actor).revoke(id)), id)
}
