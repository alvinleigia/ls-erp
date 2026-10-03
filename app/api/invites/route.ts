import { NextResponse } from "next/server"
import crypto from "crypto"
import { z } from "zod"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { inviteUserSchema } from "@/lib/validation"
import { canSendConfiguredEmail, mailer, mailFrom } from "@/lib/mailer"
import { inviteEmail } from "@/lib/emails/invite"
import { canInvite, type Role } from "@/lib/permissions"
import { requireTenantSession } from "@/lib/tenant-auth"

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["createdAt", "email", "role", "expiresAt"]).optional(),
  sort: z.enum(["createdAt", "email", "role", "expiresAt"]).optional(),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  order: z.enum(["asc", "desc"]).optional(),
  q: z.string().trim().optional(),
  status: z.enum(["pending", "accepted", "expired"]).optional(),
})

export async function POST(request: Request) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const tenantSession = await requireTenantSession(request)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed" })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role, sessionUserId } = tenantSession.context

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
    const { email, role: inviteRole } = parsed.data
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7)

    await prisma.invitation.create({
      data: {
        email,
        tenantId,
        token,
        role: inviteRole ?? "CUSTOMER",
        expiresAt,
        invitedById: sessionUserId,
      },
    })

    const inviteUrl = new URL(`/auth/invite?token=${token}`, request.url).toString()

    if (!mailer || !mailFrom) {
      const response = NextResponse.json(
        { error: "Email is not configured." },
        { status: 500 }
      )
      logApiRequestSuccess(logContext, 500, { reason: "mailer_not_configured" })
      return withRequestId(response, logContext.requestId)
    }
    if (!(await canSendConfiguredEmail(prisma, tenantId))) {
      const response = NextResponse.json(
        { error: "Email notifications are disabled in settings." },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "email_notifications_disabled" })
      return withRequestId(response, logContext.requestId)
    }

    const emailTemplate = inviteEmail({ inviteUrl, businessName: tenantSession.context.tenantName })

    await mailer.sendMail({
      from: mailFrom,
      to: email,
      subject: emailTemplate.subject,
      text: emailTemplate.text,
      html: emailTemplate.html,
    })

    const response = NextResponse.json({ ok: true })
    logApiRequestSuccess(logContext, 200, { result: "invite_sent" })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to send invite." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function GET(request: Request) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const tenantSession = await requireTenantSession(request)
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
    const { page, pageSize, sortBy, sort, sortDir, order, q, status } = parsed.data
    const skip = (page - 1) * pageSize
    const resolvedSortBy = sort ?? sortBy
    const resolvedSortDir = order ?? sortDir
    const orderBy = resolvedSortBy
      ? { [resolvedSortBy]: resolvedSortDir }
      : { createdAt: "desc" as const }
    const trimmedSearch = q?.trim()
    const where = {
      tenantId,
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

    const response = NextResponse.json({ items: invites, page, pageSize, total, totalPages })
    logApiRequestSuccess(logContext, 200, { page, pageSize, total })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load invites." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}
