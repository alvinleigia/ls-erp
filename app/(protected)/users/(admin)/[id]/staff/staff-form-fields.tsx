"use client"

import * as React from "react"
import { Trash2Icon } from "lucide-react"

import { FormField } from "@/components/form-field"
import { SearchableSelect } from "@/components/searchable-select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ServiceOption } from "@/types/services"
import type { StaffProfileForm, StaffDocumentType } from "@/types/users"
import {
  createEmptyStaffCertification,
  createEmptyStaffDocument,
} from "./staff-form-model"

type StaffFormFieldsProps = {
  editScheduling?: boolean
  showEligibility?: boolean
  editEligibility?: boolean
  profile: StaffProfileForm
  setProfile: React.Dispatch<React.SetStateAction<StaffProfileForm>>
  serviceOptions: ServiceOption[]
  selectedIds: string[]
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>
  managerOptions: Array<{ value: string; label: string }>
  query: string
  setQuery: React.Dispatch<React.SetStateAction<string>>
}

export function StaffFormFields({
  editScheduling = false,
  showEligibility = true,
  editEligibility = true,
  profile,
  setProfile,
  serviceOptions,
  selectedIds,
  setSelectedIds,
  managerOptions,
  query,
  setQuery,
}: StaffFormFieldsProps) {
  const toggleService = (serviceId: string, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? [...prev, serviceId] : prev.filter((id) => id !== serviceId)
    )
  }

  const filteredServices = query.trim()
    ? serviceOptions.filter((option) =>
        option.name.toLowerCase().includes(query.trim().toLowerCase())
      )
    : serviceOptions

  const updateDocument = (
    index: number,
    patch: Partial<StaffProfileForm["documents"][number]>
  ) => {
    setProfile((prev) => ({
      ...prev,
      documents: prev.documents.map((item, idx) =>
        idx === index ? { ...item, ...patch } : item
      ),
    }))
  }

  const updateCertification = (
    index: number,
    patch: Partial<StaffProfileForm["certifications"][number]>
  ) => {
    setProfile((prev) => ({
      ...prev,
      certifications: prev.certifications.map((item, idx) =>
        idx === index ? { ...item, ...patch } : item
      ),
    }))
  }

  return (
    <>
      <div className="rounded-xl border bg-card p-6">
        <div className="space-y-2">
          <div className="text-sm font-medium">Reporting manager</div>
          <p className="text-xs text-muted-foreground">
            Manager used for leave approvals and reporting hierarchy.
          </p>
        </div>
      <div className="mt-4">
        <FormField id="manager-user-id" label="Manager">
          <SearchableSelect
            id="manager-user-id"
            value={profile.managerUserId}
              onChange={(value) =>
                setProfile((prev) => ({ ...prev, managerUserId: value }))
              }
              options={managerOptions}
              placeholder="Select manager"
              searchPlaceholder="Search manager..."
          />
        </FormField>
        <FormField id="scheduling-mode" label="Scheduling mode" className="mt-3">
          <select
            id="scheduling-mode" disabled={!editScheduling}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={profile.schedulingMode}
            onChange={(event) =>
              setProfile((prev) => ({
                ...prev,
                schedulingMode: event.target.value as "STANDARD" | "FLEXIBLE",
              }))
            }
          >
            <option value="STANDARD">Standard (schedule based)</option>
            <option value="FLEXIBLE">Flexible (date-wise slots)</option>
          </select>
        </FormField>
      </div>
    </div>

      {showEligibility && <div className="rounded-xl border bg-card p-6">
        <div className="space-y-2">
          <div className="text-sm font-medium">Eligible services</div>
          <p className="text-xs text-muted-foreground">
            Leave empty to allow all services for this staff member.
          </p>
        </div>
        <div className="mt-4 space-y-3">
          <Input
            placeholder="Search services..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="max-h-80 space-y-2 overflow-y-auto rounded-md border border-input bg-background p-3 text-sm">
            {filteredServices.length ? (
              filteredServices.map((option) => (
                <label key={option.id} className="flex items-center gap-2 text-sm">
                  <input
                    disabled={!editEligibility}
                    type="checkbox"
                    checked={selectedIds.includes(option.id)}
                    onChange={(event) => toggleService(option.id, event.target.checked)}
                  />
                  <span>{option.name}</span>
                </label>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">No services found.</p>
            )}
          </div>
        </div>
      </div>}

      <div className="rounded-xl border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Documents</h2>
            <p className="text-sm text-muted-foreground">
              Add document links with type, number, and validity dates.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() =>
              setProfile((prev) => ({
                ...prev,
                documents: [...prev.documents, createEmptyStaffDocument()],
              }))
            }
          >
            Add document
          </Button>
        </div>

        {profile.documents.length ? (
          <div className="mt-4 space-y-3">
            {profile.documents.map((doc, index) => (
              <div
                key={`${doc.id ?? "new"}-${index}`}
                className="grid gap-3 sm:grid-cols-[140px_1fr_1fr_1fr_1fr_auto] sm:items-end"
              >
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Type</Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={doc.type}
                    onChange={(event) =>
                      updateDocument(index, {
                        type: event.target.value as StaffDocumentType,
                      })
                    }
                  >
                    <option value="ID">ID</option>
                    <option value="ADDRESS">Address</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Number</Label>
                  <Input
                    placeholder="Document number"
                    value={doc.number}
                    onChange={(event) => updateDocument(index, { number: event.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Link</Label>
                  <Input
                    placeholder="Image URL"
                    value={doc.imageUrl}
                    onChange={(event) =>
                      updateDocument(index, { imageUrl: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Valid from</Label>
                  <Input
                    type="date"
                    value={doc.validFrom}
                    onChange={(event) =>
                      updateDocument(index, { validFrom: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Valid to</Label>
                  <Input
                    type="date"
                    value={doc.validTo}
                    onChange={(event) => updateDocument(index, { validTo: event.target.value })}
                  />
                </div>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Remove document"
                  onClick={() =>
                    setProfile((prev) => ({
                      ...prev,
                      documents: prev.documents.filter((_, idx) => idx !== index),
                    }))
                  }
                >
                  <Trash2Icon className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No documents added yet.</p>
        )}
      </div>

      <div className="rounded-xl border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Certifications</h2>
            <p className="text-sm text-muted-foreground">
              Track staff certifications with issue and expiry dates.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() =>
              setProfile((prev) => ({
                ...prev,
                certifications: [...prev.certifications, createEmptyStaffCertification()],
              }))
            }
          >
            Add certification
          </Button>
        </div>

        {profile.certifications.length ? (
          <div className="mt-4 space-y-3">
            {profile.certifications.map((cert, index) => (
              <div
                key={`${cert.id ?? "new"}-${index}`}
                className="grid gap-3 sm:grid-cols-[1.5fr_1fr_1fr_1fr_auto] sm:items-end"
              >
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Certification</Label>
                  <Input
                    placeholder="Certification"
                    value={cert.title}
                    onChange={(event) =>
                      updateCertification(index, { title: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Issuer</Label>
                  <Input
                    placeholder="Issuer"
                    value={cert.issuer}
                    onChange={(event) =>
                      updateCertification(index, { issuer: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Issue date</Label>
                  <Input
                    type="date"
                    value={cert.issuedAt}
                    onChange={(event) =>
                      updateCertification(index, { issuedAt: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Expiry date</Label>
                  <Input
                    type="date"
                    value={cert.expiresAt}
                    onChange={(event) =>
                      updateCertification(index, { expiresAt: event.target.value })
                    }
                  />
                </div>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Remove certification"
                  onClick={() =>
                    setProfile((prev) => ({
                      ...prev,
                      certifications: prev.certifications.filter((_, idx) => idx !== index),
                    }))
                  }
                >
                  <Trash2Icon className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No certifications added yet.</p>
        )}
      </div>
    </>
  )
}
