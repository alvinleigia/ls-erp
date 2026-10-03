import { businessDisplayName, escapeEmailHtml } from "@/lib/branding"

type InviteEmailArgs = {
  inviteUrl: string
  businessName?: string | null
}

export function inviteEmail({ inviteUrl, businessName }: InviteEmailArgs) {
  const name = businessDisplayName(businessName)
  return {
    subject: `You've been invited to ${name}`,
    text: `You've been invited to join ${name}. Set your password: ${inviteUrl}`,
    html: `<p>You've been invited to join ${escapeEmailHtml(name)}.</p><p><a href="${escapeEmailHtml(inviteUrl)}">Set your password</a></p>`,
  }
}
