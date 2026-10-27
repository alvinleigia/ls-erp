"use client"
import * as React from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { PageHeader, Surface, pageClass } from "@/components/erp/page"
import { Pagination } from "@/components/erp/pagination"
import { DraftPanel, RecordPanel } from "@/components/erp/record-detail"
import { ConfirmAction } from "@/components/erp/confirm-action"
import { Select } from "@/components/erp/controls"
import { ProfilePicker, RecordPolicyFields } from "@/platform/access/profile-picker"
import { ProfileAssignmentEditor } from "@/platform/access/profile-assignment"
import { InitialOfficeAccess, initialOfficeReady } from "@/platform/companies/initial-office-access"
import { OfficeMembershipEditor } from "@/platform/companies/membership-editor"
import { defaultRecordRules } from "@/platform/access/rules"
import type { MembershipValidation } from "@/platform/companies/membership-choice"
import type { OfficeMembershipDraft } from "@/types/companies"
import type { UserStatus } from "@/types/users"
import type { ListResponse } from "@/types/api"
import type { Collaborator } from "./contracts"

type Login = { id: string; name: string | null; email: string; status: UserStatus; role: "STAFF"; collaboratorId: string }
type Invite = { id: string; email: string; token: string; expiresAt: string }
type Result = { inviteUrl?: string; warning?: string; emailSent?: boolean }
const initialPage = { page: 1, pageSize: 20, q: "" }
const empty = <T,>(): ListResponse<T> => ({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 })
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init }), data = await response.json()
  if (!response.ok) throw new Error(data.error || "Unable to complete the request.")
  return data
}
const encoded = (value: Record<string, string | number>) => new URLSearchParams(Object.entries(value).map(([key, value]) => [key, String(value)]))
const linkFor = (token: string) => new URL(`/auth/invite?token=${encodeURIComponent(token)}`, window.location.origin).toString()

