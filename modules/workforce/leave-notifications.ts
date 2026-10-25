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
  leaveRequestId: string
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

async function mayNotify(tx: DbClient, tenantId: string, leaveRequestId: string, target: string, action: "read" | "approve") {
  if (!leaveRequestId) throw new BusinessError(403, "Leave request context is required.")
  const [row] = await tx.$queryRaw<{ allowed: boolean }[]>`SELECT app.leave_notice_recipient(${tenantId},${leaveRequestId},${target},${action}) AS allowed`
  return row?.allowed === true
}
async function reviewerEmails(tx: DbClient, tenantId: string, leaveRequestId: string, staffUserId: string, action: "read" | "approve") {
  const candidates = await tx.user.findMany({ where: { tenantId, role: Role.ADMIN, status: "ACTIVE" }, select: { id: true, email: true } })
  const employee = await tx.staffProfile.findFirst({ where: { userId: staffUserId, user: { tenantId } }, select: { managerUserId: true, leaveApprovalMode: true } })
  if (employee?.leaveApprovalMode === "REPORTING_MANAGER" && employee.managerUserId && employee.managerUserId !== staffUserId) {
    const manager = await tx.user.findFirst({ where: { tenantId, id: employee.managerUserId, status: "ACTIVE" }, select: { id: true, email: true } })
    if (manager) candidates.push(manager)
  }
  const permitted = await Promise.all(candidates.map(async user => await mayNotify(tx, tenantId, leaveRequestId, user.id, action) ? user.email : null))
  return [...new Set(permitted.filter((email): email is string => email !== null))]
}

export const notifyLeaveSubmitted = async (
  tx: DbClient,
  payload: LeaveRequestNotificationPayload & { staffUserId: string }
) => {
  if (!payload.tenantId) throw new BusinessError(403, "Tenant context is required.")
  if (!(await canSendConfiguredEmail(tx, payload.tenantId))) return
  const recipients = await reviewerEmails(tx, payload.tenantId, payload.leaveRequestId, payload.staffUserId, "approve")

  const template = leaveRequestSubmittedEmail({
    leaveCode: payload.leaveCode,
    leaveName: payload.leaveName,
    startDate: payload.startDateIso,
    endDate: payload.endDateIso,
    daysCount: payload.daysCount,
  })
  await Promise.allSettled(recipients.map((email) => sendEmail(email, template)))
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
  if (!await mayNotify(tx, params.tenantId, params.leaveRequestId, params.staffUserId, "read")) return
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
    const reviewers = await reviewerEmails(tx, params.tenantId, params.leaveRequestId, params.staffUserId, "read")
    const template = leaveRequestCanceledEmail({
      leaveCode: params.leaveCode,
      leaveName: params.leaveName,
      startDate: params.startDateIso,
      endDate: params.endDateIso,
      daysCount: params.daysCount,
      actorName: params.canceledByName,
      comment: params.cancelReason,
    })
    await Promise.allSettled(reviewers.map(email => sendEmail(email, template)))
    return
  }

  if (!await mayNotify(tx, params.tenantId, params.leaveRequestId, params.staffUserId, "read")) return
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
  if (!await mayNotify(tx, params.tenantId, params.leaveRequestId, params.staffUserId, "read")) return
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
