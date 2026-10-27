"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { UserProfile } from "@/types/users"

type UserProfileSectionsProps = {
  user: UserProfile
  formatDate: (value?: string | Date | null) => string
}

export function UserProfileSections({ user, formatDate }: UserProfileSectionsProps) {
  const hasAddress = Boolean(user.addressLine1 || user.addressLine2 || user.city)
  const cityLine = [user.city, user.state, user.postalCode].filter(Boolean).join(", ") || "-"

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-xs text-muted-foreground">Role</div>
              <div className="font-medium">{user.collaboratorId ? "External collaborator" : user.role}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Status</div>
              <div className="font-medium">{user.status}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Phone</div>
              <div className="font-medium">{user.phone ?? "-"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Date of birth</div>
              <div className="font-medium">{formatDate(user.dateOfBirth)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Gender</div>
              <div className="font-medium">
                {user.gender ? user.gender.replaceAll("_", " ") : "-"}
              </div>
            </div>
            {!user.collaboratorId && user.role === "STAFF" ? (
              <div>
                <div className="text-xs text-muted-foreground">Reporting manager</div>
                <div className="font-medium">
                  {user.staffProfile?.manager?.name || user.staffProfile?.manager?.email || "-"}
                </div>
              </div>
            ) : null}
            {user.role !== "STAFF" ? (
              <div>
                <div className="text-xs text-muted-foreground">Marketing opt-in</div>
                <div className="font-medium">{user.marketingOptIn ? "Yes" : "No"}</div>
              </div>
            ) : null}
            <div>
              <div className="text-xs text-muted-foreground">Created</div>
              <div className="font-medium">{formatDate(user.createdAt)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Updated</div>
              <div className="font-medium">{formatDate(user.updatedAt)}</div>
            </div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground">Address</div>
            <div className="font-medium">
              {hasAddress ? (
                <div className="space-y-1">
                  <div>{user.addressLine1 ?? "-"}</div>
                  {user.addressLine2 ? <div>{user.addressLine2}</div> : null}
                  <div>{cityLine}</div>
                  <div>{user.country ?? "-"}</div>
                </div>
              ) : (
                "-"
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Avatar</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 overflow-hidden rounded-full border bg-muted">
              {user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.image}
                  alt={user.name ?? "User"}
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>
            <div className="text-sm text-muted-foreground">
              {user.image ? "Profile image set" : "No image uploaded"}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
