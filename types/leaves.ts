export type LeaveDefinitionType =
  | "PAID"
  | "LAY_OFF"
  | "UNPAID"
  | "RESTRICTED"
  | "COMPENSATORY"
  | "TOUR_ON_DUTY"

export type LeaveDefinitionAllowedUsers = "MALE" | "FEMALE" | "ALL"
export type LeaveDefinitionStatus = "ACTIVE" | "INACTIVE"
export type LeaveGroupAssignmentMode = "ALL_STAFF" | "SELECTED_STAFF"
export type LeaveGroupStatus = "ACTIVE" | "INACTIVE"
export type LeaveRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELED" | "REVOKED"

export type LeaveDefinitionRow = {
  id: string
  code: string
  name: string
  leaveType: LeaveDefinitionType
  allowedUsers: LeaveDefinitionAllowedUsers
  minDaysPerRequest: number
  maxDaysPerRequest: number
  allowWithOtherLeaves: boolean
  priorEntryAllowed: boolean
  noticeDays: number
  allowCarryForward: boolean
  weekOffSingleSideAllowed: boolean
  weekOffBothSideAllowed: boolean
  holidaySingleSideAllowed: boolean
  holidayBothSideAllowed: boolean
  maxPendingRequests: number
  status: LeaveDefinitionStatus
  sortOrder: number
  createdAt: string
  updatedAt: string
  nonClubbableWith: Array<{
    id: string
    code: string
    name: string
  }>
}

export type LeaveDefinitionFormValues = {
  code: string
  name: string
  leaveType: LeaveDefinitionType
  allowedUsers: LeaveDefinitionAllowedUsers
  minDaysPerRequest: number
  maxDaysPerRequest: number
  allowWithOtherLeaves: boolean
  priorEntryAllowed: boolean
  noticeDays: number
  allowCarryForward: boolean
  weekOffSingleSideAllowed: boolean
  weekOffBothSideAllowed: boolean
  holidaySingleSideAllowed: boolean
  holidayBothSideAllowed: boolean
  maxPendingRequests: number
  status: LeaveDefinitionStatus
  sortOrder: number
  nonClubbableWithIds: string[]
}

export type LeaveGroupRow = {
  id: string
  code: string
  name: string
  description: string | null
  assignmentMode: LeaveGroupAssignmentMode
  status: LeaveGroupStatus
  sortOrder: number
  createdAt: string
  updatedAt: string
  leaveDefinitions: Array<{
    id: string
    code: string
    name: string
  }>
  assignedStaff: Array<{
    id: string
    userId: string
    name: string | null
    email: string
  }>
}

export type LeaveGroupFormValues = {
  code: string
  name: string
  description: string
  assignmentMode: LeaveGroupAssignmentMode
  status: LeaveGroupStatus
  sortOrder: number
  leaveDefinitionIds: string[]
  staffIds: string[]
}

export type LeaveRequestRow = {
  officeId: string
  id: string
  staffProfileId: string
  leaveDefinitionId: string
  startDate: string
  endDate: string
  daysCount: number
  reason: string | null
  status: LeaveRequestStatus
  reviewedByUserId: string | null
  reviewedAt: string | null
  reviewerComment: string | null
  canceledAt: string | null
  cancelReason: string | null
  revokedAt: string | null
  revokedByUserId: string | null
  revokeReason: string | null
  createdAt: string
  updatedAt: string
  leaveDefinition: {
    id: string
    code: string
    name: string
  }
  staff: {
    id: string
    userId: string
    name: string | null
    email: string
  }
  reviewedBy: {
    id: string
    name: string | null
    email: string
  } | null
  revokedBy: {
    id: string
    name: string | null
    email: string
  } | null
}

export type LeaveRequestFormValues = {
  leaveDefinitionId: string
  startDate: string
  endDate: string
  reason: string
}

export type LeaveRequestRuleCheck = {
  key: string
  label: string
  passed: boolean
  detail: string
}

export type LeaveRequestTimelineEvent = {
  key: "submitted" | "reviewed" | "canceled" | "revoked"
  title: string
  at: string
  byName: string | null
  byEmail: string | null
  comment: string | null
}

export type LeaveRequestDetail = {
  item: LeaveRequestRow
  ruleChecks: LeaveRequestRuleCheck[]
  timeline: LeaveRequestTimelineEvent[]
}

export type LeaveRosterItem = {
  id: string
  staffId: string
  staffName: string | null
  staffEmail: string
  leaveDefinitionCode: string
  leaveDefinitionName: string
  startDate: string
  endDate: string
  reason: string | null
}
