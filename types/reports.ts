import type { ListResponse } from "./api"
import type { RecordOffice } from "./companies"

export type CouponUsageReportStatus = "used" | "not_used"

export type CouponUsageReportContext = {
  office: RecordOffice | null
  timeZone: string
  dateFormat: string
  timeFormat: "H12" | "H24"
}
export type CouponUsageReportResponse = ListResponse<CouponUsageReportRow> & {
  summary: CouponUsageReportSummary
  status: CouponUsageReportStatus
  context: CouponUsageReportContext
}

export type CouponUsageReportRow = {
  customerId: string
  customerName: string | null
  customerEmail: string
  customerPhone: string | null
  customerStatus: "ACTIVE" | "SUSPENDED" | "INVITED" | "ARCHIVED"
  couponUsageCount: number
  distinctCouponCount: number
  usedCouponCodes: string[]
  lastCouponUsedAt: string | null
}

export type CouponUsageReportSummary = {
  totalCustomers: number
  usedCustomers: number
  notUsedCustomers: number
  totalRedemptions: number
}

export type AuditLogReportRow = {
  id: string
  event: string
  entityType: string
  entityId: string | null
  actorUserId: string | null
  actorRole: "ADMIN" | "MANAGER" | "STAFF" | "CUSTOMER" | null
  actorName: string | null
  actorEmail: string | null
  requestId: string | null
  createdAt: string
}

export type AuditFieldChange = { field: string; before: unknown; after: unknown }
export type AuditLogDetail = AuditLogReportRow & { metadata: unknown; before: unknown; after: unknown; changes: AuditFieldChange[] }
