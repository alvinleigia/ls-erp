import type { Role } from "@/lib/permissions"

export type InviteFormValues = {
  email: string
  role: Role
  delivery: "EMAIL" | "LINK"
  accessRoleIds: string[]
}

export const inviteRoleOptions: Role[] = ["ADMIN", "MANAGER", "STAFF", "CUSTOMER"]

export const defaultInviteFormValues: InviteFormValues = {
  email: "",
  role: "CUSTOMER",
  delivery: "EMAIL",
  accessRoleIds: [],
}

