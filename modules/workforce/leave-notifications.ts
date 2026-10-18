import { BusinessError } from "@/platform/policy"
import { Prisma, Role, type PrismaClient } from "@prisma/client"

import {
  leaveRequestApprovedEmail,
  leaveRequestCanceledEmail,
  leaveRequestRevokedEmail,
  leaveRequestRejectedEmail,
  leaveRequestSubmittedEmail,
} from "@/lib/emails/leave-events"
import { canSendConfiguredEmail, mailFrom, mailer } from "@/lib/mailer"

type DbClient = PrismaClient | Prisma.TransactionClient

type LeaveRequestNotificationPayload = {
  tenantId: string
  leaveCode: string
  leaveName: string
  startDateIso: string
  endDateIso: string
  daysCount: number
}

const sendEmail = async (to: string, template: { subject: string; text: string; html: string }) => {
  await mailer.sendMail({
    from: mailFrom as string,
    to,
    subject: template.subject,
    text: template.text,
    html: template.html,
  })
}

export const notifyLeaveSubmitted = async (
  tx: DbClient,
  payload: LeaveRequestNotificationPayload & { staffUserId: string }
) => {
  if (!payload.tenantId) throw new BusinessError(403, "Tenant context is required.")
  if (!(await canSendConfiguredEmail(tx, payload.tenantId))) return
  const staffUser = await tx.user.findUnique({
    where: { id: payload.staffUserId, tenantId: payload.tenantId },
    select: {
      role: true,
      staffProfile: { select: { managerUserId: true } },
    },
  })
  if (!staffUser) return

  const recipients = new Set<string>()
  const admins = await tx.user.findMany({
    where: { tenantId: payload.tenantId, status: "ACTIVE", role: Role.ADMIN },
    select: { email: true },
  })
  admins.forEach((admin) => recipients.add(admin.email))

  if (staffUser.role === Role.STAFF && staffUser.staffProfile?.managerUserId) {
    const manager = await tx.user.findUnique({
      where: { id: staffUser.staffProfile.managerUserId, tenantId: payload.tenantId },
      select: { email: true, status: true, role: true },
    })
    if (manager && manager.status === "ACTIVE" && manager.role === Role.MANAGER) {
      recipients.add(manager.email)
    }
  }

  const template = leaveRequestSubmittedEmail({
    leaveCode: payload.leaveCode,
    leaveName: payload.leaveName,
    startDate: payload.startDateIso,
    endDate: payload.endDateIso,
    daysCount: payload.daysCount,
  })
  await Promise.allSettled(Array.from(recipients).map((email) => sendEmail(email, template)))
}

export const notifyLeaveReviewed = async (
  tx: DbClient,
  params: LeaveRequestNotificationPayload & {
    staffUserId: string
    status: "APPROVED" | "REJECTED"
    reviewerName: string | null
    reviewerComment: string | null
  }
) => {
  if (!params.tenantId) throw new BusinessError(403, "Tenant context is required.")
  if (!(await canSendConfiguredEmail(tx, params.tenantId))) return
  const staffUser = await tx.user.findUnique({
    where: { id: params.staffUserId, tenantId: params.tenantId },
    select: { email: true, name: true },
  })
  if (!staffUser) return

  const template =
    params.status === "APPROVED"
      ? leaveRequestApprovedEmail({
          recipientName: staffUser.name,
          leaveCode: params.leaveCode,
          leaveName: params.leaveName,
          startDate: params.startDateIso,
          endDate: params.endDateIso,
          daysCount: params.daysCount,
          actorName: params.reviewerName,
          comment: params.reviewerComment,
        })
      : leaveRequestRejectedEmail({
          recipientName: staffUser.name,
          leaveCode: params.leaveCode,
          leaveName: params.leaveName,
          startDate: params.startDateIso,
          endDate: params.endDateIso,
          daysCount: params.daysCount,
          actorName: params.reviewerName,
          comment: params.reviewerComment,
        })

  await sendEmail(staffUser.email, template)
}

export const notifyLeaveCanceled = async (
  tx: DbClient,
  params: LeaveRequestNotificationPayload & {
    staffUserId: string
    canceledByUserId: string
    cancelReason: string | null
    canceledByName: string | null
  }
) => {
  if (!params.tenantId) throw new BusinessError(403, "Tenant context is required.")
  if (!(await canSendConfiguredEmail(tx, params.tenantId))) return

  const isSelfCancel = params.staffUserId === params.canceledByUserId
  if (isSelfCancel) {
    const reviewers = await tx.user.findMany({
      where: {
        tenantId: params.tenantId,
        status: "ACTIVE",
        role: { in: [Role.ADMIN, Role.MANAGER] },
      },
      select: { email: true },
    })
    const template = leaveRequestCanceledEmail({
      leaveCode: params.leaveCode,
      leaveName: params.leaveName,
      startDate: params.startDateIso,
      endDate: params.endDateIso,
      daysCount: params.daysCount,
      actorName: params.canceledByName,
      comment: params.cancelReason,
    })
    await Promise.allSettled(reviewers.map((reviewer) => sendEmail(reviewer.email, template)))
    return
  }

  const staffUser = await tx.user.findUnique({
    where: { id: params.staffUserId, tenantId: params.tenantId },
    select: { email: true },
  })
  if (!staffUser) return
  const template = leaveRequestCanceledEmail({
    leaveCode: params.leaveCode,
    leaveName: params.leaveName,
    startDate: params.startDateIso,
    endDate: params.endDateIso,
    daysCount: params.daysCount,
    actorName: params.canceledByName,
    comment: params.cancelReason,
  })
  await sendEmail(staffUser.email, template)
}

export const notifyLeaveRevoked = async (
  tx: DbClient,
  params: LeaveRequestNotificationPayload & {
    staffUserId: string
    revokedByName: string | null
    revokeReason: string | null
  }
) => {
  if (!params.tenantId) throw new BusinessError(403, "Tenant context is required.")
  if (!(await canSendConfiguredEmail(tx, params.tenantId))) return
  const staffUser = await tx.user.findUnique({
    where: { id: params.staffUserId, tenantId: params.tenantId },
    select: { email: true, name: true },
  })
  if (!staffUser) return

  const template = leaveRequestRevokedEmail({
    recipientName: staffUser.name,
    leaveCode: params.leaveCode,
    leaveName: params.leaveName,
    startDate: params.startDateIso,
    endDate: params.endDateIso,
    daysCount: params.daysCount,
    actorName: params.revokedByName,
    comment: params.revokeReason,
  })
  await sendEmail(staffUser.email, template)
}
