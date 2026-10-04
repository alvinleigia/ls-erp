"use client"
import { useBusinessModules } from "@/platform/module-provider"

import { ActionDialogContent } from "@/components/erp/action-dialog"

import { PageHeader, pageClass } from "@/components/erp/page"

import { Select, Checkbox } from "@/components/erp/controls"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import type { ScheduleComponent } from "@syncfusion/ej2-react-schedule"
import { Calendar } from "@/components/calendar"
import { calendarViewsEnabled } from "@/lib/calendar-features"
import { toast } from "sonner"

import { formatDateForDisplay, parseISODate, toISODate } from "@/lib/date"
import {
  formatTimeFrom24h,
  formatTimeFromDate,
  weekdayToSchedulerFirstDay,
} from "@/lib/formatting"
import { Button } from "@/components/ui/button"
import { SearchableSelect } from "@/components/searchable-select"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TimePicker } from "@/components/ui/time-picker"
import type { LeaveRosterItem } from "@/types/leaves"
import type { AppSettingsPayload, Weekday } from "@/types/scheduling"
import type {
  AppointmentConflict,
  AvailabilityEvent,
  RosterHistoryDay,
  ShiftOverride,
  ShiftSchedule,
  ShiftTemplateRow,
  StaffFlexibleSlot,
  StaffFlexiblePattern,
  StaffFlexibleWeekPlan,
  StaffOption,
  StaffScheduleAssignment,
} from "@/types/shifts"
import {
  APPROVED_LEAVE_COLOR,
  RESOURCE_COLORS,
  UNAVAILABLE_COLOR,
  buildScheduleMap,
  buildShiftSegments,
  buildTemplateColorMap,
  buildTemplateMap,
  formatDateKey,
} from "./roster-model"

const WEEKDAY_BY_INDEX: Weekday[] = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
]

const WEEKDAY_ORDER: Weekday[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
]

type FlexibleDraftBreak = {
  startTime: string
  endTime: string
}

type FlexibleDraftSlot = {
  startTime: string
  endTime: string
  breaks: FlexibleDraftBreak[]
}

type FlexibleDraftDay = {
  day: Weekday
  isOff: boolean
  slots: FlexibleDraftSlot[]
}

type RecurringDraftWeek = {
  weekIndex: number
  days: FlexibleDraftDay[]
}

type RecurringImpactPreview = {
  mode: "UPDATE" | "CLONE"
  patternId: string
  window: {
    startDate: string
    endDate: string | null
    truncatedAt: string | null
    isOpenEnded: boolean
  }
  estimatedBookedHoursInWindow: number
  affectedAppointmentsCount: number
  overlappingActivePatternsCount: number
  notes: string[]
}

const getWeekStartMondayKey = (value: Date) => {
  const date = new Date(value)
  const day = date.getDay()
  const offset = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + offset)
  date.setHours(0, 0, 0, 0)
  return toISODate(date)
}

const toMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map((part) => Number(part))
  return (Number.isNaN(hours) ? 0 : hours) * 60 + (Number.isNaN(minutes) ? 0 : minutes)
}

const createEmptyFlexibleDraftDay = (day: Weekday): FlexibleDraftDay => ({
  day,
  isOff: true,
  slots: [],
})

const cloneFlexibleDraftDays = (days: FlexibleDraftDay[]): FlexibleDraftDay[] =>
  days.map((day) => ({
    day: day.day,
    isOff: day.isOff,
    slots: day.slots.map((slot) => ({
      startTime: slot.startTime,
      endTime: slot.endTime,
      breaks: slot.breaks.map((slotBreak) => ({
        startTime: slotBreak.startTime,
        endTime: slotBreak.endTime,
      })),
    })),
  }))

const hasAnyConfiguredFlexibleDay = (days: FlexibleDraftDay[]) =>
  days.some((day) => !day.isOff || day.slots.length > 0)

