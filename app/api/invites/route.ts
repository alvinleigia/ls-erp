import { NextResponse } from "next/server"
import { createInvitationService } from "@/platform/invitations/service"
import { z } from "zod"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { Prisma } from "@prisma/client"
import { BusinessError } from "@/platform/policy"
import { prisma } from "@/lib/prisma"
import { inviteUserSchema } from "@/lib/validation"
import { canSendConfiguredEmail, mailer, mailFrom } from "@/lib/mailer"
import { inviteEmail } from "@/lib/emails/invite"
import { canInvite, type Role } from "@/lib/permissions"
import { withCoreApi, actorSession } from "@/platform/core/api"
import type { BusinessActor } from "@/platform/policy"

const paginationSchema = z.object({
  collaboratorId: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["createdAt", "email", "role", "expiresAt"]).optional(),
  sort: z.enum(["createdAt", "email", "role", "expiresAt"]).optional(),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  order: z.enum(["asc", "desc"]).optional(),
  q: z.string().trim().optional(),
  status: z.enum(["pending", "accepted", "expired"]).optional(),
})

async function handlePOST(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const tenantSession = actorSession(actor)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed" })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role } = tenantSession.context

  if (!canInvite(role as Role)) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized" })
    return withRequestId(response, logContext.requestId)
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    const response = NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "invalid_json" })
    return withRequestId(response, logContext.requestId)
  }
  const parsed = inviteUserSchema.safeParse(body)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const { email, delivery } = parsed.data
    if (delivery === "EMAIL" && (!mailFrom || !await canSendConfiguredEmail(prisma, tenantId))) throw new BusinessError(400, "Email delivery is not configured or enabled. Choose Create link instead.")
    // Match authentication's tenant host. Next's internal request URL can use
    // the listening host instead, especially behind a proxy or in local tests.
    const internalUrl = new URL(request.url)
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || internalUrl.host
    const protocol = request.headers.get("x-forwarded-proto") || internalUrl.protocol.replace(":", "")
    if (!["http", "https"].includes(protocol)) throw new BusinessError(400, "Invalid invitation origin.")
    const inviteUrl = new URL("/auth/invite", `${protocol}://${host}`)
    const invitation = await createInvitationService(prisma, actor).create(parsed.data)
    inviteUrl.searchParams.set('token', invitation.token)
    if (delivery === "LINK") return withRequestId(NextResponse.json({ ok: true, emailSent: false, inviteUrl: inviteUrl.toString() }, { status: 201, headers: { "Cache-Control": "no-store" } }), logContext.requestId)

    const emailTemplate = inviteEmail({ inviteUrl: inviteUrl.toString(), businessName: (await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }))?.name })

    try { await mailer.sendMail({
      from: mailFrom,
      to: email,
      subject: emailTemplate.subject,
      text: emailTemplate.text,
      html: emailTemplate.html,
    }) } catch {
      return withRequestId(NextResponse.json({ ok: true, emailSent: false, warning: "Invitation saved, but email delivery failed. Use Copy invite link from the invitation list." }, { status: 201, headers: { "Cache-Control": "no-store" } }), logContext.requestId)
    }

    const response = NextResponse.json({ ok: true, emailSent: true }, { headers: { "Cache-Control": "no-store" } })
    logApiRequestSuccess(logContext, 200, { result: "invite_sent" })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) return withRequestId(NextResponse.json({ error: error.message }, { status: error.status }), logContext.requestId)
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to send invite." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handleGET(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const tenantSession = actorSession(actor)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed" })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role } = tenantSession.context

  if (!canInvite(role as Role)) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized" })
    return withRequestId(response, logContext.requestId)
  }

  const url = new URL(request.url)
  const parsed = paginationSchema.safeParse(
    Object.fromEntries(url.searchParams.entries())
  )
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid pagination parameters." },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const { page, pageSize, sortBy, sort, sortDir, order, q, status, collaboratorId } = parsed.data
    const skip = (page - 1) * pageSize
    const resolvedSortBy = sort ?? sortBy
    const resolvedSortDir = order ?? sortDir
    const orderBy = resolvedSortBy
      ? { [resolvedSortBy]: resolvedSortDir }
      : { createdAt: "desc" as const }
    const trimmedSearch = q?.trim()
    const where = {
      tenantId,
      ...(collaboratorId ? { accessConfiguration: { path: ["collaboratorId"], equals: collaboratorId } } : {}),
      ...(trimmedSearch
        ? { email: { contains: trimmedSearch, mode: Prisma.QueryMode.insensitive } }
        : {}),
      ...(status === "accepted" ? { acceptedAt: { not: null } } : {}),
      ...(status === "pending" ? { acceptedAt: null, expiresAt: { gt: new Date() } } : {}),
      ...(status === "expired" ? { acceptedAt: null, expiresAt: { lt: new Date() } } : {}),
    }

    const [total, invites] = await prisma.$transaction([
      prisma.invitation.count({ where }),
      prisma.invitation.findMany({
        orderBy,
        where,
        skip,
        take: pageSize,
        select: {
          accessConfiguration: true,
          id: true,
          email: true,
          role: true,
          token: true,
          expiresAt: true,
          acceptedAt: true,
          createdAt: true,
        },
      }),
    ])

    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    const response = NextResponse.json({ items: invites.map(({ accessConfiguration, ...row }) => ({ ...row, collaboratorId: accessConfiguration && typeof accessConfiguration === "object" && !Array.isArray(accessConfiguration) && typeof accessConfiguration.collaboratorId === "string" ? accessConfiguration.collaboratorId : null })), page, pageSize, total, totalPages }, { headers: { "Cache-Control": "no-store" } })
    logApiRequestSuccess(logContext, 200, { page, pageSize, total })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load invites." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function POST(request: Request) {
  return withCoreApi(request, "invitations", "create", actor => handlePOST(request, actor))
}

export async function GET(request: Request) {
  return withCoreApi(request, "invitations", "read", actor => handleGET(request, actor))
}
