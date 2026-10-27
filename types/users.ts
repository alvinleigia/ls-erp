import type { Role } from "@/lib/permissions"

export type Gender = "MALE" | "FEMALE" | "NON_BINARY" | "OTHER" | "PREFER_NOT_TO_SAY"
export type UserStatus = "ACTIVE" | "SUSPENDED" | "INVITED" | "ARCHIVED"
export type StaffDocumentType = "ADDRESS" | "ID" | "OTHER"

export type UserAddress = {
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  country?: string | null
}

export type UserCore = UserAddress & {
  collaboratorId?: string | null
  id: string
  name: string | null
  email: string
  phone?: string | null
  image?: string | null
  dateOfBirth?: string | null
  gender?: Gender | null
}

export type UserRow = UserCore & {
  role: Role
  status?: UserStatus | null
  lastLoginAt?: string | null
  marketingOptIn?: boolean | null
  createdAt: string
}

export type UserProfile = UserCore & {
  role: Role
  status: UserStatus
  marketingOptIn: boolean
  createdAt: string
  updatedAt: string
  staffProfile?: {
    leaveApprovalMode?: "REPORTING_MANAGER" | "TENANT_ADMIN"
    managerUserId?: string | null
    schedulingMode?: "STANDARD" | "FLEXIBLE"
    manager?: {
      id: string
      name: string | null
      email: string
    } | null
  } | null
}

export type UserFormValues = {
  officeAccess?: import("@/types/companies").OfficeMembershipDraft
  accessRoleIds?: string[]
  recordRules?: import("@/platform/access/rules").RecordRules
  name: string
  email: string
  phone: string
  image: string
  dateOfBirth: string
  gender: Gender
  status: UserStatus
  marketingOptIn: boolean
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
  country: string
  role: Role
  password: string
}

export type ProfileFormValues = {
  name: string
  email: string
  phone: string
  image: string
  dateOfBirth: string
  gender: Gender
  marketingOptIn: boolean
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
  country: string
}

export type StaffCertification = {
  id: string
  title: string
  issuer: string | null
  issuedAt: string | null
  expiresAt: string | null
}

export type StaffDocument = {
  id: string
  type: StaffDocumentType
  number: string | null
  imageUrl: string
  validFrom: string | null
  validTo: string | null
}

export type StaffUser = UserCore & {
  role: Role
  eligibleServiceIds?: string[]
  staffProfile?: {
    leaveApprovalMode?: "REPORTING_MANAGER" | "TENANT_ADMIN"
    managerUserId?: string | null
    schedulingMode?: "STANDARD" | "FLEXIBLE"
    manager?: {
      id: string
      name: string | null
      email: string
    } | null
    certifications?: StaffCertification[]
    documents?: StaffDocument[]
  } | null
}

export type StaffProfileForm = {
  managerUserId: string
  leaveApprovalMode: "REPORTING_MANAGER" | "TENANT_ADMIN"
  schedulingMode: "STANDARD" | "FLEXIBLE"
  certifications: {
    id?: string
    title: string
    issuer: string
    issuedAt: string
    expiresAt: string
  }[]
  documents: {
    id?: string
    type: StaffDocumentType
    number: string
    imageUrl: string
    validFrom: string
    validTo: string
  }[]
}