export default function RosterPage() {
  const { can, enabled } = useBusinessModules()
  const canEditRoster = can("shiftRoster.edit"), canArchiveRoster = can("shiftRoster.archive")
  const canCreatePlan = can("shiftPlans.create"), canEditPlan = can("shiftPlans.edit"), canArchivePlan = can("shiftPlans.archive")
  const readTemplates = can("shiftTemplates.read"), readSchedules = can("shiftSchedules.read"), readPlans = can("shiftPlans.read")
  const readLeaves = enabled("leaves") && can("leaveApprovals.read")

  const searchParams = useSearchParams()
  const debugEnabled = searchParams.get("debug") === "1"
  const scheduleRef = React.useRef<ScheduleComponent | null>(null)
  const [date, setDate] = React.useState(() => new Date())
  const [viewDates, setViewDates] = React.useState<Date[]>([])
  const [staff, setStaff] = React.useState<StaffOption[]>([])
  const [staffFilter, setStaffFilter] = React.useState<string>("all")
  const [rosterMode, setRosterMode] = React.useState<"grid" | "calendar">("grid")
  const [settings, setSettings] = React.useState<AppSettingsPayload>({
    workingHours: [],
    overrides: [],
  })
  const [firstDayOfWeek, setFirstDayOfWeek] = React.useState(0)
  const [templates, setTemplates] = React.useState<ShiftTemplateRow[]>([])
  const [staffAssignments, setStaffAssignments] = React.useState<
    Record<string, StaffScheduleAssignment[]>
  >({})
  const [defaultSchedule, setDefaultSchedule] = React.useState<ShiftSchedule | null>(null)
  const [overrides, setOverrides] = React.useState<ShiftOverride[]>([])
  const [flexibleSlots, setFlexibleSlots] = React.useState<StaffFlexibleSlot[]>([])
  const [flexibleWeekPlans, setFlexibleWeekPlans] = React.useState<StaffFlexibleWeekPlan[]>([])
  const [flexiblePatterns, setFlexiblePatterns] = React.useState<StaffFlexiblePattern[]>([])
  const [approvedLeaves, setApprovedLeaves] = React.useState<LeaveRosterItem[]>([])
  const [historyDays, setHistoryDays] = React.useState<RosterHistoryDay[]>([])
  const approvedLeavesRequestVersionRef = React.useRef(0)
  const [overrideOpen, setOverrideOpen] = React.useState(false)
  const [saveAsNewConfirmOpen, setSaveAsNewConfirmOpen] = React.useState(false)
  const [overrideStaffId, setOverrideStaffId] = React.useState<string>("")
  const [overrideStartDate, setOverrideStartDate] = React.useState<string>("")
  const [overrideEndDate, setOverrideEndDate] = React.useState<string>("")
  const [overrideTemplateId, setOverrideTemplateId] = React.useState<string>("")
  const [overrideSkipWeekOff, setOverrideSkipWeekOff] = React.useState(false)
  const [overrideUnavailable, setOverrideUnavailable] = React.useState(false)
  const [useFlexibleSlot, setUseFlexibleSlot] = React.useState(false)
  const [flexibleEditorMode, setFlexibleEditorMode] = React.useState<"WEEK_OVERRIDE" | "RECURRING_PATTERN">(
    "WEEK_OVERRIDE"
  )
  const [flexibleDraftDays, setFlexibleDraftDays] = React.useState<FlexibleDraftDay[]>(
    WEEKDAY_ORDER.map((day) => createEmptyFlexibleDraftDay(day))
  )
  const [recurringPatternId, setRecurringPatternId] = React.useState<string>("")
  const [recurringImpactMode, setRecurringImpactMode] = React.useState<"UPDATE" | "CLONE">("UPDATE")
  const [recurringImpactPreview, setRecurringImpactPreview] = React.useState<RecurringImpactPreview | null>(null)
  const [recurringImpactLoading, setRecurringImpactLoading] = React.useState(false)
  const [recurringPatternName, setRecurringPatternName] = React.useState("")
  const [recurringValidFrom, setRecurringValidFrom] = React.useState("")
  const [recurringValidTo, setRecurringValidTo] = React.useState("")
  const [recurringCycleLength, setRecurringCycleLength] = React.useState(1)
  const [recurringSelectedWeekIndex, setRecurringSelectedWeekIndex] = React.useState(1)
  const [recurringDraftWeeks, setRecurringDraftWeeks] = React.useState<RecurringDraftWeek[]>([
    { weekIndex: 1, days: WEEKDAY_ORDER.map((day) => createEmptyFlexibleDraftDay(day)) },
  ])
  const [conflictsOpen, setConflictsOpen] = React.useState(false)
  const [conflicts, setConflicts] = React.useState<AppointmentConflict[]>([])
  const [conflictAction, setConflictAction] = React.useState<
    "cancel" | "reassign" | "reschedule"
  >("cancel")
  const [conflictStaffId, setConflictStaffId] = React.useState("")
  const [conflictRescheduleDate, setConflictRescheduleDate] = React.useState("")
  const [conflictRescheduleTime, setConflictRescheduleTime] = React.useState("")

  const loadStaff = React.useCallback(async () => {
    try {
      const response = await fetch("/api/directory?role=STAFF&pageSize=100")
      if (!response.ok) {
        throw new Error("Failed to load staff.")
      }
      const data = (await response.json()) as { items?: StaffOption[] }
      const items = data.items ?? []
      setStaff(items)
    } catch (error) {
      console.error(error)
      toast.error("Unable to load staff.")
    }
  }, [])

  const loadSettings = React.useCallback(async () => {
    try {
      const response = await fetch("/api/settings/operations")
      if (!response.ok) {
        return
      }
      const data = (await response.json()) as { settings?: AppSettingsPayload }
      const nextSettings = data.settings
      if (nextSettings) {
        setSettings({
          workingHours: nextSettings.workingHours ?? [],
          overrides: nextSettings.overrides ?? [],
          timeZone: nextSettings.timeZone,
          dateFormat: nextSettings.dateFormat,
          timeFormat: nextSettings.timeFormat,
        })
        setFirstDayOfWeek(weekdayToSchedulerFirstDay(nextSettings.firstDayOfWeek))
      }
    } catch (error) {
      console.error(error)
    }
  }, [])

  const loadTemplates = React.useCallback(async () => {
    if (!readTemplates) { setTemplates([]); return }
    try {
      const response = await fetch("/api/shifts/templates?includeInactive=true", {
        cache: "no-store",
      })
      if (!response.ok) {
        throw new Error("Failed to load shift templates.")
      }
      const data = (await response.json()) as { items?: ShiftTemplateRow[] }
      const items = data.items ?? []
      setTemplates(items)
    } catch (error) {
      console.error(error)
      toast.error("Unable to load shift templates.")
    }
  }, [readTemplates])

  const loadDefaultSchedule = React.useCallback(async () => {
    if (!readSchedules) { setDefaultSchedule(null); return }
    try {
      const response = await fetch(
        "/api/shifts/schedules?isDefault=true&page=1&pageSize=1",
        { cache: "no-store" }
      )
      if (!response.ok) {
        throw new Error("Failed to load default schedule.")
      }
      const data = (await response.json()) as { items?: ShiftSchedule[] }
      const defaultItem = data.items?.[0] ?? null
      setDefaultSchedule(defaultItem)
    } catch (error) {
      console.error(error)
      setDefaultSchedule(null)
    }
  }, [readSchedules])

  const loadStaffAssignments = React.useCallback(
    async (staffIds: string[], rangeStart: string, rangeEnd: string) => {
      if (!readSchedules) { setStaffAssignments({}); return }
      try {
        const response = await fetch(
          `/api/shifts/assignments?startDate=${rangeStart}&endDate=${rangeEnd}&staffIds=${staffIds.join(
            ","
          )}`,
          { cache: "no-store" }
        )
        if (!response.ok) {
          throw new Error("Failed to load staff assignments.")
        }
        const data = (await response.json()) as { items?: StaffScheduleAssignment[] }
        const grouped: Record<string, StaffScheduleAssignment[]> = {}
        for (const assignment of data.items ?? []) {
          if (!assignment.staffId) continue
          if (!grouped[assignment.staffId]) {
            grouped[assignment.staffId] = []
          }
          grouped[assignment.staffId].push(assignment)
        }
        setStaffAssignments(grouped)
      } catch (error) {
        console.error(error)
        toast.error("Unable to load staff schedules.")
      }
    },
    [readSchedules]
  )

  React.useEffect(() => {
    void loadStaff()
  }, [loadStaff])

  React.useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  React.useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  React.useEffect(() => {
    void loadDefaultSchedule()
  }, [loadDefaultSchedule])

  const availabilityDates = React.useMemo(() => {
    if (rosterMode === "grid") {
      const start = new Date(date)
      const offset = (start.getDay() - firstDayOfWeek + 7) % 7
      start.setDate(start.getDate() - offset)
      start.setHours(0, 0, 0, 0)
      return Array.from({ length: 7 }, (_, index) => {
        const next = new Date(start)
        next.setDate(start.getDate() + index)
        return next
      })
    }
    if (viewDates.length) {
      return viewDates
    }
    const current = new Date(date)
    const start = new Date(current.getFullYear(), current.getMonth(), 1)
    const dayIndex = start.getDay()
    start.setDate(start.getDate() - dayIndex)
    return Array.from({ length: 42 }, (_, index) => {
      const next = new Date(start)
      next.setDate(start.getDate() + index)
      return next
    })
  }, [date, firstDayOfWeek, rosterMode, viewDates])

  React.useEffect(() => {
    if (!staff.length || !availabilityDates.length) return
    const rangeStart = toISODate(availabilityDates[0])
    const rangeEnd = toISODate(availabilityDates[availabilityDates.length - 1])
    const staffIds =
      staffFilter === "all"
        ? staff.map((member) => member.id)
        : staff.filter((member) => member.id === staffFilter).map((member) => member.id)
    if (!staffIds.length) return
    void loadStaffAssignments(staffIds, rangeStart, rangeEnd)
  }, [availabilityDates, loadStaffAssignments, staff, staffFilter])

  const filteredStaff = React.useMemo(() => {
    if (staffFilter === "all") {
      return staff
    }
    return staff.filter((member) => member.id === staffFilter)
  }, [staff, staffFilter])

  const loadOverrides = React.useCallback(async () => {
    if (!availabilityDates.length || !staff.length) return
    const start = toISODate(availabilityDates[0])
    const end = toISODate(availabilityDates[availabilityDates.length - 1])
    const staffIds =
      staffFilter === "all" ? staff.map((member) => member.id) : [staffFilter]
    if (!staffIds.length) return
    try {
      const response = await fetch(
        `/api/shifts/overrides?startDate=${start}&endDate=${end}&staffIds=${staffIds.join(",")}`,
        { cache: "no-store" }
      )
      if (!response.ok) {
        throw new Error("Failed to load overrides.")
      }
      const data = (await response.json()) as { items?: ShiftOverride[] }
      setOverrides(data.items ?? [])
    } catch (error) {
      console.error(error)
      toast.error("Unable to load roster overrides.")
    }
  }, [availabilityDates, staff, staffFilter])

  React.useEffect(() => {
    void loadOverrides()
  }, [loadOverrides])

  const loadFlexibleSlots = React.useCallback(async () => {
    if (!availabilityDates.length || !staff.length) return
    const start = toISODate(availabilityDates[0])
    const end = toISODate(availabilityDates[availabilityDates.length - 1])
    const staffIds =
      staffFilter === "all" ? staff.map((member) => member.id) : [staffFilter]
    if (!staffIds.length) return
    try {
      const response = await fetch(
        `/api/shifts/flexible-slots?startDate=${start}&endDate=${end}&staffIds=${staffIds.join(",")}`,
        { cache: "no-store" }
      )
      if (!response.ok) {
        throw new Error("Failed to load flexible slots.")
      }
      const data = (await response.json()) as { items?: StaffFlexibleSlot[] }
      setFlexibleSlots(data.items ?? [])
    } catch (error) {
      console.error(error)
      setFlexibleSlots([])
      toast.error("Unable to load flexible staff slots.")
    }
  }, [availabilityDates, staff, staffFilter])

  React.useEffect(() => {
    void loadFlexibleSlots()
  }, [loadFlexibleSlots])

  const loadFlexibleWeekPlans = React.useCallback(async () => {
    if (!availabilityDates.length || !staff.length) return
    const staffIds =
      staffFilter === "all"
        ? staff.map((member) => member.id)
        : [staffFilter]
    if (!staffIds.length) return

    const weekStartKeys = Array.from(
      new Set(availabilityDates.map((value) => getWeekStartMondayKey(value)))
    )
    if (!weekStartKeys.length) {
      setFlexibleWeekPlans([])
      return
    }

    try {
      const responses = await Promise.all(
        weekStartKeys.map((weekStartDate) =>
          fetch(
            `/api/shifts/flexible-week-plans?weekStartDate=${weekStartDate}&staffIds=${staffIds.join(",")}`,
            { cache: "no-store" }
          )
        )
      )
      const payloads = await Promise.all(
        responses.map(async (response) => {
          if (!response.ok) return []
          const data = (await response.json()) as { items?: StaffFlexibleWeekPlan[] }
          return data.items ?? []
        })
      )
      setFlexibleWeekPlans(payloads.flat())
    } catch (error) {
      console.error(error)
      setFlexibleWeekPlans([])
      toast.error("Unable to load flexible weekly plans.")
    }
  }, [availabilityDates, staff, staffFilter])

  React.useEffect(() => {
    void loadFlexibleWeekPlans()
  }, [loadFlexibleWeekPlans])

  const loadFlexiblePatterns = React.useCallback(async () => {
    if (!readPlans) { setFlexiblePatterns([]); return }
    if (!availabilityDates.length || !staff.length) return
    const staffIds =
      staffFilter === "all"
        ? staff.map((member) => member.id)
        : [staffFilter]
    if (!staffIds.length) return

    const startDate = toISODate(availabilityDates[0])
    const endDate = toISODate(availabilityDates[availabilityDates.length - 1])

    try {
      const response = await fetch(
        `/api/shifts/flexible-patterns?staffIds=${staffIds.join(",")}&startDate=${startDate}&endDate=${endDate}`,
        { cache: "no-store" }
      )
      if (!response.ok) {
        throw new Error("Failed to load flexible patterns.")
      }
      const data = (await response.json()) as { items?: StaffFlexiblePattern[] }
      setFlexiblePatterns(data.items ?? [])
    } catch (error) {
      console.error(error)
      setFlexiblePatterns([])
      toast.error("Unable to load flexible recurring patterns.")
    }
  }, [availabilityDates, staff, staffFilter, readPlans])

  React.useEffect(() => {
    void loadFlexiblePatterns()
  }, [loadFlexiblePatterns])

  const loadApprovedLeaves = React.useCallback(async () => {
    if (!readLeaves) { setApprovedLeaves([]); return }
    if (!availabilityDates.length || !staff.length) return
    const start = toISODate(availabilityDates[0])
    const end = toISODate(availabilityDates[availabilityDates.length - 1])
    const staffIds =
      staffFilter === "all" ? staff.map((member) => member.id) : [staffFilter]
    if (!staffIds.length) return
    const requestVersion = approvedLeavesRequestVersionRef.current + 1
    approvedLeavesRequestVersionRef.current = requestVersion
    try {
      const response = await fetch(
        `/api/leaves/approved?startDate=${start}&endDate=${end}&staffIds=${staffIds.join(",")}`,
        { cache: "no-store" }
      )
      if (!response.ok) {
        throw new Error("Failed to load approved leaves.")
      }
      const data = (await response.json()) as { items?: LeaveRosterItem[] }
      if (requestVersion !== approvedLeavesRequestVersionRef.current) {
        return
      }
      setApprovedLeaves(data.items ?? [])
    } catch (error) {
      if (requestVersion !== approvedLeavesRequestVersionRef.current) {
        return
      }
      console.error(error)
      toast.error("Unable to load approved leaves.")
      setApprovedLeaves([])
    }
  }, [availabilityDates, staff, staffFilter, readLeaves])

  React.useEffect(() => {
    void loadApprovedLeaves()
  }, [loadApprovedLeaves])

  const todayKey = React.useMemo(() => toISODate(new Date()), [])

  const loadHistoryDays = React.useCallback(async () => {
    if (!availabilityDates.length || !staff.length) return
    const start = toISODate(availabilityDates[0])
    const end = toISODate(availabilityDates[availabilityDates.length - 1])
    if (start >= todayKey) {
      setHistoryDays([])
      return
    }
    const staffIds =
      staffFilter === "all" ? staff.map((member) => member.id) : [staffFilter]
    if (!staffIds.length) return
    try {
      const response = await fetch(
        `/api/shifts/history?startDate=${start}&endDate=${end}&staffIds=${staffIds.join(",")}`,
        { cache: "no-store" }
      )
      if (!response.ok) {
        throw new Error("Failed to load roster history.")
      }
      const data = (await response.json()) as { items?: RosterHistoryDay[] }
      setHistoryDays(data.items ?? [])
    } catch (error) {
      console.error(error)
      setHistoryDays([])
    }
  }, [availabilityDates, staff, staffFilter, todayKey])

  React.useEffect(() => {
    void loadHistoryDays()
  }, [loadHistoryDays])

  const templateMap = React.useMemo(() => buildTemplateMap(templates), [templates])

  const templateColorMap = React.useMemo(
    () => buildTemplateColorMap(templates),
    [templates]
  )

  const staffSchedulingModeMap = React.useMemo(() => {
    const map: Record<string, "STANDARD" | "FLEXIBLE"> = {}
    for (const member of staff) {
      map[member.id] = member.staffProfile?.schedulingMode === "FLEXIBLE" ? "FLEXIBLE" : "STANDARD"
    }
    return map
  }, [staff])

  const scheduleMaps = React.useMemo(() => {
    const maps: Record<string, Record<string, string | null>> = {}
    const viewEnd = availabilityDates[availabilityDates.length - 1]
    const viewEndDate = viewEnd ? new Date(viewEnd) : null
    for (const member of filteredStaff) {
      const assignments = staffAssignments[member.id] ?? []
      const baseMap: Record<string, string | null> = {}
      for (const assignment of assignments) {
        const startDate = parseISODate(assignment.startDate)
        if (!startDate) continue
        const endDate = assignment.endDate ? parseISODate(assignment.endDate) : viewEndDate
        if (!endDate) continue
        const map = buildScheduleMap(
          assignment.schedule,
          availabilityDates,
          startDate,
          endDate
        )
        Object.assign(baseMap, map)
      }
      if (!assignments.length && defaultSchedule) {
        Object.assign(baseMap, buildScheduleMap(defaultSchedule, availabilityDates))
      }
      maps[member.id] = baseMap
    }
    return maps
  }, [availabilityDates, defaultSchedule, filteredStaff, staffAssignments])

  const overrideMap = React.useMemo(() => {
    const map: Record<string, Record<string, string | null>> = {}
    for (const override of overrides) {
      if (!override.staffId) continue
      if (!map[override.staffId]) {
        map[override.staffId] = {}
      }
      map[override.staffId][toISODate(override.date)] =
        override.templateId ?? null
    }
    return map
  }, [overrides])

  const flexibleSlotMap = React.useMemo(() => {
    const map: Record<string, Record<string, Array<{ startTime: string; endTime: string }>>> = {}
    for (const slot of flexibleSlots) {
      if (!slot.staffId) continue
      if (!map[slot.staffId]) {
        map[slot.staffId] = {}
      }
      if (!map[slot.staffId][slot.date]) {
        map[slot.staffId][slot.date] = []
      }
      map[slot.staffId][slot.date].push({
        startTime: slot.startTime,
        endTime: slot.endTime,
      })
    }

    for (const staffId of Object.keys(map)) {
      for (const dateKey of Object.keys(map[staffId])) {
        map[staffId][dateKey].sort((a, b) => a.startTime.localeCompare(b.startTime))
      }
    }
    return map
  }, [flexibleSlots])

  const flexibleWeekPlanMap = React.useMemo(() => {
    const map: Record<string, Record<string, StaffFlexibleWeekPlan>> = {}
    for (const plan of flexibleWeekPlans) {
      if (!plan.staffId) continue
      if (!map[plan.staffId]) {
        map[plan.staffId] = {}
      }
      map[plan.staffId][plan.weekStartDate] = plan
    }
    return map
  }, [flexibleWeekPlans])

  const recurringPatternsByStaffId = React.useMemo(() => {
    const map: Record<string, StaffFlexiblePattern[]> = {}
    for (const pattern of flexiblePatterns) {
      if (!pattern.staffId) continue
      if (!map[pattern.staffId]) {
        map[pattern.staffId] = []
      }
      map[pattern.staffId].push(pattern)
    }
    for (const staffId of Object.keys(map)) {
      map[staffId].sort((a, b) => {
        const aStart = new Date(`${a.validFrom}T00:00:00.000Z`).getTime()
        const bStart = new Date(`${b.validFrom}T00:00:00.000Z`).getTime()
        return bStart - aStart
      })
    }
    return map
  }, [flexiblePatterns])

  const getActiveRecurringPatternForDate = React.useCallback(
    (staffId: string, value: Date) => {
      const patterns = recurringPatternsByStaffId[staffId] ?? []
      const dateValue = new Date(`${toISODate(value)}T00:00:00.000Z`).getTime()
      return (
        patterns.find((pattern) => {
          if (!pattern.isActive) return false
          const validFrom = new Date(`${pattern.validFrom}T00:00:00.000Z`).getTime()
          const validTo = pattern.validTo
            ? new Date(`${pattern.validTo}T23:59:59.999Z`).getTime()
            : Number.POSITIVE_INFINITY
          return dateValue >= validFrom && dateValue <= validTo
        }) ?? null
      )
    },
    [recurringPatternsByStaffId]
  )

  const leaveMap = React.useMemo(() => {
    const map: Record<string, Record<string, LeaveRosterItem>> = {}
    for (const leave of approvedLeaves) {
      const start = parseISODate(leave.startDate)
      const end = parseISODate(leave.endDate)
      if (!start || !end) continue
      const cursor = new Date(start)
      while (cursor <= end) {
        const dateKey = toISODate(cursor)
        if (!map[leave.staffId]) {
          map[leave.staffId] = {}
        }
        map[leave.staffId][dateKey] = leave
        cursor.setDate(cursor.getDate() + 1)
      }
    }
    return map
  }, [approvedLeaves])

  const historyMap = React.useMemo(() => {
    const map: Record<string, Record<string, RosterHistoryDay>> = {}
    for (const item of historyDays) {
      if (!map[item.staffId]) {
        map[item.staffId] = {}
      }
      map[item.staffId][item.date] = item
    }
    return map
  }, [historyDays])

  const getHistoryDay = React.useCallback(
    (value: Date, staffId?: string) => {
      if (!staffId) return null
      const dateKey = toISODate(value)
      if (dateKey >= todayKey) return null
      return historyMap[staffId]?.[dateKey] ?? null
    },
    [historyMap, todayKey]
  )

  const getStaffTemplateForDate = React.useCallback(
    (value: Date, staffId?: string) => {
      if (!staffId) return null
      const history = getHistoryDay(value, staffId)
      if (history) {
        if (!history.templateId || !history.templateName || !history.startTime || !history.endTime) {
          return null
        }
        return {
          id: history.templateId,
          name: history.templateName,
          startTime: history.startTime,
          endTime: history.endTime,
        } as ShiftTemplateRow
      }
      const dateKey = formatDateKey(value)
      const override = overrideMap[staffId]?.[dateKey]
      if (override !== undefined) {
        return override ? templateMap[override] ?? null : null
      }
      if ((staffSchedulingModeMap[staffId] ?? "STANDARD") === "FLEXIBLE") {
        return null
      }
      const scheduleMap = scheduleMaps[staffId]
      if (scheduleMap && Object.prototype.hasOwnProperty.call(scheduleMap, dateKey)) {
        const templateId = scheduleMap[dateKey]
        return templateId ? templateMap[templateId] ?? null : null
      }
      return null
    },
    [getHistoryDay, overrideMap, scheduleMaps, staffSchedulingModeMap, templateMap]
  )

  const getStaffPeriodsForDate = React.useCallback(
    (value: Date, staffId?: string) => {
      if (!staffId) {
        return []
      }
      const history = getHistoryDay(value, staffId)
      if (history) {
        if (history.templateId && templateMap[history.templateId]) {
          return buildShiftSegments(templateMap[history.templateId])
        }
        if (!history.startTime || !history.endTime) {
          return []
        }
        return [{ startTime: history.startTime, endTime: history.endTime }]
      }
      const dateKey = formatDateKey(value)
      const override = overrideMap[staffId]?.[dateKey]
      if (override !== undefined) {
        if (!override) {
          return []
        }
        const template = templateMap[override]
        return template ? buildShiftSegments(template) : []
      }

      const schedulingMode = staffSchedulingModeMap[staffId] ?? "STANDARD"
      if (schedulingMode === "FLEXIBLE") {
        const weekStartDate = getWeekStartMondayKey(value)
        const weekday = WEEKDAY_BY_INDEX[value.getDay()]
        const dayPlan = flexibleWeekPlanMap[staffId]?.[weekStartDate]?.days.find(
          (day) => day.day === weekday
        )
        if (dayPlan?.isOff) {
          return []
        }
        if (dayPlan?.slots?.length) {
          return dayPlan.slots.flatMap((slot) => {
            const breaks = slot.breaks
              .slice()
              .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))
            const segments: Array<{ startTime: string; endTime: string }> = []
            let cursor = toMinutes(slot.startTime)
            const slotEnd = toMinutes(slot.endTime)

            for (const currentBreak of breaks) {
              const breakStart = toMinutes(currentBreak.startTime)
              const breakEnd = toMinutes(currentBreak.endTime)
              if (breakStart > cursor) {
                segments.push({
                  startTime: `${String(Math.floor(cursor / 60)).padStart(2, "0")}:${String(cursor % 60).padStart(2, "0")}`,
                  endTime: `${String(Math.floor(breakStart / 60)).padStart(2, "0")}:${String(breakStart % 60).padStart(2, "0")}`,
                })
              }
              cursor = Math.max(cursor, breakEnd)
            }

            if (cursor < slotEnd) {
              segments.push({
                startTime: `${String(Math.floor(cursor / 60)).padStart(2, "0")}:${String(cursor % 60).padStart(2, "0")}`,
                endTime: `${String(Math.floor(slotEnd / 60)).padStart(2, "0")}:${String(slotEnd % 60).padStart(2, "0")}`,
              })
            }

            return segments
          })
        }

        const recurringPattern = getActiveRecurringPatternForDate(staffId, value)
        if (recurringPattern) {
          const dateKeyUtc = toISODate(value)
          const validFrom = new Date(`${recurringPattern.validFrom}T00:00:00.000Z`).getTime()
          const validTo = recurringPattern.validTo
            ? new Date(`${recurringPattern.validTo}T23:59:59.999Z`).getTime()
            : Number.POSITIVE_INFINITY
          const dateValue = new Date(`${dateKeyUtc}T00:00:00.000Z`).getTime()
          if (dateValue >= validFrom && dateValue <= validTo) {
            const weekOffset = Math.floor(Math.max(0, (dateValue - validFrom) / 86400000) / 7)
            const weekIndex = (weekOffset % recurringPattern.cycleLengthWeeks) + 1
            const patternWeek = recurringPattern.weeks.find((week) => week.weekIndex === weekIndex)
            const patternDay = patternWeek?.days.find((day) => day.day === weekday)
            if (patternDay?.isOff) {
              return []
            }
            if (patternDay?.slots?.length) {
              return patternDay.slots.flatMap((slot) => {
                const breaks = slot.breaks
                  .slice()
                  .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))
                const segments: Array<{ startTime: string; endTime: string }> = []
                let cursor = toMinutes(slot.startTime)
                const slotEnd = toMinutes(slot.endTime)

                for (const currentBreak of breaks) {
                  const breakStart = toMinutes(currentBreak.startTime)
                  const breakEnd = toMinutes(currentBreak.endTime)
                  if (breakStart > cursor) {
                    segments.push({
                      startTime: `${String(Math.floor(cursor / 60)).padStart(2, "0")}:${String(cursor % 60).padStart(2, "0")}`,
                      endTime: `${String(Math.floor(breakStart / 60)).padStart(2, "0")}:${String(breakStart % 60).padStart(2, "0")}`,
                    })
                  }
                  cursor = Math.max(cursor, breakEnd)
                }

                if (cursor < slotEnd) {
                  segments.push({
                    startTime: `${String(Math.floor(cursor / 60)).padStart(2, "0")}:${String(cursor % 60).padStart(2, "0")}`,
                    endTime: `${String(Math.floor(slotEnd / 60)).padStart(2, "0")}:${String(slotEnd % 60).padStart(2, "0")}`,
                  })
                }

                return segments
              })
            }
          }
        }

        const legacyFlexible = flexibleSlotMap[staffId]?.[dateKey]
        return legacyFlexible?.length ? legacyFlexible : []
      }
      const scheduleMap = scheduleMaps[staffId]
      if (scheduleMap && Object.prototype.hasOwnProperty.call(scheduleMap, dateKey)) {
        const templateId = scheduleMap[dateKey]
        if (!templateId) {
          return []
        }
        const template = templateMap[templateId]
        return template ? buildShiftSegments(template) : []
      }
      return []
    },
    [
      getActiveRecurringPatternForDate,
      flexibleWeekPlanMap,
      flexibleSlotMap,
      getHistoryDay,
      overrideMap,
      scheduleMaps,
      staffSchedulingModeMap,
      templateMap,
    ]
  )

  const staffWeeklyHours = React.useMemo(() => {
    const map: Record<string, number> = {}
    for (const member of filteredStaff) {
      let minutesTotal = 0
      for (const day of availabilityDates) {
        const dateKey = toISODate(day)
        const history = getHistoryDay(day, member.id)
        if (history?.source === "LEAVE" || leaveMap[member.id]?.[dateKey]) {
          continue
        }
        const periods = getStaffPeriodsForDate(day, member.id)
        minutesTotal += periods.reduce((sum, period) => {
          const [startHour, startMinute] = period.startTime.split(":").map((value) => Number(value))
          const [endHour, endMinute] = period.endTime.split(":").map((value) => Number(value))
          const start = (Number.isNaN(startHour) ? 0 : startHour) * 60 + (Number.isNaN(startMinute) ? 0 : startMinute)
          const end = (Number.isNaN(endHour) ? 0 : endHour) * 60 + (Number.isNaN(endMinute) ? 0 : endMinute)
          return sum + Math.max(0, end - start)
        }, 0)
      }
      map[member.id] = minutesTotal / 60
    }
    return map
  }, [availabilityDates, filteredStaff, getHistoryDay, getStaffPeriodsForDate, leaveMap])

  const dailyHoursTotals = React.useMemo(
    () =>
      availabilityDates.map((day) => {
        const dateKey = toISODate(day)
        const totalMinutes = filteredStaff.reduce((staffSum, member) => {
          const history = getHistoryDay(day, member.id)
          if (history?.source === "LEAVE" || leaveMap[member.id]?.[dateKey]) {
            return staffSum
          }
          const periods = getStaffPeriodsForDate(day, member.id)
          const minutes = periods.reduce((sum, period) => {
            const [startHour, startMinute] = period.startTime.split(":").map((value) => Number(value))
            const [endHour, endMinute] = period.endTime.split(":").map((value) => Number(value))
            const start = (Number.isNaN(startHour) ? 0 : startHour) * 60 + (Number.isNaN(startMinute) ? 0 : startMinute)
            const end = (Number.isNaN(endHour) ? 0 : endHour) * 60 + (Number.isNaN(endMinute) ? 0 : endMinute)
            return sum + Math.max(0, end - start)
          }, 0)
          return staffSum + minutes
        }, 0)
        return totalMinutes / 60
      }),
    [availabilityDates, filteredStaff, getHistoryDay, getStaffPeriodsForDate, leaveMap]
  )

  const dailyLeaveTotals = React.useMemo(
    () =>
      availabilityDates.map((day) => {
        const dateKey = toISODate(day)
        return filteredStaff.reduce(
          (sum, member) => {
            const history = getHistoryDay(day, member.id)
            return sum + (history?.source === "LEAVE" || leaveMap[member.id]?.[dateKey] ? 1 : 0)
          },
          0
        )
      }),
    [availabilityDates, filteredStaff, getHistoryDay, leaveMap]
  )

  const formatHours = React.useCallback((value: number) => {
    if (Math.abs(value - Math.round(value)) < 0.01) {
      return `${Math.round(value)}h`
    }
    return `${value.toFixed(1)}h`
  }, [])

  const calendarEvents = React.useMemo(() => {
    const list: AvailabilityEvent[] = []

    for (const leave of approvedLeaves) {
      const leaveStart = parseISODate(leave.startDate)
      const leaveEnd = parseISODate(leave.endDate)
      if (!leaveStart || !leaveEnd) continue
      const eventStart = new Date(leaveStart)
      eventStart.setHours(0, 0, 0, 0)
      const eventEnd = new Date(leaveEnd)
      eventEnd.setDate(eventEnd.getDate() + 1)
      eventEnd.setHours(0, 0, 0, 0)
      list.push({
        Id: `leave-${leave.id}`,
        Subject: `${leave.leaveDefinitionCode} - ${leave.leaveDefinitionName}`,
        StartTime: eventStart,
        EndTime: eventEnd,
        IsAllDay: true,
        staffId: leave.staffId,
        isLeave: true,
        leaveCode: leave.leaveDefinitionCode,
        leaveName: leave.leaveDefinitionName,
        leaveReason: leave.reason,
        CategoryColor: APPROVED_LEAVE_COLOR,
      })
    }

    for (const day of availabilityDates) {
      for (const member of filteredStaff) {
        const dateKey = formatDateKey(day)
        const overrideValue = overrideMap[member.id]?.[dateKey]
        if (overrideValue === null) {
          const start = new Date(day)
          start.setHours(0, 0, 0, 0)
          const end = new Date(start)
          end.setDate(end.getDate() + 1)
          list.push({
            Id: `${member.id}-${dateKey}-unavailable`,
            Subject: "Unavailable",
            StartTime: start,
            EndTime: end,
            IsAllDay: true,
            staffId: member.id,
            isUnavailable: true,
            CategoryColor: UNAVAILABLE_COLOR,
          })
          continue
        }
        const periods = getStaffPeriodsForDate(day, member.id)
        if (!periods.length) continue
        const template = getStaffTemplateForDate(day, member.id)
        const label = template?.name ?? "Flexible shift"
        const start = new Date(day)
        start.setHours(0, 0, 0, 0)
        const end = new Date(start)
        end.setDate(end.getDate() + 1)
        const breaks = (template?.breaks ?? [])
          .map(
            (period) =>
              `${formatTimeFrom24h(period.startTime, settings)} - ${formatTimeFrom24h(
                period.endTime,
                settings
              )}`
          )
          .filter(Boolean)
        list.push({
          Id: `${member.id}-${formatDateKey(day)}`,
          Subject: label,
          StartTime: start,
          EndTime: end,
          IsAllDay: true,
          staffId: member.id,
          templateStart: template?.startTime ?? periods[0]?.startTime,
          templateEnd: template?.endTime ?? periods[periods.length - 1]?.endTime,
          templateBreaks: breaks.length ? breaks : undefined,
          CategoryColor: template ? templateColorMap[template.id] : undefined,
        })
      }
    }

    return list
  }, [
    approvedLeaves,
    availabilityDates,
    filteredStaff,
    getStaffPeriodsForDate,
    getStaffTemplateForDate,
    overrideMap,
    settings,
    templateColorMap,
  ])

  const isPastDate = React.useCallback((value: Date) => toISODate(value) < toISODate(new Date()), [])

  const getFlexibleDraftForWeek = React.useCallback(
    (staffId: string, weekStartDate: string): FlexibleDraftDay[] => {
      const existing = flexibleWeekPlanMap[staffId]?.[weekStartDate]
      if (!existing) {
        return WEEKDAY_ORDER.map((day) => createEmptyFlexibleDraftDay(day))
      }
      return WEEKDAY_ORDER.map((day) => {
        const existingDay = existing.days.find((item) => item.day === day)
        if (!existingDay) {
          return createEmptyFlexibleDraftDay(day)
        }
        return {
          day,
          isOff: existingDay.isOff,
          slots: existingDay.slots.map((slot) => ({
            startTime: slot.startTime,
            endTime: slot.endTime,
            breaks: slot.breaks.map((slotBreak) => ({
              startTime: slotBreak.startTime,
              endTime: slotBreak.endTime,
            })),
          })),
        }
      })
    },
    [flexibleWeekPlanMap]
  )

  const createEmptyRecurringWeeks = React.useCallback(
    (cycleLength: number): RecurringDraftWeek[] =>
      Array.from({ length: cycleLength }, (_, index) => ({
        weekIndex: index + 1,
        days: WEEKDAY_ORDER.map((day) => createEmptyFlexibleDraftDay(day)),
      })),
    []
  )

  const getRecurringDraftFromPattern = React.useCallback(
    (staffId: string, referenceDate?: Date) => {
      const pattern =
        (referenceDate ? getActiveRecurringPatternForDate(staffId, referenceDate) : null) ??
        recurringPatternsByStaffId[staffId]?.find((item) => item.isActive) ??
        null
      if (!pattern) {
        return {
          patternId: "",
          patternName: "",
          validFrom: "",
          validTo: "",
          cycleLength: 1,
          weeks: createEmptyRecurringWeeks(1),
        }
      }
      const weeks: RecurringDraftWeek[] = Array.from(
        { length: pattern.cycleLengthWeeks },
        (_, index) => {
          const weekIndex = index + 1
          const existingWeek = pattern.weeks.find((week) => week.weekIndex === weekIndex)
          return {
            weekIndex,
            days: WEEKDAY_ORDER.map((day) => {
              const existingDay = existingWeek?.days.find((item) => item.day === day)
              if (!existingDay) {
                return createEmptyFlexibleDraftDay(day)
              }
              return {
                day,
                isOff: existingDay.isOff,
                slots: existingDay.slots.map((slot) => ({
                  startTime: slot.startTime,
                  endTime: slot.endTime,
                  breaks: slot.breaks.map((slotBreak) => ({
                    startTime: slotBreak.startTime,
                    endTime: slotBreak.endTime,
                  })),
                })),
              }
            }),
          }
        }
      )
      return {
        patternId: pattern.id,
        patternName: pattern.name ?? "",
        validFrom: pattern.validFrom,
        validTo: pattern.validTo ?? "",
        cycleLength: pattern.cycleLengthWeeks,
        weeks,
      }
    },
    [createEmptyRecurringWeeks, getActiveRecurringPatternForDate, recurringPatternsByStaffId]
  )

  const getFlexibleDraftForEffectiveWeek = React.useCallback(
    (staffId: string, weekStartDate: string): FlexibleDraftDay[] => {
      const weeklyDraft = getFlexibleDraftForWeek(staffId, weekStartDate)
      if (hasAnyConfiguredFlexibleDay(weeklyDraft)) {
        return weeklyDraft
      }

      const referenceDate = new Date(`${weekStartDate}T00:00:00.000Z`)
      const recurringDraft = getRecurringDraftFromPattern(staffId, referenceDate)
      if (!recurringDraft.patternId || !recurringDraft.validFrom || !recurringDraft.weeks.length) {
        return weeklyDraft
      }

      const weekStartMs = referenceDate.getTime()
      const validFromMs = new Date(`${recurringDraft.validFrom}T00:00:00.000Z`).getTime()
      const validToMs = recurringDraft.validTo
        ? new Date(`${recurringDraft.validTo}T23:59:59.999Z`).getTime()
        : Number.POSITIVE_INFINITY
      if (weekStartMs < validFromMs || weekStartMs > validToMs) {
        return weeklyDraft
      }

      const weekOffset = Math.floor(Math.max(0, weekStartMs - validFromMs) / 86400000 / 7)
      const cycleLength = Math.max(1, recurringDraft.cycleLength)
      const weekIndex = (weekOffset % cycleLength) + 1
      const recurringWeek = recurringDraft.weeks.find((week) => week.weekIndex === weekIndex)
      if (!recurringWeek) {
        return weeklyDraft
      }

      return cloneFlexibleDraftDays(recurringWeek.days)
    },
    [getFlexibleDraftForWeek, getRecurringDraftFromPattern]
  )

  const currentEditableDays = React.useMemo(() => {
    if (flexibleEditorMode === "WEEK_OVERRIDE") {
      return flexibleDraftDays
    }
    return (
      recurringDraftWeeks.find((week) => week.weekIndex === recurringSelectedWeekIndex)?.days ??
      WEEKDAY_ORDER.map((day) => createEmptyFlexibleDraftDay(day))
    )
  }, [
    flexibleDraftDays,
    flexibleEditorMode,
    recurringDraftWeeks,
    recurringSelectedWeekIndex,
  ])

  const hasWeeklyOverrideInContext = React.useMemo(() => {
    if (!overrideStaffId || !overrideStartDate) return false
    return Boolean(flexibleWeekPlanMap[overrideStaffId]?.[overrideStartDate])
  }, [flexibleWeekPlanMap, overrideStaffId, overrideStartDate])

  const isOverrideStaffFlexible = React.useMemo(
    () => (overrideStaffId ? (staffSchedulingModeMap[overrideStaffId] ?? "STANDARD") === "FLEXIBLE" : false),
    [overrideStaffId, staffSchedulingModeMap]
  )

  React.useEffect(() => {
    if (useFlexibleSlot && overrideStaffId && !isOverrideStaffFlexible) {
      setUseFlexibleSlot(false)
    }
  }, [isOverrideStaffFlexible, overrideStaffId, useFlexibleSlot])

  const openOverrideEditor = React.useCallback(
    (staffId: string, dateValue: Date) => {
      if (!canEditRoster && !canCreatePlan && !canEditPlan) return
      if (isPastDate(dateValue)) {
        toast.error("Past dates cannot be edited.")
        return
      }
      const dateKey = toISODate(dateValue)
      const weekStartDate = getWeekStartMondayKey(dateValue)
      const weekEndDate = new Date(`${weekStartDate}T00:00:00.000Z`)
      weekEndDate.setDate(weekEndDate.getDate() + 6)
      const weekEndDateKey = toISODate(weekEndDate)
      const schedulingMode = staffSchedulingModeMap[staffId] ?? "STANDARD"
      setOverrideStaffId(staffId)
      setOverrideStartDate(schedulingMode === "FLEXIBLE" ? weekStartDate : dateKey)
      setOverrideEndDate(schedulingMode === "FLEXIBLE" ? weekEndDateKey : dateKey)
      setOverrideTemplateId("")
      setOverrideSkipWeekOff(false)
      setOverrideUnavailable(false)
      setUseFlexibleSlot(schedulingMode === "FLEXIBLE")
      setFlexibleEditorMode("WEEK_OVERRIDE")
      setFlexibleDraftDays(getFlexibleDraftForEffectiveWeek(staffId, weekStartDate))
      const recurringDraft = getRecurringDraftFromPattern(staffId, dateValue)
      setRecurringPatternId(recurringDraft.patternId)
      setRecurringPatternName(recurringDraft.patternName)
      setRecurringValidFrom(recurringDraft.validFrom || weekStartDate)
      setRecurringValidTo(recurringDraft.validTo)
      setRecurringCycleLength(recurringDraft.cycleLength)
      setRecurringSelectedWeekIndex(1)
      setRecurringDraftWeeks(recurringDraft.weeks)
      setRecurringImpactMode("UPDATE")
      setRecurringImpactPreview(null)
      setOverrideOpen(true)
    },
    [
      canEditRoster, canCreatePlan, canEditPlan,
      getFlexibleDraftForEffectiveWeek,
      getRecurringDraftFromPattern,
      isPastDate,
      staffSchedulingModeMap,
    ]
  )

  const quickInfoContent = React.useCallback((props: Record<string, unknown>) => {
    const data = props as AvailabilityEvent
    if (!data?.Subject) return null
    return (
      <div className="space-y-2 text-sm">
        <div className="font-medium">{data.Subject}</div>
        {data.templateStart && data.templateEnd ? (
          <div>
            Shift: {formatTimeFrom24h(data.templateStart, settings)} -{" "}
            {formatTimeFrom24h(data.templateEnd, settings)}
          </div>
        ) : null}
        {data.templateBreaks?.length ? (
          <div>
            Breaks: {data.templateBreaks.join(", ")}
          </div>
        ) : null}
        {data.isUnavailable ? (
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Unavailable
          </div>
        ) : null}
        {data.isLeave ? (
          <div className="space-y-1 text-xs text-muted-foreground">
            <div>Approved leave</div>
            {data.leaveReason ? <div>Reason: {data.leaveReason}</div> : null}
          </div>
        ) : null}
        {data.staffId && !data.isLeave && (canEditRoster || canCreatePlan || canEditPlan) ? (
          <Button
            type="button"
            variant="secondary"
            className="mt-2 h-8 w-full px-3 text-xs"
            onClick={() => openOverrideEditor(data.staffId, data.StartTime)}
          >
            Change shift
          </Button>
        ) : null}
      </div>
    )
  }, [openOverrideEditor, settings, canEditRoster, canCreatePlan, canEditPlan])

  const staffResources = React.useMemo(
    () =>
      filteredStaff.map((member, index) => ({
        id: member.id,
        name: member.name?.trim() || member.email,
        color: RESOURCE_COLORS[index % RESOURCE_COLORS.length],
      })),
    [filteredStaff]
  )

  const debugSummary = React.useMemo(() => {
    if (!debugEnabled) {
      return null
    }
    const formatShort = (value: Date) =>
      formatDateForDisplay(value, settings.dateFormat)
    const byStaff = filteredStaff.map((member) => ({
      staff: member.name?.trim() || member.email,
        dates: availabilityDates.map((day) => ({
          date: formatShort(day),
          periods: getStaffPeriodsForDate(day, member.id).map(
            (period) =>
              `${formatTimeFrom24h(period.startTime, settings)}-${formatTimeFrom24h(
                period.endTime,
                settings
              )}`
          ),
        })),
      }))
    return {
      selectedDate: formatShort(date),
      viewDates: availabilityDates.map((day) => formatShort(day)),
      eventsCount: calendarEvents.length,
      staffCount: filteredStaff.length,
      staff: byStaff,
    }
  }, [
    availabilityDates,
    calendarEvents.length,
    date,
    debugEnabled,
    filteredStaff,
    getStaffPeriodsForDate,
    settings,
  ])

  const syncViewDates = React.useCallback(() => {
    const dates = scheduleRef.current?.getCurrentViewDates?.() ?? []
    const normalizedDates = dates.map(
      (value) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
    )
    if (normalizedDates.length) {
      setViewDates(normalizedDates)
    }
    const selected = scheduleRef.current?.selectedDate
    if (selected instanceof Date && !Number.isNaN(selected.getTime())) {
      setDate(new Date(selected))
    }
  }, [])

  const handleNavigate = React.useCallback((args: { currentDate?: Date | null }) => {
    if (args?.currentDate instanceof Date && !Number.isNaN(args.currentDate.getTime())) {
      setDate(new Date(args.currentDate))
    }
  }, [])

  const handleEventRendered = React.useCallback(
    (args: { data?: Record<string, unknown>; element?: HTMLElement }) => {
      const color = args.data?.CategoryColor as string | undefined
      if (color && args.element) {
        args.element.style.backgroundColor = color
        args.element.style.borderColor = color
        args.element.style.color = "#ffffff"
      }
    },
    []
  )

  const handleActionComplete = React.useCallback(
    (args: { requestType?: string }) => {
      if (
        args?.requestType === "dateNavigate" ||
        args?.requestType === "viewNavigate" ||
        args?.requestType === "viewRender"
      ) {
        syncViewDates()
      }
    },
    [syncViewDates]
  )

  const resolveStaffIdForGroup = React.useCallback((groupIndex?: number) => {
    if (groupIndex === undefined || groupIndex === null) {
      if (staffFilter !== "all") return staffFilter
      return undefined
    }
    const resource = scheduleRef.current?.getResourcesByIndex?.(groupIndex)
    return resource?.resourceData?.id as string | undefined
  }, [staffFilter])

  const handleCellClick = React.useCallback(
    (args: { startTime?: Date; groupIndex?: number; element?: HTMLElement | HTMLElement[] }) => {
      if (!(args?.startTime instanceof Date)) return
      let groupIndex = args.groupIndex
      const element = Array.isArray(args.element) ? args.element[0] : args.element
      if (groupIndex === undefined && element) {
        const raw = element.getAttribute("data-group-index")
        if (raw) {
          const parsed = Number(raw)
          groupIndex = Number.isNaN(parsed) ? groupIndex : parsed
        }
      }
      const staffId = resolveStaffIdForGroup(groupIndex)
      if (!staffId) return
      openOverrideEditor(staffId, args.startTime)
    },
    [openOverrideEditor, resolveStaffIdForGroup]
  )

  const handleCellDoubleClick = React.useCallback(
    (args: { startTime?: Date; groupIndex?: number }) => {
      if (!(args?.startTime instanceof Date)) return
      const staffId = resolveStaffIdForGroup(args.groupIndex)
      if (!staffId) return
      openOverrideEditor(staffId, args.startTime)
    },
    [openOverrideEditor, resolveStaffIdForGroup]
  )

  const handleEventClick = React.useCallback(
    (args: { event?: Record<string, unknown>; data?: Record<string, unknown> }) => {
      const eventData = (args?.event ?? args?.data) as AvailabilityEvent | undefined
      if (eventData?.isLeave) return
      if (!eventData?.StartTime || !eventData.staffId) return
      openOverrideEditor(eventData.staffId, eventData.StartTime)
    },
    [openOverrideEditor]
  )

  const handlePopupOpen = React.useCallback(
    (args: {
      type?: string
      data?: Record<string, unknown>
      target?: HTMLElement
      cancel?: boolean
    }) => {
      if (args.type !== "QuickInfo") return
      const data = args.data as Record<string, unknown> | undefined
      if ((data?.isLeave as boolean | undefined) === true) {
        return
      }
      const startTime =
        (data?.StartTime as Date | undefined) ||
        (data?.startTime as Date | undefined)
      const staffId =
        (data?.staffId as string | undefined) ||
        resolveStaffIdForGroup(data?.groupIndex as number | undefined)
      if (!startTime || !staffId) {
        const target = args.target
        const rawIndex = target?.getAttribute?.("data-group-index")
        const parsed = rawIndex ? Number(rawIndex) : undefined
        const fallbackStaffId = resolveStaffIdForGroup(
          Number.isNaN(parsed ?? NaN) ? undefined : parsed
        )
        if (startTime && fallbackStaffId) {
          openOverrideEditor(fallbackStaffId, startTime)
          args.cancel = true
        }
        return
      }
      openOverrideEditor(staffId, startTime)
      args.cancel = true
    },
    [openOverrideEditor, resolveStaffIdForGroup]
  )

  React.useEffect(() => {
    const host = scheduleRef.current?.element
    if (!host) return

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest(".e-more-indicator")) return
      if (target.closest(".e-more-popup-wrapper")) return
      if (target.closest(".e-quick-popup-wrapper")) return
      if (target.closest(".e-appointment")) return
      const cell = target.closest(".e-work-cells") as HTMLElement | null
      if (!cell) return
      const details = scheduleRef.current?.getCellDetails?.(cell)
      if (!details?.startTime) return
      const staffId = resolveStaffIdForGroup(details.groupIndex)
      if (!staffId) return
      openOverrideEditor(staffId, details.startTime)
    }

    host.addEventListener("click", handleClick)
    return () => {
      host.removeEventListener("click", handleClick)
    }
  }, [openOverrideEditor, resolveStaffIdForGroup, viewDates.length])

  const submitOverride = React.useCallback(async (saveAsNewPattern = false) => {
    if (!overrideStaffId) {
      toast.error("Select a staff member.")
      return
    }
    if (!useFlexibleSlot && !overrideUnavailable && !overrideTemplateId) {
      toast.error("Select a shift template.")
      return
    }
    if (!overrideStartDate || !overrideEndDate) {
      toast.error("Select a date range.")
      return
    }
    if (overrideStartDate > overrideEndDate) {
      toast.error("Start date must be before end date.")
      return
    }
    try {
      if (useFlexibleSlot) {
        if (flexibleEditorMode === "RECURRING_PATTERN") {
          if (!recurringValidFrom) {
            toast.error("Pattern start date is required.")
            return
          }
          if (recurringValidTo && recurringValidFrom > recurringValidTo) {
            toast.error("Pattern start date must be on or before end date.")
            return
          }
        }
        if (flexibleEditorMode === "WEEK_OVERRIDE") {
          const response = await fetch("/api/shifts/flexible-week-plans", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              staffId: overrideStaffId,
              weekStartDate: overrideStartDate,
              days: flexibleDraftDays.map((day, dayIndex) => ({
                day: day.day,
                isOff: day.isOff,
                sortOrder: dayIndex,
                slots: day.slots.map((slot, slotIndex) => ({
                  startTime: slot.startTime,
                  endTime: slot.endTime,
                  sortOrder: slotIndex,
                  breaks: slot.breaks.map((slotBreak, breakIndex) => ({
                    startTime: slotBreak.startTime,
                    endTime: slotBreak.endTime,
                    sortOrder: breakIndex,
                  })),
                })),
              })),
            }),
          })
          if (!response.ok) {
            const error = await response.json().catch(() => ({}))
            throw new Error(error.error || "Failed to save flexible weekly plan.")
          }
          toast.success("Flexible weekly override saved.")
        } else {
          const response = await fetch("/api/shifts/flexible-patterns", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              patternId: saveAsNewPattern ? undefined : recurringPatternId || undefined,
              staffId: overrideStaffId,
              name: recurringPatternName,
              cycleLengthWeeks: recurringCycleLength,
              validFrom: recurringValidFrom,
              validTo: recurringValidTo || "",
              isActive: true,
              weeks: recurringDraftWeeks.map((week) => ({
                weekIndex: week.weekIndex,
                days: week.days.map((day, dayIndex) => ({
                  day: day.day,
                  isOff: day.isOff,
                  sortOrder: dayIndex,
                  slots: day.slots.map((slot, slotIndex) => ({
                    startTime: slot.startTime,
                    endTime: slot.endTime,
                    sortOrder: slotIndex,
                    breaks: slot.breaks.map((slotBreak, breakIndex) => ({
                      startTime: slotBreak.startTime,
                      endTime: slotBreak.endTime,
                      sortOrder: breakIndex,
                    })),
                  })),
                })),
              })),
            }),
          })
          if (!response.ok) {
            const error = await response.json().catch(() => ({}))
            throw new Error(error.error || "Failed to save recurring flexible pattern.")
          }
          const data = (await response.json()) as { item?: { id?: string } }
          setRecurringPatternId(data.item?.id ?? "")
          toast.success(
            saveAsNewPattern
              ? "Recurring flexible pattern saved as new."
              : "Recurring flexible pattern updated."
          )
        }
        setRecurringImpactPreview(null)
        setOverrideOpen(false)
        await loadFlexiblePatterns()
        await loadFlexibleWeekPlans()
        await loadFlexibleSlots()
        await loadOverrides()
        return
      }

      const response = await fetch("/api/shifts/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: overrideStaffId,
          templateId: overrideUnavailable ? "" : overrideTemplateId,
          isUnavailable: overrideUnavailable,
          startDate: overrideStartDate,
          endDate: overrideEndDate,
          skipWeekOff: overrideSkipWeekOff,
          skipHolidays: overrideSkipWeekOff,
        }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        if (response.status === 409 && Array.isArray(error.conflicts)) {
          setConflicts(error.conflicts)
          setConflictsOpen(true)
          throw new Error("Shift change conflicts with existing appointments.")
        }
        throw new Error(error.error || "Failed to save override.")
      }
      const result = (await response.json()) as { createdCount?: number }
      if (!result.createdCount) {
        toast.error("No dates updated. Check skip holidays/week off.")
        return
      }
      toast.success("Shift override saved.")
      setOverrideOpen(false)
      await loadFlexibleSlots()
      await loadOverrides()
    } catch (error) {
      console.error(error)
      toast.error(
        error instanceof Error ? error.message : "Unable to save override."
      )
    }
  }, [
    loadFlexibleSlots,
    loadFlexiblePatterns,
    loadFlexibleWeekPlans,
    loadOverrides,
    flexibleDraftDays,
    flexibleEditorMode,
    overrideEndDate,
    overrideSkipWeekOff,
    overrideStaffId,
    overrideStartDate,
    overrideTemplateId,
    overrideUnavailable,
    recurringCycleLength,
    recurringDraftWeeks,
    recurringPatternId,
    recurringPatternName,
    recurringValidFrom,
    recurringValidTo,
    useFlexibleSlot,
  ])

  const previewRecurringImpact = React.useCallback(async () => {
    if (!recurringPatternId) {
      toast.error("Impact preview is available after a recurring pattern exists.")
      return
    }
    if (!recurringValidFrom) {
      toast.error("Pattern start date is required.")
      return
    }
    if (recurringValidTo && recurringValidFrom > recurringValidTo) {
      toast.error("Pattern start date must be on or before end date.")
      return
    }

    setRecurringImpactLoading(true)
    try {
      const response = await fetch("/api/shifts/flexible-patterns/impact-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: recurringImpactMode,
          patternId: recurringPatternId,
          validFrom: recurringValidFrom,
          validTo: recurringValidTo || "",
          activate: true,
          cycleLengthWeeks: recurringCycleLength,
          weeks: recurringDraftWeeks.map((week) => ({
            weekIndex: week.weekIndex,
            days: week.days.map((day) => ({
              day: day.day,
              isOff: day.isOff,
              slots: day.slots.map((slot) => ({
                startTime: slot.startTime,
                endTime: slot.endTime,
                breaks: slot.breaks.map((slotBreak) => ({
                  startTime: slotBreak.startTime,
                  endTime: slotBreak.endTime,
                })),
              })),
            })),
          })),
        }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || "Failed to preview recurring impact.")
      }
      const payload = (await response.json()) as { preview?: RecurringImpactPreview }
      setRecurringImpactPreview(payload.preview ?? null)
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Unable to preview recurring impact.")
    } finally {
      setRecurringImpactLoading(false)
    }
  }, [
    recurringCycleLength,
    recurringDraftWeeks,
    recurringImpactMode,
    recurringPatternId,
    recurringValidFrom,
    recurringValidTo,
  ])

  React.useEffect(() => {
    if (!recurringImpactPreview) return
    setRecurringImpactPreview(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    recurringPatternName,
    recurringValidFrom,
    recurringValidTo,
    recurringCycleLength,
    recurringDraftWeeks,
    recurringImpactMode,
  ])

  const clearOverride = React.useCallback(async () => {
    if (!overrideStaffId || !overrideStartDate || !overrideEndDate) {
      toast.error("Select a staff member and date range.")
      return
    }
    if (overrideStartDate > overrideEndDate) {
      toast.error("Start date must be before end date.")
      return
    }
    try {
      if (useFlexibleSlot) {
        if (flexibleEditorMode === "WEEK_OVERRIDE") {
          if (!hasWeeklyOverrideInContext) {
            toast.error("No weekly override exists for this staff and week.")
            return
          }
          const response = await fetch("/api/shifts/flexible-week-plans", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              staffId: overrideStaffId,
              weekStartDate: overrideStartDate,
            }),
          })
          if (!response.ok) {
            const error = await response.json().catch(() => ({}))
            throw new Error(error.error || "Failed to clear flexible weekly plan.")
          }
          const result = (await response.json()) as { deletedCount?: number }
          if (!result.deletedCount) {
            toast.error("No weekly override found to clear.")
            return
          }
          toast.success("Flexible weekly override cleared.")
        } else {
          if (!recurringPatternId) {
            toast.error("No active recurring pattern to clear.")
            return
          }
          const response = await fetch("/api/shifts/flexible-patterns", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              patternId: recurringPatternId,
            }),
          })
          if (!response.ok) {
            const error = await response.json().catch(() => ({}))
            throw new Error(error.error || "Failed to deactivate recurring flexible pattern.")
          }
          setRecurringPatternId("")
          toast.success("Recurring flexible pattern deactivated.")
        }
        setOverrideOpen(false)
        await loadFlexiblePatterns()
        await loadFlexibleWeekPlans()
        await loadFlexibleSlots()
        await loadOverrides()
        return
      }

      const response = await fetch("/api/shifts/overrides", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: overrideStaffId,
          startDate: overrideStartDate,
          endDate: overrideEndDate,
        }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || "Failed to clear overrides.")
      }
      const result = (await response.json()) as { deletedCount?: number }
      if (!result.deletedCount) {
        toast.error("No overrides found for that range.")
        return
      }
      toast.success("Overrides cleared.")
      setOverrideOpen(false)
      await loadFlexibleSlots()
      await loadOverrides()
    } catch (error) {
      console.error(error)
      toast.error(
        error instanceof Error ? error.message : "Unable to clear overrides."
      )
    }
  }, [
    loadFlexibleSlots,
    loadFlexiblePatterns,
    loadFlexibleWeekPlans,
    loadOverrides,
    flexibleEditorMode,
    overrideEndDate,
    overrideStaffId,
    overrideStartDate,
    hasWeeklyOverrideInContext,
    recurringPatternId,
    useFlexibleSlot,
  ])

  const applyDraftDayUpdate = React.useCallback(
    (updater: (days: FlexibleDraftDay[]) => FlexibleDraftDay[]) => {
      if (flexibleEditorMode === "WEEK_OVERRIDE") {
        setFlexibleDraftDays((prev) => updater(prev))
        return
      }
      setRecurringDraftWeeks((prev) =>
        prev.map((week) =>
          week.weekIndex === recurringSelectedWeekIndex
            ? { ...week, days: updater(week.days) }
            : week
        )
      )
    },
    [flexibleEditorMode, recurringSelectedWeekIndex]
  )

  const setFlexibleDayOff = React.useCallback(
    (day: Weekday, isOff: boolean) => {
      applyDraftDayUpdate((days) =>
        days.map((item) =>
          item.day === day
            ? {
                ...item,
                isOff,
                slots: isOff ? [] : item.slots.length ? item.slots : [{ startTime: "10:00", endTime: "14:00", breaks: [] }],
              }
            : item
        )
      )
    },
    [applyDraftDayUpdate]
  )

  const addFlexibleDaySlot = React.useCallback(
    (day: Weekday) => {
      applyDraftDayUpdate((days) =>
        days.map((item) =>
          item.day === day
            ? {
                ...item,
                isOff: false,
                slots: [...item.slots, { startTime: "10:00", endTime: "14:00", breaks: [] }],
              }
            : item
        )
      )
    },
    [applyDraftDayUpdate]
  )

  const removeFlexibleDaySlot = React.useCallback(
    (day: Weekday, slotIndex: number) => {
      applyDraftDayUpdate((days) =>
        days.map((item) =>
          item.day === day
            ? { ...item, slots: item.slots.filter((_, index) => index !== slotIndex) }
            : item
        )
      )
    },
    [applyDraftDayUpdate]
  )

  const updateFlexibleDaySlot = React.useCallback(
    (day: Weekday, slotIndex: number, patch: Partial<FlexibleDraftSlot>) => {
      applyDraftDayUpdate((days) =>
        days.map((item) =>
          item.day === day
            ? {
                ...item,
                slots: item.slots.map((slot, index) => (index === slotIndex ? { ...slot, ...patch } : slot)),
              }
            : item
        )
      )
    },
    [applyDraftDayUpdate]
  )

  const addFlexibleSlotBreak = React.useCallback(
    (day: Weekday, slotIndex: number) => {
      applyDraftDayUpdate((days) =>
        days.map((item) =>
          item.day === day
            ? {
                ...item,
                slots: item.slots.map((slot, index) =>
                  index === slotIndex
                    ? {
                        ...slot,
                        breaks: [...slot.breaks, { startTime: "12:00", endTime: "13:00" }],
                      }
                    : slot
                ),
              }
            : item
        )
      )
    },
    [applyDraftDayUpdate]
  )

  const removeFlexibleSlotBreak = React.useCallback(
    (day: Weekday, slotIndex: number, breakIndex: number) => {
      applyDraftDayUpdate((days) =>
        days.map((item) =>
          item.day === day
            ? {
                ...item,
                slots: item.slots.map((slot, index) =>
                  index === slotIndex
                    ? { ...slot, breaks: slot.breaks.filter((_, i) => i !== breakIndex) }
                    : slot
                ),
              }
            : item
        )
      )
    },
    [applyDraftDayUpdate]
  )

  const updateFlexibleSlotBreak = React.useCallback(
    (
      day: Weekday,
      slotIndex: number,
      breakIndex: number,
      patch: Partial<FlexibleDraftBreak>
    ) => {
      applyDraftDayUpdate((days) =>
        days.map((item) =>
          item.day === day
            ? {
                ...item,
                slots: item.slots.map((slot, index) =>
                  index === slotIndex
                    ? {
                        ...slot,
                        breaks: slot.breaks.map((slotBreak, i) =>
                          i === breakIndex ? { ...slotBreak, ...patch } : slotBreak
                        ),
                      }
                    : slot
                ),
              }
            : item
        )
      )
    },
    [applyDraftDayUpdate]
  )

  const resolveConflicts = React.useCallback(async () => {
    if (!conflicts.length) {
      setConflictsOpen(false)
      return
    }
    if (conflictAction === "reassign" && !conflictStaffId) {
      toast.error("Select a staff member.")
      return
    }
    if (
      conflictAction === "reschedule" &&
      (!conflictRescheduleDate || !conflictRescheduleTime)
    ) {
      toast.error("Select a new date and time.")
      return
    }
    try {
      const response = await fetch("/api/appointments/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointmentIds: conflicts.map((item) => item.id),
          action: conflictAction,
          targetStaffId: conflictAction === "reassign" ? conflictStaffId : undefined,
          rescheduleDate: conflictAction === "reschedule" ? conflictRescheduleDate : undefined,
          rescheduleTime: conflictAction === "reschedule" ? conflictRescheduleTime : undefined,
        }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || "Unable to resolve conflicts.")
      }
      toast.success("Appointments updated.")
      setConflictsOpen(false)
      setConflicts([])
      await loadOverrides()
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Unable to resolve conflicts.")
    }
  }, [
    conflicts,
    conflictAction,
    conflictRescheduleDate,
    conflictRescheduleTime,
    conflictStaffId,
    loadOverrides,
  ])


  return (
    <div className={pageClass}>
      {(!readTemplates || !readSchedules || !readPlans || !readLeaves) && <p role="status" className="text-sm text-muted-foreground">This roster shows only the schedules, plans and leaves your role can access. Hidden records still apply to booking availability.</p>}
      <PageHeader title={<> Roster </>} description={<> View staff schedules in a monthly roster. </>} />

      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Staff filter</label>
          <div className="w-full min-w-[220px] md:w-[280px]">
            <SearchableSelect
            value={staffFilter}
            placeholder="All staff"
            searchPlaceholder="Search staff..."
            options={[
              { value: "all", label: "All staff" },
              ...staff.map((member) => ({
                value: member.id,
                label: member.name?.trim() || member.email,
              })),
            ]}
            onChange={(nextValue) => setStaffFilter(nextValue)}
          />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {rosterMode === "grid" ? (
            <>
              <Button
                variant="outline"
                onClick={() =>
                  setDate((prev) => {
                    const next = new Date(prev)
                    next.setDate(next.getDate() - 7)
                    return next
                  })
                }
              >
                Previous week
              </Button>
              <Button variant="outline" onClick={() => setDate(new Date())}>
                Today
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  setDate((prev) => {
                    const next = new Date(prev)
                    next.setDate(next.getDate() + 7)
                    return next
                  })
                }
              >
                Next week
              </Button>
            </>
          ) : null}
          <Button
            variant={rosterMode === "grid" ? "default" : "outline"}
            onClick={() => setRosterMode("grid")}
          >
            Grid
          </Button>
          <Button
            disabled={!calendarViewsEnabled}
            title={calendarViewsEnabled ? undefined : "Calendar view is temporarily unavailable"}
            variant={rosterMode === "calendar" ? "default" : "outline"}
            onClick={() => setRosterMode("calendar")}
          >
            Calendar
          </Button>
        </div>
      </div>

      {rosterMode === "grid" ? (
        <div className="rounded-xl border bg-card p-3 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="font-medium">
              Week: {formatDateForDisplay(availabilityDates[0], settings.dateFormat)} -{" "}
              {formatDateForDisplay(availabilityDates[availabilityDates.length - 1], settings.dateFormat)}
            </div>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-sky-600" />
                Shift
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
                Leave
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-red-300" />
                Unavailable
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="w-44 border p-2 text-left font-medium">Staff</th>
                  {availabilityDates.map((day) => (
                    <th key={toISODate(day)} className="min-w-36 border p-2 text-left font-medium">
                      <div>{day.toLocaleDateString(undefined, { weekday: "short" })}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateForDisplay(day, settings.dateFormat)}
                      </div>
                    </th>
                  ))}
                  <th className="w-28 border p-2 text-left font-medium">Week total</th>
                </tr>
              </thead>
              <tbody>
                {filteredStaff.map((member) => (
                  <tr key={member.id}>
                    <td className="border p-2 align-top">
                      <div className="font-medium">{member.name?.trim() || member.email}</div>
                    </td>
                    {availabilityDates.map((day) => {
                      const dateKey = toISODate(day)
                      const history = getHistoryDay(day, member.id)
                      const leave = leaveMap[member.id]?.[dateKey]
                      const overrideValue = overrideMap[member.id]?.[dateKey]
                      const template = getStaffTemplateForDate(day, member.id)
                      const periods = getStaffPeriodsForDate(day, member.id)

                      if (history) {
                        if (history.source === "LEAVE") {
                          return (
                            <td key={`${member.id}-${dateKey}`} className="border p-2 align-top">
                              <div className="rounded bg-amber-500 px-2 py-1 text-xs font-medium text-white">
                                {history.leaveDefinitionCode ?? "LEAVE"} -{" "}
                                {history.leaveDefinitionName ?? "Leave"}
                              </div>
                              {history.leaveReason ? (
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {history.leaveReason}
                                </div>
                              ) : null}
                            </td>
                          )
                        }
                        if (history.source === "UNAVAILABLE") {
                          return (
                            <td key={`${member.id}-${dateKey}`} className="border bg-red-50 p-2 align-top text-xs text-red-700">
                              Unavailable
                            </td>
                          )
                        }
                      }

                      if (leave) {
                        return (
                          <td key={`${member.id}-${dateKey}`} className="border p-2 align-top">
                            <div className="rounded bg-amber-500 px-2 py-1 text-xs font-medium text-white">
                              {leave.leaveDefinitionCode} - {leave.leaveDefinitionName}
                            </div>
                            {leave.reason ? (
                              <div className="mt-1 text-xs text-muted-foreground">{leave.reason}</div>
                            ) : null}
                          </td>
                        )
                      }

                      if (overrideValue === null) {
                        return (
                          <td
                            key={`${member.id}-${dateKey}`}
                            className="cursor-pointer border bg-red-50 p-2 align-top text-xs text-red-700"
                            onClick={() => openOverrideEditor(member.id, day)}
                          >
                            Unavailable
                          </td>
                        )
                      }

                      if (!periods.length) {
                        return (
                          <td
                            key={`${member.id}-${dateKey}`}
                            className="cursor-pointer border bg-muted/30 p-2 align-top text-xs text-muted-foreground"
                            onClick={() => openOverrideEditor(member.id, day)}
                          >
                            Off
                          </td>
                        )
                      }

                      return (
                        <td
                          key={`${member.id}-${dateKey}`}
                          className="cursor-pointer border p-2 align-top"
                          onClick={() => openOverrideEditor(member.id, day)}
                        >
                          <div className="rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white">
                            {template?.name ?? "Flexible shift"}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {periods
                              .map(
                                (period) =>
                                  `${formatTimeFrom24h(period.startTime, settings)} - ${formatTimeFrom24h(period.endTime, settings)}`
                              )
                              .join(", ")}
                          </div>
                        </td>
                      )
                    })}
                    <td className="border p-2 align-top font-medium">
                      {formatHours(staffWeeklyHours[member.id] ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="border bg-muted/30 p-2 font-medium">Daily total</td>
                  {dailyHoursTotals.map((value, index) => (
                    <td key={`daily-hours-${index}`} className="border bg-muted/30 p-2 font-medium">
                      {formatHours(value)}
                    </td>
                  ))}
                  <td className="border bg-muted/30 p-2 font-medium">
                    {formatHours(
                      Object.values(staffWeeklyHours).reduce((sum, value) => sum + value, 0)
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="border bg-muted/10 p-2 text-xs text-muted-foreground">
                    Leaves count
                  </td>
                  {dailyLeaveTotals.map((value, index) => (
                    <td
                      key={`daily-leaves-${index}`}
                      className="border bg-muted/10 p-2 text-xs text-muted-foreground"
                    >
                      {value}
                    </td>
                  ))}
                  <td className="border bg-muted/10 p-2 text-xs text-muted-foreground">
                    {dailyLeaveTotals.reduce((sum, value) => sum + value, 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border bg-card p-3 shadow-sm">
          <div className="min-h-[540px]">
            <Calendar
            scheduleRef={scheduleRef}
            currentView="Week"
            firstDayOfWeek={firstDayOfWeek}
            showQuickInfo
            eventSettings={{
              dataSource: calendarEvents,
              fields: {
                id: "Id",
                subject: { name: "Subject" },
                startTime: { name: "StartTime" },
                endTime: { name: "EndTime" },
                isAllDay: { name: "IsAllDay" },
                categoryColor: { name: "CategoryColor" },
              },
            }}
            group={{ resources: ["Staff"] }}
            showWeekend
            readonly
            allowDragAndDrop={false}
            allowResizing={false}
            navigating={handleNavigate}
            actionComplete={handleActionComplete}
            created={syncViewDates}
            cellClick={handleCellClick}
            cellDoubleClick={handleCellDoubleClick}
            eventClick={handleEventClick}
            eventRendered={handleEventRendered}
            popupOpen={handlePopupOpen}
            quickInfoTemplates={{
              templateType: "Event",
              content: quickInfoContent,
            }}
            height="auto"
            views={["Week", "Month"]}
            resources={[{ field: "staffId", title: "Staff", name: "Staff", dataSource: staffResources, textField: "name", idField: "id", colorField: "color" }]}
          />
        </div>
      </div>
      )}
      <Dialog
        open={overrideOpen}
        onOpenChange={(open) => {
          setOverrideOpen(open)
          if (!open) {
            setRecurringImpactPreview(null)
          }
        }}
      >
        <ActionDialogContent title={<>{useFlexibleSlot ? "Edit flexible availability" : "Change shift"}</>} description={<>{useFlexibleSlot
                ? "Configure weekly overrides or recurring custom patterns for flexible staff."
                : "Apply a shift template to a date range for this staff member."}</>} className="sm:max-w-3xl" actions={<> <Button variant="outline" onClick={() => setOverrideOpen(false)}>
              Cancel
            </Button><Button
              variant="outline"
              onClick={clearOverride}
              disabled={
                !(useFlexibleSlot && flexibleEditorMode === "RECURRING_PATTERN" ? canArchivePlan : canArchiveRoster) ||
                useFlexibleSlot &&
                flexibleEditorMode === "WEEK_OVERRIDE" &&
                !hasWeeklyOverrideInContext
              }
            >
              {useFlexibleSlot
                ? flexibleEditorMode === "WEEK_OVERRIDE"
                  ? "Clear weekly override"
                  : "Deactivate recurring pattern"
                : "Clear override"}
            </Button>{useFlexibleSlot &&
            flexibleEditorMode === "RECURRING_PATTERN" &&
            Boolean(recurringPatternId) ? (
              <Button disabled={!canCreatePlan} variant="outline" onClick={() => setSaveAsNewConfirmOpen(true)}>
                Save as new pattern
              </Button>
            ) : null}<Button disabled={useFlexibleSlot && flexibleEditorMode === "RECURRING_PATTERN" ? !(recurringPatternId ? canEditPlan : canCreatePlan) : !canEditRoster} onClick={() => submitOverride(false)}>
              {useFlexibleSlot
                ? flexibleEditorMode === "WEEK_OVERRIDE"
                  ? "Save weekly override"
                  : recurringPatternId
                    ? "Update recurring pattern"
                    : "Save recurring pattern"
                : "Save override"}
            </Button> </>}><div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Staff</Label>
              <SearchableSelect
                value={overrideStaffId}
                placeholder="Select staff"
                searchPlaceholder="Search staff..."
                options={staff.map((member) => ({
                  value: member.id,
                  label: member.name?.trim() || member.email,
                }))}
                onChange={(nextValue) => {
                  setOverrideStaffId(nextValue)
                  if (!nextValue) return
                  const nextStaffFlexible =
                    (staffSchedulingModeMap[nextValue] ?? "STANDARD") === "FLEXIBLE"
                  if (!nextStaffFlexible) {
                    setUseFlexibleSlot(false)
                    return
                  }
                  if (!useFlexibleSlot) return
                  const weekStartDate = getWeekStartMondayKey(
                    new Date(`${overrideStartDate}T00:00:00.000Z`)
                  )
                  setFlexibleDraftDays(getFlexibleDraftForEffectiveWeek(nextValue, weekStartDate))
                  const recurringDraft = getRecurringDraftFromPattern(
                    nextValue,
                    new Date(`${weekStartDate}T00:00:00.000Z`)
                  )
                  setRecurringPatternId(recurringDraft.patternId)
                  setRecurringPatternName(recurringDraft.patternName)
                  setRecurringValidFrom(recurringDraft.validFrom || weekStartDate)
                  setRecurringValidTo(recurringDraft.validTo)
                  setRecurringCycleLength(recurringDraft.cycleLength)
                  setRecurringSelectedWeekIndex(1)
                  setRecurringDraftWeeks(recurringDraft.weeks)
                  setRecurringImpactMode("UPDATE")
                  setRecurringImpactPreview(null)
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Mode</Label>
              <Select aria-label="Mode"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={useFlexibleSlot ? "FLEXIBLE" : "TEMPLATE"}
                onValueChange={(value) => {
                  const nextFlexible = value === "FLEXIBLE"
                  if (nextFlexible && !isOverrideStaffFlexible) {
                    setUseFlexibleSlot(false)
                    return
                  }
                  setUseFlexibleSlot(nextFlexible)
                  if (nextFlexible) {
                    setOverrideUnavailable(false)
                    setOverrideTemplateId("")
                    setOverrideSkipWeekOff(false)
                    const weekStartDate = getWeekStartMondayKey(new Date(`${overrideStartDate}T00:00:00.000Z`))
                    const weekEndDate = new Date(`${weekStartDate}T00:00:00.000Z`)
                    weekEndDate.setDate(weekEndDate.getDate() + 6)
                    setOverrideStartDate(weekStartDate)
                    setOverrideEndDate(toISODate(weekEndDate))
                    setFlexibleEditorMode("WEEK_OVERRIDE")
                    if (overrideStaffId) {
                      setFlexibleDraftDays(
                        getFlexibleDraftForEffectiveWeek(overrideStaffId, weekStartDate)
                      )
                      const recurringDraft = getRecurringDraftFromPattern(
                        overrideStaffId,
                        new Date(`${weekStartDate}T00:00:00.000Z`)
                      )
                      setRecurringPatternId(recurringDraft.patternId)
                      setRecurringPatternName(recurringDraft.patternName)
                      setRecurringValidFrom(recurringDraft.validFrom || weekStartDate)
                      setRecurringValidTo(recurringDraft.validTo)
                      setRecurringCycleLength(recurringDraft.cycleLength)
                      setRecurringSelectedWeekIndex(1)
                      setRecurringDraftWeeks(recurringDraft.weeks)
                      setRecurringImpactMode("UPDATE")
                      setRecurringImpactPreview(null)
                    }
                  }
                }}
              >
                <option value="TEMPLATE">Template/Unavailable override</option>
                {isOverrideStaffFlexible ? (
                  <option value="FLEXIBLE">Flexible weekly plan</option>
                ) : null}
              </Select>
            </div>
            {!useFlexibleSlot ? (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Shift template</Label>
              <SearchableSelect
                value={overrideTemplateId}
                placeholder="Select template"
                searchPlaceholder="Search template..."
                options={templates.map((template) => ({
                  value: template.id,
                  label: `${template.name} (${formatTimeFrom24h(
                    template.startTime,
                    settings
                  )}-${formatTimeFrom24h(template.endTime, settings)})`,
                }))}
                onChange={(nextValue) => setOverrideTemplateId(nextValue)}
                disabled={overrideUnavailable || useFlexibleSlot}
              />
            </div>
            ) : null}
            {useFlexibleSlot ? (
              <div className="space-y-3 rounded-md border p-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Flexible plan type</Label>
                  <Select aria-label="Flexible plan type"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={flexibleEditorMode}
                    onValueChange={(value) =>
                      setFlexibleEditorMode(
                        value as "WEEK_OVERRIDE" | "RECURRING_PATTERN"
                      )
                    }
                  >
                    <option value="WEEK_OVERRIDE">Weekly override (current week)</option>
                    <option value="RECURRING_PATTERN">Recurring base pattern</option>
                  </Select>
                </div>
                {flexibleEditorMode === "RECURRING_PATTERN" ? (
                  <div className="grid gap-2 rounded-md border p-2 sm:grid-cols-2">
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-[10px] text-muted-foreground">Pattern name</Label>
                      <Input aria-label="Pattern name"
                        value={recurringPatternName}
                        onChange={(event) => setRecurringPatternName(event.target.value)}
                        placeholder="Optional pattern name"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Valid from</Label>
                      <Input aria-label="Valid from"
                        type="date"
                        value={recurringValidFrom}
                        onChange={(event) => setRecurringValidFrom(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Valid to</Label>
                      <Input aria-label="Valid to"
                        type="date"
                        value={recurringValidTo}
                        onChange={(event) => setRecurringValidTo(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Cycle weeks</Label>
                      <Input aria-label="Cycle weeks"
                        type="number"
                        min={1}
                        max={12}
                        value={recurringCycleLength}
                        onChange={(event) => {
                          const nextLength = Math.max(1, Math.min(12, Number(event.target.value) || 1))
                          setRecurringCycleLength(nextLength)
                          setRecurringDraftWeeks((prev) => {
                            const next = [...prev]
                            if (next.length < nextLength) {
                              for (let index = next.length; index < nextLength; index += 1) {
                                next.push({
                                  weekIndex: index + 1,
                                  days: WEEKDAY_ORDER.map((day) => createEmptyFlexibleDraftDay(day)),
                                })
                              }
                            }
                            if (next.length > nextLength) {
                              next.splice(nextLength)
                            }
                            return next.map((week, index) => ({ ...week, weekIndex: index + 1 }))
                          })
                          setRecurringSelectedWeekIndex((prev) => Math.min(prev, nextLength))
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Editing week</Label>
                      <Select aria-label="Editing week"
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={recurringSelectedWeekIndex}
                        onValueChange={(value) =>
                          setRecurringSelectedWeekIndex(Number(value) || 1)
                        }
                      >
                        {Array.from({ length: recurringCycleLength }, (_, index) => (
                          <option key={`recurring-week-${index + 1}`} value={index + 1}>
                            Week {index + 1}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                ) : null}
                <div className="text-xs text-muted-foreground">
                  {flexibleEditorMode === "WEEK_OVERRIDE"
                    ? "Define weekly override availability (multiple slots and breaks supported)."
                    : "Define recurring week pattern (multiple slots and breaks supported)."}
                </div>
                <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                  {currentEditableDays.map((day) => (
                    <div key={day.day} className="rounded-md border p-2">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-medium">{day.day}</div>
                        <label className="flex items-center gap-2 text-xs">
                          <Checkbox
                            checked={day.isOff}
                            onChange={(event) => setFlexibleDayOff(day.day, event.target.checked)}
                          />
                          Off
                        </label>
                      </div>
                      {day.isOff ? null : (
                        <div className="space-y-2">
                          {day.slots.map((slot, slotIndex) => (
                            <div key={`${day.day}-slot-${slotIndex}`} className="rounded border p-2">
                              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                                <div>
                                  <Label className="text-[10px] text-muted-foreground">Start</Label>
                                  <TimePicker
                                    value={slot.startTime}
                                    timeFormat={settings.timeFormat ?? "H24"}
                                    onChange={(value) =>
                                      updateFlexibleDaySlot(day.day, slotIndex, { startTime: value })
                                    }
                                  />
                                </div>
                                <div>
                                  <Label className="text-[10px] text-muted-foreground">End</Label>
                                  <TimePicker
                                    value={slot.endTime}
                                    timeFormat={settings.timeFormat ?? "H24"}
                                    onChange={(value) =>
                                      updateFlexibleDaySlot(day.day, slotIndex, { endTime: value })
                                    }
                                  />
                                </div>
                                <div className="flex items-end">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => removeFlexibleDaySlot(day.day, slotIndex)}
                                  >
                                    Remove
                                  </Button>
                                </div>
                              </div>
                              <div className="mt-2 space-y-2">
                                {slot.breaks.map((slotBreak, breakIndex) => (
                                  <div
                                    key={`${day.day}-slot-${slotIndex}-break-${breakIndex}`}
                                    className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                                  >
                                    <div>
                                      <Label className="text-[10px] text-muted-foreground">Break start</Label>
                                      <TimePicker
                                        value={slotBreak.startTime}
                                        timeFormat={settings.timeFormat ?? "H24"}
                                        onChange={(value) =>
                                          updateFlexibleSlotBreak(day.day, slotIndex, breakIndex, {
                                            startTime: value,
                                          })
                                        }
                                      />
                                    </div>
                                    <div>
                                      <Label className="text-[10px] text-muted-foreground">Break end</Label>
                                      <TimePicker
                                        value={slotBreak.endTime}
                                        timeFormat={settings.timeFormat ?? "H24"}
                                        onChange={(value) =>
                                          updateFlexibleSlotBreak(day.day, slotIndex, breakIndex, {
                                            endTime: value,
                                          })
                                        }
                                      />
                                    </div>
                                    <div className="flex items-end">
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => removeFlexibleSlotBreak(day.day, slotIndex, breakIndex)}
                                      >
                                        Remove break
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => addFlexibleSlotBreak(day.day, slotIndex)}
                                >
                                  Add break
                                </Button>
                              </div>
                            </div>
                          ))}
                          <Button type="button" variant="outline" size="sm" onClick={() => addFlexibleDaySlot(day.day)}>
                            Add slot
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {useFlexibleSlot
                    ? flexibleEditorMode === "WEEK_OVERRIDE"
                      ? "Week start date"
                      : "Pattern start date"
                    : "Start date"}
                </Label>
                <Input
                  type="date"
                  value={
                    useFlexibleSlot
                      ? flexibleEditorMode === "WEEK_OVERRIDE"
                        ? overrideStartDate
                        : recurringValidFrom
                      : overrideStartDate
                  }
                  onChange={(event) => {
                    const value = event.target.value
                    if (useFlexibleSlot && flexibleEditorMode === "RECURRING_PATTERN") {
                      setRecurringValidFrom(value)
                      return
                    }
                    setOverrideStartDate(value)
                  }}
                  disabled={useFlexibleSlot && flexibleEditorMode === "WEEK_OVERRIDE"}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {useFlexibleSlot
                    ? flexibleEditorMode === "WEEK_OVERRIDE"
                      ? "Week end date"
                      : "Pattern end date"
                    : "End date"}
                </Label>
                <Input
                  type="date"
                  value={
                    useFlexibleSlot
                      ? flexibleEditorMode === "WEEK_OVERRIDE"
                        ? overrideEndDate
                        : recurringValidTo
                      : overrideEndDate
                  }
                  onChange={(event) => {
                    const value = event.target.value
                    if (useFlexibleSlot && flexibleEditorMode === "RECURRING_PATTERN") {
                      setRecurringValidTo(value)
                      return
                    }
                    setOverrideEndDate(value)
                  }}
                  disabled={useFlexibleSlot && flexibleEditorMode === "WEEK_OVERRIDE"}
                />
              </div>
            </div>
            {useFlexibleSlot &&
            flexibleEditorMode === "RECURRING_PATTERN" &&
            Boolean(recurringPatternId) ? (
              <div className="space-y-2 rounded-md border p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Preview mode</Label>
                    <Select aria-label="Preview mode"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={recurringImpactMode}
                      onValueChange={(value) => {
                        setRecurringImpactMode(value as "UPDATE" | "CLONE")
                        setRecurringImpactPreview(null)
                      }}
                    >
                      <option value="UPDATE">Update current pattern</option>
                      <option value="CLONE">Save as new pattern</option>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void previewRecurringImpact()}
                    disabled={recurringImpactLoading}
                  >
                    {recurringImpactLoading ? "Previewing..." : "Preview impact"}
                  </Button>
                </div>
                {recurringImpactPreview ? (
                  <div className="space-y-1 text-sm">
                    <div className="font-medium">Impact preview</div>
                    <div className="text-muted-foreground">
                      Window: {formatDateForDisplay(recurringImpactPreview.window.startDate, settings.dateFormat)} -{" "}
                      {recurringImpactPreview.window.endDate
                        ? formatDateForDisplay(recurringImpactPreview.window.endDate, settings.dateFormat)
                        : "Open ended"}
                      {recurringImpactPreview.window.truncatedAt
                        ? ` (previewed to ${formatDateForDisplay(recurringImpactPreview.window.truncatedAt, settings.dateFormat)})`
                        : ""}
                    </div>
                    <div>Estimated available hours: {recurringImpactPreview.estimatedBookedHoursInWindow}</div>
                    <div>Active appointments in window: {recurringImpactPreview.affectedAppointmentsCount}</div>
                    <div>
                      Overlapping active patterns: {recurringImpactPreview.overlappingActivePatternsCount}
                    </div>
                    {recurringImpactPreview.notes.map((note) => (
                      <div key={note} className="text-xs text-muted-foreground">
                        - {note}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {!useFlexibleSlot ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={overrideUnavailable}
                onChange={(event) => {
                  const next = event.target.checked
                  setOverrideUnavailable(next)
                  if (next) {
                    setOverrideTemplateId("")
                  }
                }}
                disabled={useFlexibleSlot}
              />
              Mark as unavailable
            </label>
            ) : null}
            {!useFlexibleSlot ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={overrideSkipWeekOff}
                onChange={(event) => setOverrideSkipWeekOff(event.target.checked)}
                disabled={useFlexibleSlot}
              />
              Skip holidays / week off
            </label>
            ) : null}
          </div></ActionDialogContent>
      </Dialog>
      <Dialog open={saveAsNewConfirmOpen} onOpenChange={setSaveAsNewConfirmOpen}>
        <ActionDialogContent title={<>Save as new recurring pattern?</>} description={<>This keeps the current pattern and creates a new active pattern version for this staff member.
            </>} className="sm:max-w-md" actions={<> <Button variant="outline" onClick={() => setSaveAsNewConfirmOpen(false)}>
              Cancel
            </Button><Button
              disabled={!canCreatePlan} onClick={() => {
                setSaveAsNewConfirmOpen(false)
                void submitOverride(true)
              }}
            >
              Confirm and save new
            </Button> </>}></ActionDialogContent>
      </Dialog>
      <Dialog open={conflictsOpen} onOpenChange={setConflictsOpen}>
        <ActionDialogContent title={<>Resolve appointment conflicts</>} description={<>The shift change overlaps existing appointments. Choose how to handle them.
            </>} className="sm:max-w-lg" actions={<> <Button variant="outline" onClick={() => setConflictsOpen(false)}>
              Close
            </Button><Button disabled={!enabled("appointments") || !(conflictAction === "cancel" ? can("appointments.archive") : enabled("services") && can("services.read") && can("appointments.edit"))} onClick={resolveConflicts}>Apply resolution</Button> </>}><div className="space-y-4">
            <div className="rounded-md border p-3 text-sm text-muted-foreground">
              {conflicts.length} appointment{conflicts.length === 1 ? "" : "s"} in conflict.
            </div>
            <div className="space-y-2">
              {conflicts.map((item) => (
                <div key={item.id} className="rounded-md border p-3 text-xs">
                  <div className="text-sm font-medium">
                    {item.serviceName ?? "Service"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.customerName || item.customerEmail || "Customer"} •{" "}
                    {formatDateForDisplay(item.startAt, settings.dateFormat)}{" "}
                    {formatTimeFromDate(item.startAt, settings)}
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Action</Label>
              <Select aria-label="Action"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={conflictAction}
                onValueChange={(value) =>
                  setConflictAction(value as "cancel" | "reassign" | "reschedule")
                }
              >
                <option value="cancel">Cancel appointments</option>
                <option value="reassign">Reassign to another staff</option>
                <option value="reschedule">Reschedule to another time</option>
              </Select>
            </div>
            {conflictAction === "reassign" ? (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Reassign staff</Label>
                <SearchableSelect
                  value={conflictStaffId}
                  placeholder="Select staff"
                  searchPlaceholder="Search staff..."
                  options={staff.map((member) => ({
                    value: member.id,
                    label: member.name?.trim() || member.email,
                  }))}
                  onChange={(nextValue) => setConflictStaffId(nextValue)}
                />
              </div>
            ) : null}
            {conflictAction === "reschedule" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">New date</Label>
                  <Input aria-label="New date"
                    type="date"
                    value={conflictRescheduleDate}
                    onChange={(event) => setConflictRescheduleDate(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">New time</Label>
                  <TimePicker
                    value={conflictRescheduleTime}
                    timeFormat={settings.timeFormat ?? "H24"}
                    onChange={(nextValue) => setConflictRescheduleTime(nextValue)}
                  />
                </div>
              </div>
            ) : null}
          </div></ActionDialogContent>
      </Dialog>
      {debugEnabled && debugSummary ? (
        <div className="rounded-lg border border-dashed bg-muted/40 p-4 text-xs text-muted-foreground">
          <pre className="whitespace-pre-wrap">
            {JSON.stringify(debugSummary, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  )
}