export function CollaboratorLogins({ id }: { id: string }) {
  const [parent, setParent] = React.useState<Collaborator | null>(null)
  const [accounts, setAccounts] = React.useState(empty<Login>), [invites, setInvites] = React.useState(empty<Invite>)
  const [query, setQuery] = React.useState(initialPage), [inviteQuery, setInviteQuery] = React.useState(initialPage)
  const [revision, reload] = React.useReducer(value => value + 1, 0)
  const [loading, setLoading] = React.useState(true), [loadError, setLoadError] = React.useState("")
  const [message, setMessage] = React.useState(""), [busy, setBusy] = React.useState(false)
  const [form, setForm] = React.useState<"create" | "invite" | null>(null), [result, setResult] = React.useState<Result | null>(null)
  const [access, setAccess] = React.useState<Login | null>(null), [offices, setOffices] = React.useState<Login | null>(null)
  const [action, setAction] = React.useState<{ account: Login; status: UserStatus } | { invite: Invite } | null>(null)
  React.useEffect(() => {
    const controller = new AbortController();setLoading(true);setLoadError("")
    const timer = setTimeout(() => {
      Promise.all([
        request<Collaborator>(`/api/collaborators/${id}`, { signal: controller.signal }),
        request<ListResponse<Login>>(`/api/collaborators/${id}/logins?${encoded(query)}`, { signal: controller.signal }),
        request<ListResponse<Invite>>(`/api/invites?${encoded({ ...inviteQuery, collaboratorId: id, status: "pending" })}`, { signal: controller.signal }),
      ]).then(([parent, accounts, invites]) => { if (!controller.signal.aborted) { setParent(parent);setAccounts(accounts);setInvites(invites) } })
        .catch(error => { if (!controller.signal.aborted) { setParent(null);setAccounts(empty());setInvites(empty());setLoadError(error.message) } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 150)
    return () => { clearTimeout(timer);controller.abort() }
  }, [id, query, inviteQuery, revision])
  async function change() {
    if (!action || busy) return
    setBusy(true);setMessage("")
    try {
      if ("invite" in action) await request(`/api/invites/${action.invite.id}`, { method: "DELETE" })
      else await request(`/api/users/${action.account.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: action.status, expectedStatus: action.account.status }) })
    } catch (error) { setMessage((error as Error).message || "Unable to confirm the change. Refresh before trying again.") }
    finally { setBusy(false);setAction(null);reload() }
  }
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url);setMessage("Invitation link copied.") }
    catch { setMessage("Unable to copy the link. Open the invitation to copy it manually.") }
  }
  const unavailable = loading || !parent || busy
  return <div className={pageClass}>
    <PageHeader title="Collaborator logins" description={parent ? `Manage named accounts for ${parent.name}.` : "Manage external login accounts."} backHref={`/users/collaborators/${id}`} actions={<><Button variant="outline" disabled={unavailable || parent?.archived} onClick={() => setForm("invite")}>Invite login</Button><Button disabled={unavailable || parent?.archived} onClick={() => setForm("create")}>Create login</Button></>} />
    {parent?.archived && <p role="status" className="text-sm text-muted-foreground">This collaborator is archived. Restore the collaborator before creating, inviting or activating a login. Existing logins stay suspended until you activate them explicitly.</p>}
    <p className="text-sm text-muted-foreground">Each login needs its own profiles and office access. Supervisor responsibility grants neither. Employee workflows remain unavailable.</p>
    <Button variant="outline" disabled={loading || busy} onClick={() => { setMessage("");reload() }}>Refresh logins</Button>
    {loadError && <p role="alert" className="text-destructive">{loadError}</p>}{message && <p role="status" className="text-sm">{message}</p>}
    <Surface><h2 className="text-lg font-semibold">Login accounts</h2><Input aria-label="Search logins" placeholder="Search name or email..." value={query.q} onChange={event => setQuery({ ...query, q: event.target.value, page: 1 })} />
      {loading ? <p>Loading logins...</p> : accounts.items.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">Login</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead><tbody>{accounts.items.map(account => <tr key={account.id} className="border-b"><td className="p-3"><Link className="underline" href={`/users/${account.id}`}>{account.name || account.email}</Link><p className="break-all text-xs text-muted-foreground">{account.email}</p></td><td className="p-3">{account.status}</td><td className="p-3"><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={unavailable} onClick={() => setAccess(account)}>Access profiles</Button><Button size="sm" variant="outline" disabled={unavailable} onClick={() => setOffices(account)}>Office access</Button><Button size="sm" variant="outline" disabled={unavailable || (account.status !== "ACTIVE" && parent?.archived)} onClick={() => setAction({ account, status: account.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" })}>{account.status === "ACTIVE" ? "Suspend" : "Activate"}</Button>{account.status !== "ARCHIVED" && <Button size="sm" variant="outline" disabled={unavailable} onClick={() => setAction({ account, status: "ARCHIVED" })}>Archive login</Button>}</div></td></tr>)}</tbody></table></div> : <p>No login accounts in this selection.</p>}
      <Pagination {...query} total={accounts.total} totalPages={accounts.totalPages} loading={loading} label="Login accounts pagination" onPageChange={page => setQuery({ ...query, page })} onPageSizeChange={pageSize => setQuery({ ...query, pageSize, page: 1 })} />
    </Surface>
    <Surface><h2 className="text-lg font-semibold">Pending invitations</h2><Input aria-label="Search partner invitations" placeholder="Search invitation email..." value={inviteQuery.q} onChange={event => setInviteQuery({ ...inviteQuery, q: event.target.value, page: 1 })} />
      {loading ? <p>Loading invitations...</p> : invites.items.length ? <ul className="space-y-3">{invites.items.map(invite => <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"><span className="min-w-0 break-all text-sm">{invite.email}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={unavailable} onClick={() => setResult({ inviteUrl: linkFor(invite.token) })}>Open invite link</Button><Button size="sm" variant="outline" disabled={unavailable} onClick={() => setAction({ invite })}>Revoke invite</Button></div></li>)}</ul> : <p>No pending invitations in this selection.</p>}
      <Pagination {...inviteQuery} total={invites.total} totalPages={invites.totalPages} loading={loading} label="Partner invitations pagination" onPageChange={page => setInviteQuery({ ...inviteQuery, page })} onPageSizeChange={pageSize => setInviteQuery({ ...inviteQuery, pageSize, page: 1 })} />
    </Surface>
    {form && parent && <ExternalLoginDraft key={form} parent={parent} mode={form} onClose={() => setForm(null)} onSaved={result => { setForm(null);if (result.inviteUrl || result.warning) setResult(result);else setMessage(result.emailSent ? "Invitation sent." : "Login account created.");setQuery(initialPage);setInviteQuery(initialPage);reload() }} />}
    {access && <ProfileAssignmentEditor key={access.id} user={access} onClose={() => setAccess(null)} onSaved={() => { setAccess(null);reload() }} />}
    {offices && <OfficeMembershipEditor key={offices.id} user={offices} onClose={() => setOffices(null)} onSaved={() => { setOffices(null);reload() }} />}
    {result && <RecordPanel title="Invitation ready" description="Share this link privately with the invited person." onClose={() => setResult(null)} actions={result.inviteUrl && <Button onClick={() => void copy(result.inviteUrl!)}>Copy invite link</Button>}>
      {result.warning && <p role="alert">{result.warning}</p>}{result.inviteUrl && <FormField id="partner-invite-url" label="Invitation link"><Input id="partner-invite-url" readOnly value={result.inviteUrl} /></FormField>}
    </RecordPanel>}
    {action && <ConfirmAction title={"invite" in action ? "Revoke invitation?" : `${action.status === "ACTIVE" ? "Activate" : action.status === "ARCHIVED" ? "Archive" : "Suspend"} login?`} label={"invite" in action ? "Revoke invitation" : action.status === "ACTIVE" ? "Activate login" : action.status === "ARCHIVED" ? "Archive login" : "Suspend login"} description={"invite" in action ? `The invitation for ${action.invite.email} will stop working.` : `${action.account.email}: ${action.status === "ACTIVE" ? "Sign-in will use the saved profiles and office access. Review them before activating." : "Sign-in and current account access will stop. Assigned records and access configuration are retained."}`} busy={busy} destructive={"invite" in action || action.status !== "ACTIVE"} onCancel={() => setAction(null)} onConfirm={() => void change()} />}
  </div>
}

function ExternalLoginDraft({ parent, mode, onClose, onSaved }: { parent: Collaborator; mode: "create" | "invite"; onClose: () => void; onSaved: (result: Result) => void }) {
  const [values, setValues] = React.useState({ name: "", email: "", password: "", delivery: "LINK", roleIds: [] as string[], rules: defaultRecordRules() })
  const [officeAccess, setOfficeAccess] = React.useState<OfficeMembershipDraft>(), [validation, setValidation] = React.useState<MembershipValidation | null>(null)
  const [officeDenied, setOfficeDenied] = React.useState(false), [refresh, setRefresh] = React.useState(0)
  const [saving, setSaving] = React.useState(false), [error, setError] = React.useState("")
  const denied = React.useCallback(() => setOfficeDenied(true), [])
  const ready = !parent.archived && !officeDenied && initialOfficeReady("STAFF", "ACTIVE", officeAccess, validation)
  return <DraftPanel title={mode === "create" ? "Create external login" : "Invite external login"} description={`A separate login for ${parent.name}. The external identity stays fixed and no employee profile is created.`} fingerprint={{ values, officeAccess }} saving={saving} disabled={!ready} error={error} saveLabel={mode === "create" ? "Create login" : values.delivery === "LINK" ? "Create invite link" : "Send invitation"} onClose={onClose} onSubmit={async () => {
    if (!ready || saving) return
    setSaving(true);setError("")
    try {
      const access = { collaboratorId: parent.id, role: "STAFF", accessRoleIds: values.roleIds, recordRules: values.rules, officeAccess }
      const result = await request<Result>(mode === "create" ? "/api/users" : "/api/invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...access, email: values.email.trim(), ...(mode === "create" ? { name: values.name.trim(), password: values.password } : { delivery: values.delivery }) }) })
      onSaved(result)
    } catch (error) { setError(error instanceof TypeError ? "Unable to confirm the request. Check logins or pending invitations before trying again." : (error as Error).message);setValidation(null);setRefresh(value => value + 1) }
    finally { setSaving(false) }
  }}>
    {parent.archived && <p role="alert">This collaborator is archived. Close this draft and restore the collaborator first.</p>}
    {mode === "create" && <FormField id="partner-login-name" label="Full name"><Input id="partner-login-name" required maxLength={100} value={values.name} onChange={event => setValues({ ...values, name: event.target.value })} /></FormField>}
    <FormField id="partner-login-email" label="Login email"><Input id="partner-login-email" type="email" required maxLength={254} value={values.email} onChange={event => setValues({ ...values, email: event.target.value })} /></FormField>
    {mode === "create" ? <FormField id="partner-login-password" label="Temporary password"><Input id="partner-login-password" type="password" required minLength={6} maxLength={100} autoComplete="new-password" value={values.password} onChange={event => setValues({ ...values, password: event.target.value })} /></FormField> : <FormField id="partner-login-delivery" label="Delivery"><Select id="partner-login-delivery" value={values.delivery} onValueChange={delivery => setValues({ ...values, delivery })}><option value="LINK">Copy invitation link</option><option value="EMAIL">Send by email</option></Select></FormField>}
    <ProfilePicker id="partner-login-profiles" external value={values.roleIds} onChange={roleIds => setValues({ ...values, roleIds })} disabled={saving} />
    <p className="text-sm text-muted-foreground">Only business actions in a shared profile apply. Employee permissions and internal team management remain unavailable.</p>
    <details><summary className="cursor-pointer text-sm font-medium">Record access limits</summary><RecordPolicyFields external value={{ rules: values.rules }} onChange={patch => setValues({ ...values, rules: patch.rules ?? values.rules })} disabled={saving} /></details>
    <InitialOfficeAccess role="STAFF" status="ACTIVE" draft={officeAccess} onChange={setOfficeAccess} validation={validation} onValidation={setValidation} onDenied={denied} denied={officeDenied} saving={saving} refresh={refresh} />
  </DraftPanel>
}
