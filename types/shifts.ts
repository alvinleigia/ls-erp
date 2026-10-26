import type { Weekday } from "@/types/scheduling"
import type { RecordOffice as WorkforceOffice } from "@/types/companies"
export type { WorkforceOffice }
export type RosterDay = {
  staffId: string; date: string
  state: "WORKING" | "NONWORKING" | "OUTSIDE" | "UNPLACED" | "MISSING"
  periods: { startTime: string; endTime: string }[]
  paidMinutes: number | null; frozen: boolean; canEdit: boolean
}
export type { AppointmentConflict } from "@/types/appointments"

export type StaffOption = {
  status?: string
  id: string
  name: string | null
  email: string
  image?: string | null
  staffProfile?: {
    schedulingMode?: "STANDARD" | "FLEXIBLE"
  } | null
}

export type ShiftTemplateBreak = {
  id?: string
  startTime: string
  endTime: string
  sortOrder?: number
}

export type ShiftTemplateOption = {
  id: string
  name: string
}

export type ShiftTemplateRow = {
  id: string
  name: string
  description: string | null
  color: string | null
  isActive: boolean
  startTime: string
  endTime: string
  breaks: ShiftTemplateBreak[]
  createdAt: string
  updatedAt: string
}

export type ShiftTemplateForm = {
  name: string
  description: string
  color: string
  isActive: boolean
  startTime: string
  endTime: string
  breaks: ShiftTemplateBreak[]
}

export type ShiftScheduleBlock = {
  id?: string
  templateId: string
  repeatDays: number
  sortOrder?: number
  template?: ShiftTemplateOption | null
}

export type ScheduleAssignment = {
  id: string
  startDate: string
  endDate?: string | null
  staffProfile?: { user?: StaffOption | null } | null
}

export type ShiftSchedule = {
  officeId: string
  office?: { id: string; name: string; companyName: string; active: boolean } | null
  id: string
  name: string | null
  isDefault?: boolean
  startDate: string
  weekOffDay1: Weekday
  weekOffDay2: Weekday | null
  weekOff2Weeks: number[]
  blocks: ShiftScheduleBlock[]
  assignments?: ScheduleAssignment[]
  createdAt: string
  updatedAt: string
}

export type ShiftScheduleForm = {
  name: string
  staffIds: string[]
  isDefault: boolean
  startDate: string
  assignmentStartDate: string
  assignmentEndDate: string
  weekOffDay1: Weekday
  weekOffDay2: Weekday | ""
  weekOff2Weeks: number[]
  blocks: { templateId: string; repeatDays: number }[]
}

export type StaffScheduleAssignment = {
  id: string
  staffId: string | null
  staffProfileId: string
  scheduleId: string
  startDate: string
  endDate?: string | null
  schedule: ShiftSchedule
}

export type ShiftOverride = {
  officeId: string
  office?: WorkforceOffice | null
  id: string
  staffId: string | null
  staffProfileId: string
  date: string
  templateId: string | null
}

export type StaffFlexibleSlot = {
  officeId: string
  office?: WorkforceOffice | null
  id: string
  staffId: string | null
  staffProfileId: string
  date: string
  startTime: string
  endTime: string
  sortOrder: number
}

export type StaffFlexibleWeekBreak = {
  id: string
  startTime: string
  endTime: string
  sortOrder: number
}

export type StaffFlexibleWeekSlot = {
  id: string
  startTime: string
  endTime: string
  sortOrder: number
  breaks: StaffFlexibleWeekBreak[]
}

export type StaffFlexibleWeekDay = {
  id: string
  day: Weekday
  isOff: boolean
  sortOrder: number
  slots: StaffFlexibleWeekSlot[]
}

export type StaffFlexibleWeekPlan = {
  officeId: string
  office?: WorkforceOffice | null
  id: string
  staffId: string | null
  staffProfileId: string
  weekStartDate: string
  days: StaffFlexibleWeekDay[]
}

export type StaffFlexiblePatternBreak = {
  id: string
  startTime: string
  endTime: string
  sortOrder: number
}

export type StaffFlexiblePatternSlot = {
  id: string
  startTime: string
  endTime: string
  sortOrder: number
  breaks: StaffFlexiblePatternBreak[]
}

export type StaffFlexiblePatternDay = {
  id: string
  day: Weekday
  isOff: boolean
  sortOrder: number
  slots: StaffFlexiblePatternSlot[]
}

export type StaffFlexiblePatternWeek = {
  id: string
  weekIndex: number
  days: StaffFlexiblePatternDay[]
}

export type StaffFlexiblePattern = {
  officeId: string
  office?: WorkforceOffice | null
  id: string
  staffId: string | null
  staffProfileId: string
  name: string | null
  cycleLengthWeeks: number
  validFrom: string
  validTo: string | null
  isActive: boolean
  weeks: StaffFlexiblePatternWeek[]
}

export type StaffFlexiblePatternListItem = {
  officeId: string
  office?: WorkforceOffice | null
  id: string
  staffId: string | null
  staffProfileId: string
  staffName: string | null
  staffEmail: string
  name: string | null
  cycleLengthWeeks: number
  validFrom: string
  validTo: string | null
  isActive: boolean
  isCurrentlyEffective: boolean
  createdAt: string
  updatedAt: string
}

export type RosterHistoryDay = {
  staffId: string
  date: string
  source: "SCHEDULE" | "OVERRIDE" | "LEAVE" | "UNAVAILABLE" | "OFF"
  templateId: string | null
  templateName: string | null
  startTime: string | null
  endTime: string | null
  paidMinutes: number
  leaveDefinitionCode: string | null
  leaveDefinitionName: string | null
  leaveReason: string | null
}

export type AvailabilityEvent = {
  Id: string
  Subject: string
  StartTime: Date
  EndTime: Date
  IsAllDay: boolean
  staffId: string
  templateStart?: string
  templateEnd?: string
  templateBreaks?: string[]
  isUnavailable?: boolean
  isLeave?: boolean
  leaveCode?: string
  leaveName?: string
  leaveReason?: string | null
  CategoryColor?: string
}
