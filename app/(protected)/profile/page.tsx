"use client"

import * as React from "react"
import { useListRouter as useRouter } from "@/components/erp/list-navigation"
import { useSession } from "next-auth/react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useFormErrors } from "@/hooks/use-form-errors"
import type { ProfileFormValues, UserProfile } from "@/types/users"
import { ProfileFormFields } from "./profile-form-fields"
import { defaultProfileFormValues, toDateInput } from "./profile-form-model"

export default function MyProfilePage() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const userId = session?.user?.id

  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()
  const [form, setForm] = React.useState<ProfileFormValues>(defaultProfileFormValues)

  React.useEffect(() => {
    if (status === "loading") return
    if (!userId) {
      setLoading(false)
      return
    }
    const load = async () => {
      setLoading(true)
      const response = await fetch(`/api/users/${userId}`)
      if (!response.ok) {
        toast.error("Unable to load your profile.")
        setLoading(false)
        return
      }
      const data = (await response.json()) as { user: UserProfile }
      const profile = data.user
      setForm({
        name: profile.name ?? "",
        email: profile.email,
        phone: profile.phone ?? "",
        image: profile.image ?? "",
        dateOfBirth: toDateInput(profile.dateOfBirth),
        gender: profile.gender ?? "PREFER_NOT_TO_SAY",
        marketingOptIn: Boolean(profile.marketingOptIn),
        addressLine1: profile.addressLine1 ?? "",
        addressLine2: profile.addressLine2 ?? "",
        city: profile.city ?? "",
        state: profile.state ?? "",
        postalCode: profile.postalCode ?? "",
        country: profile.country ?? "",
      })
      setLoading(false)
    }
    void load()
  }, [status, userId])

  const saveProfile = async () => {
    if (!userId) return
    setSaving(true)
    clearErrors()
    const response = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })

    if (!response.ok) {
      const data = (await response.json()) as {
        error?: string
        details?: { fieldErrors?: Record<string, string[]> }
      }
      setErrorsFromResponse(data)
      toast.error(data.error ?? "Unable to update profile.")
      setSaving(false)
      return
    }

    toast.success("Profile updated.")
    setSaving(false)
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading profile...</div>
  }

  if (!userId) {
    return (
      <div className="text-sm text-muted-foreground">
        Unable to load profile.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">My profile</h1>
          <p className="text-sm text-muted-foreground">
            Update your personal information.
          </p>
        </div>
        <Button variant="outline" onClick={() => router.back()}>
          Back
        </Button>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <ProfileFormFields
          values={form}
          errors={errors}
          onChange={setForm}
        />

        <div className="mt-6 flex justify-end">
          <Button onClick={saveProfile} loading={saving} loadingText="Saving...">
            Save changes
          </Button>
        </div>
      </div>
    </div>
  )
}
