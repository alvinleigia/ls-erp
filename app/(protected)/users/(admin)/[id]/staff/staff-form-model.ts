import { toISODate } from "@/lib/date"
import type { StaffProfileForm, StaffUser } from "@/types/users"

export const emptyStaffProfileForm: StaffProfileForm = {
  managerUserId: "",
  leaveApprovalMode: "REPORTING_MANAGER",
  schedulingMode: "STANDARD",
  certifications: [],
  documents: [],
}

export const createEmptyStaffDocument = (): StaffProfileForm["documents"][number] => ({
  type: "ID",
  number: "",
  imageUrl: "",
  validFrom: "",
  validTo: "",
})

export const createEmptyStaffCertification = (): StaffProfileForm["certifications"][number] => ({
  title: "",
  issuer: "",
  issuedAt: "",
  expiresAt: "",
})

export const toStaffProfileForm = (user: StaffUser | null): StaffProfileForm => ({
  managerUserId: user?.staffProfile?.managerUserId ?? "",
  leaveApprovalMode: user?.staffProfile?.leaveApprovalMode ?? "REPORTING_MANAGER",
  schedulingMode: user?.staffProfile?.schedulingMode ?? "STANDARD",
  certifications:
    user?.staffProfile?.certifications?.map((cert) => ({
      id: cert.id,
      title: cert.title,
      issuer: cert.issuer ?? "",
      issuedAt: cert.issuedAt ? toISODate(cert.issuedAt) : "",
      expiresAt: cert.expiresAt ? toISODate(cert.expiresAt) : "",
    })) ?? [],
  documents:
    user?.staffProfile?.documents?.map((doc) => ({
      id: doc.id,
      type: doc.type,
      number: doc.number ?? "",
      imageUrl: doc.imageUrl,
      validFrom: doc.validFrom ? toISODate(doc.validFrom) : "",
      validTo: doc.validTo ? toISODate(doc.validTo) : "",
    })) ?? [],
})
