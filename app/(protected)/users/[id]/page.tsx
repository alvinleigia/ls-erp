"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { type Role } from "@/lib/permissions"
import type { UserProfile } from "@/types/users"
import { OfficeMembershipEditor } from "@/platform/companies/membership-editor"
import { UserProfileSections } from "./user-profile-sections"

export default function UserProfilePage() {
  const { formatDate } = useDateFormatter()
  const router = useRouter()
  const { data: session } = useSession()
  const currentRole = (session?.user as { role?: Role })?.role
  const canManage = currentRole === "ADMIN"
  const params = useParams<{ id: string }>()
  const [user, setUser] = React.useState<UserProfile | null>(null)
  const [officeOpen, setOfficeOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    const load = async () => {
      setLoading(true)
      const response = await fetch(`/api/users/${params.id}`)
      if (!response.ok) {
        toast.error("Unable to load user profile.")
        setLoading(false)
        return
      }
      const data = (await response.json()) as { user: UserProfile }
      setUser(data.user)
      setLoading(false)
    }
    void load()
  }, [params.id])

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading profile...</div>
  }

  if (!user) {
    return <div className="text-sm text-muted-foreground">User not found.</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{user.name ?? "User"}</h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && !user.collaboratorId && ["STAFF", "MANAGER"].includes(user.role) ? (
            <Button onClick={() => router.push(`/users/${user.id}/staff`)}>
              Staff profile
            </Button>
          ) : null}
          {canManage && ["ADMIN", "MANAGER", "STAFF"].includes(user.role) && <Button variant="outline" onClick={() => setOfficeOpen(true)}>Office access</Button>}
          <Button variant="outline" onClick={() => router.push("/users")}>
            Back to users
          </Button>
        </div>
      </div>

      {officeOpen && <OfficeMembershipEditor key={user.id} user={user} onClose={() => setOfficeOpen(false)} onSaved={() => setOfficeOpen(false)} />}
      <UserProfileSections user={user} formatDate={formatDate} />
    </div>
  )
}
