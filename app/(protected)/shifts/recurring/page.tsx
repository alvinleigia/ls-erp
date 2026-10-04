"use client"
import { useBusinessModules } from "@/platform/module-provider"
import { useCurrentResourceAction } from "@/platform/access/view-guard"
import { DraftPanel, RecordPanel, ReadOnlyFields } from "@/components/erp/record-detail"
import { RecurringPlanSummary } from "./recurring-plan-summary"
import { Section } from "@/components/erp/section"

import { ActionDialogContent } from "@/components/erp/action-dialog"

import { PageHeader, pageClass, Surface, TableToolbar, Filters } from "@/components/erp/page"
import { TablePagination } from "@/components/erp/pagination"

import { Select, Checkbox } from "@/components/erp/controls"

import * as React from "react"
import Link from "next/link"
import {
  ColumnDef,
  SortingState,
  VisibilityState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, MoreHorizontalIcon } from "lucide-react"
import { toast } from "sonner"

import { DataTable } from "@/components/data-table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Dialog } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TimePicker } from "@/components/ui/time-picker"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import type { ListResponse } from "@/types/api"
import type { StaffFlexiblePattern, StaffFlexiblePatternListItem, StaffOption } from "@/types/shifts"
import type { Weekday } from "@/types/scheduling"

type PaginationState = { pageIndex: number; pageSize: number }
type ImpactPreview = {
  mode: "DEACTIVATE" | "CLONE" | "UPDATE"
  patternId: string
  staffName: string | null
  staffEmail: string
  window: {
    startDate: string
    endDate: string | null
    truncatedAt: string | null
    isOpenEnded: boolean
  }
  estimatedBookedMinutesInWindow: number
  estimatedBookedHoursInWindow: number
  affectedAppointmentsCount: number
  overlappingActivePatternsCount: number
  notes: string[]
}

type RecurringDraftBreak = {
  startTime: string
  endTime: string
}

type RecurringDraftSlot = {
  startTime: string
  endTime: string
  breaks: RecurringDraftBreak[]
}

type RecurringDraftDay = {
  day: Weekday
  isOff: boolean
  slots: RecurringDraftSlot[]
}

type RecurringDraftWeek = {
  weekIndex: number
  days: RecurringDraftDay[]
}

const WEEKDAY_ORDER: Weekday[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
]

const createEmptyDraftDay = (day: Weekday): RecurringDraftDay => ({
  day,
  isOff: true,
  slots: [],
})

const SortIndicator = ({ value }: { value: false | "asc" | "desc" }) => {
  if (value === "asc") return <ArrowUpIcon className="h-4 w-4" />
  if (value === "desc") return <ArrowDownIcon className="h-4 w-4" />
  return <ArrowUpDownIcon className="h-4 w-4" />
}

export default function ShiftRecurringPlansPage() {
  const { can } = useBusinessModules()
  const canCreate = useCurrentResourceAction("create")
  const canEdit = useCurrentResourceAction("edit")
  const canArchive = useCurrentResourceAction("archive")

  const [viewing, setViewing] = React.useState<StaffFlexiblePatternListItem | null>(null)
  const { formatDate } = useDateFormatter()
  const [items, setItems] = React.useState<StaffFlexiblePatternListItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [totalRows, setTotalRows] = React.useState(0)
  const [staffOptions, setStaffOptions] = React.useState<StaffOption[]>([])

  const [search, setSearch] = React.useState("")
  const [staffFilter, setStaffFilter] = React.useState("all")
  const [statusFilter, setStatusFilter] = React.useState<"all" | "active" | "inactive">("all")
  const [effectiveOn, setEffectiveOn] = React.useState("")

  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "updatedAt", desc: true },
  ])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({
    pattern: true,
    staff: true,
    cycle: true,
    validity: true,
    status: true,
    effectiveNow: true,
    updatedAt: true,
    actions: true,
  })
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const [deactivateTarget, setDeactivateTarget] = React.useState<StaffFlexiblePatternListItem | null>(null)
  const [cloneTarget, setCloneTarget] = React.useState<StaffFlexiblePatternListItem | null>(null)
  const [formError, setFormError] = React.useState("")
  const [actionLoading, setActionLoading] = React.useState(false)
  const [cloneName, setCloneName] = React.useState("")
  const [cloneValidFrom, setCloneValidFrom] = React.useState("")
  const [cloneValidTo, setCloneValidTo] = React.useState("")
  const [cloneActivate, setCloneActivate] = React.useState(true)
  const [assignTarget, setAssignTarget] = React.useState<StaffFlexiblePatternListItem | null>(null)
  const [assignStaffId, setAssignStaffId] = React.useState("")
  const [assignName, setAssignName] = React.useState("")
  const [assignValidFrom, setAssignValidFrom] = React.useState("")
  const [assignValidTo, setAssignValidTo] = React.useState("")
  const [assignActivate, setAssignActivate] = React.useState(true)
  const [deactivatePreview, setDeactivatePreview] = React.useState<ImpactPreview | null>(null)
  const [clonePreview, setClonePreview] = React.useState<ImpactPreview | null>(null)
  const [assignPreview, setAssignPreview] = React.useState<ImpactPreview | null>(null)
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createStaffId, setCreateStaffId] = React.useState("")
  const [createName, setCreateName] = React.useState("")
  const [createValidFrom, setCreateValidFrom] = React.useState("")
  const [createValidTo, setCreateValidTo] = React.useState("")
  const [createCycleLength, setCreateCycleLength] = React.useState(1)
  const [createSelectedWeekIndex, setCreateSelectedWeekIndex] = React.useState(1)
  const [createDraftWeeks, setCreateDraftWeeks] = React.useState<RecurringDraftWeek[]>([
    { weekIndex: 1, days: WEEKDAY_ORDER.map((day) => createEmptyDraftDay(day)) },
  ])
  const [editOpen, setEditOpen] = React.useState(false)
  const [editLoading, setEditLoading] = React.useState(false)
  const [editPatternId, setEditPatternId] = React.useState("")
  const [editStaffId, setEditStaffId] = React.useState("")
  const [editName, setEditName] = React.useState("")
  const [editValidFrom, setEditValidFrom] = React.useState("")
  const [editValidTo, setEditValidTo] = React.useState("")
  const [editCycleLength, setEditCycleLength] = React.useState(1)
  const [editSelectedWeekIndex, setEditSelectedWeekIndex] = React.useState(1)
  const [editDraftWeeks, setEditDraftWeeks] = React.useState<RecurringDraftWeek[]>([
    { weekIndex: 1, days: WEEKDAY_ORDER.map((day) => createEmptyDraftDay(day)) },
  ])
  const [editPreview, setEditPreview] = React.useState<ImpactPreview | null>(null)
  const editPreviewRequestRef = React.useRef(0)

  const totalPages = Math.max(1, Math.ceil(totalRows / pagination.pageSize))

  const loadStaff = React.useCallback(async () => {
    try {
      const response = await fetch("/api/directory?role=STAFF&pageSize=100", { cache: "no-store" })
      if (!response.ok) {
        throw new Error("Failed to load staff list.")
      }
      const data = (await response.json()) as { items?: StaffOption[] }
      setStaffOptions(data.items ?? [])
    } catch (error) {
      console.error(error)
      setStaffOptions([])
      toast.error("Unable to load staff list.")
    }
  }, [])

  const loadPlans = React.useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("page", String(pagination.pageIndex + 1))
      params.set("pageSize", String(pagination.pageSize))
      if (search.trim()) params.set("q", search.trim())
      if (staffFilter !== "all") params.set("staffId", staffFilter)
      if (statusFilter === "active") params.set("isActive", "true")
      if (statusFilter === "inactive") params.set("isActive", "false")
      if (effectiveOn) params.set("effectiveOn", effectiveOn)
      if (sorting[0]) {
        params.set("sort", sorting[0].id)
        params.set("order", sorting[0].desc ? "desc" : "asc")
      }

      const response = await fetch(`/api/shifts/flexible-patterns/list?${params.toString()}`, {
        cache: "no-store",
      })
      if (!response.ok) {
        throw new Error("Failed to load recurring plans.")
      }
      const data = (await response.json()) as ListResponse<StaffFlexiblePatternListItem>
      setItems(data.items)
      setTotalRows(data.total)
    } catch (error) {
      console.error(error)
      setItems([])
      setTotalRows(0)
      toast.error("Unable to load recurring plans.")
    } finally {
      setLoading(false)
    }
  }, [effectiveOn, pagination.pageIndex, pagination.pageSize, search, sorting, staffFilter, statusFilter])

  React.useEffect(() => {
    void loadStaff()
  }, [loadStaff])

  React.useEffect(() => {
    void loadPlans()
  }, [loadPlans])

  React.useEffect(() => {
    setPagination((prev) =>
      prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }
    )
  }, [search, sorting, staffFilter, statusFilter, effectiveOn])

  const handlePaginationChange = React.useCallback(
    (updater: PaginationState | ((prev: PaginationState) => PaginationState)) => {
      setPagination((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater
        if (next.pageSize !== prev.pageSize) {
          return { ...next, pageIndex: 0 }
        }
        return next
      })
    },
    []
  )

  const nextMonday = React.useCallback(() => {
    const now = new Date()
    const day = now.getDay()
    const delta = day === 0 ? 1 : 8 - day
    now.setDate(now.getDate() + delta)
    now.setHours(0, 0, 0, 0)
    return now.toISOString().slice(0, 10)
  }, [])

  const createEmptyWeeks = React.useCallback(
    (cycleLength: number): RecurringDraftWeek[] =>
      Array.from({ length: cycleLength }, (_, index) => ({
        weekIndex: index + 1,
        days: WEEKDAY_ORDER.map((day) => createEmptyDraftDay(day)),
      })),
    []
  )

  const openCreateDialog = React.useCallback(() => {
    setFormError("")
    setCreateOpen(true)
    setCreateStaffId("")
    setCreateName("")
    setCreateValidFrom(nextMonday())
    setCreateValidTo("")
    setCreateCycleLength(1)
    setCreateSelectedWeekIndex(1)
    setCreateDraftWeeks(createEmptyWeeks(1))
  }, [createEmptyWeeks, nextMonday])

  const mapPatternToDraftWeeks = React.useCallback(
    (pattern: StaffFlexiblePattern): RecurringDraftWeek[] =>
      Array.from({ length: pattern.cycleLengthWeeks }, (_, weekOffset) => {
        const weekIndex = weekOffset + 1
        const sourceWeek = pattern.weeks.find((week) => week.weekIndex === weekIndex)
        return {
          weekIndex,
          days: WEEKDAY_ORDER.map((day) => {
            const sourceDay = sourceWeek?.days.find((item) => item.day === day)
            if (!sourceDay) return createEmptyDraftDay(day)
            return {
              day,
              isOff: sourceDay.isOff,
              slots: sourceDay.slots.map((slot) => ({
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
      }),
    []
  )

  const openEditDialog = React.useCallback(async (item: StaffFlexiblePatternListItem) => {
    setFormError("")
    setEditOpen(true)
    setEditLoading(true)
    setEditPreview(null)
    try {
      const response = await fetch(`/api/shifts/flexible-patterns/${item.id}`, { cache: "no-store" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Unable to load recurring pattern detail.")
      }
      const data = (await response.json()) as { item?: StaffFlexiblePattern }
      const pattern = data.item
      if (!pattern) {
        throw new Error("Recurring pattern detail not found.")
      }
      setEditPatternId(pattern.id)
      setEditStaffId(pattern.staffId ?? "")
      setEditName(pattern.name ?? "")
      setEditValidFrom(pattern.validFrom)
      setEditValidTo(pattern.validTo ?? "")
      setEditCycleLength(pattern.cycleLengthWeeks)
      setEditSelectedWeekIndex(1)
      setEditDraftWeeks(mapPatternToDraftWeeks(pattern))
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Unable to load recurring pattern detail.")
      setEditOpen(false)
    } finally {
      setEditLoading(false)
    }
  }, [mapPatternToDraftWeeks])

  const updateCreateDraftDays = React.useCallback(
    (updater: (days: RecurringDraftDay[]) => RecurringDraftDay[]) => {
      setCreateDraftWeeks((prev) =>
        prev.map((week) =>
          week.weekIndex === createSelectedWeekIndex ? { ...week, days: updater(week.days) } : week
        )
      )
    },
    [createSelectedWeekIndex]
  )

  const createCurrentDays = React.useMemo(
    () =>
      createDraftWeeks.find((week) => week.weekIndex === createSelectedWeekIndex)?.days ??
      WEEKDAY_ORDER.map((day) => createEmptyDraftDay(day)),
    [createDraftWeeks, createSelectedWeekIndex]
  )

  const setCreateDayOff = React.useCallback(
    (day: Weekday, isOff: boolean) => {
      updateCreateDraftDays((days) =>
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
    [updateCreateDraftDays]
  )

  const addCreateSlot = React.useCallback(
    (day: Weekday) => {
      updateCreateDraftDays((days) =>
        days.map((item) =>
          item.day === day
            ? { ...item, isOff: false, slots: [...item.slots, { startTime: "10:00", endTime: "14:00", breaks: [] }] }
            : item
        )
      )
    },
    [updateCreateDraftDays]
  )

  const updateCreateSlot = React.useCallback(
    (day: Weekday, slotIndex: number, patch: Partial<RecurringDraftSlot>) => {
      updateCreateDraftDays((days) =>
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
    [updateCreateDraftDays]
  )

  const removeCreateSlot = React.useCallback(
    (day: Weekday, slotIndex: number) => {
      updateCreateDraftDays((days) =>
        days.map((item) =>
          item.day === day
            ? {
                ...item,
                slots: item.slots.filter((_, index) => index !== slotIndex),
              }
            : item
        )
      )
    },
    [updateCreateDraftDays]
  )

  const addCreateBreak = React.useCallback(
    (day: Weekday, slotIndex: number) => {
      updateCreateDraftDays((days) =>
        days.map((item) =>
          item.day === day
            ? {
                ...item,
                slots: item.slots.map((slot, index) =>
                  index === slotIndex
                    ? { ...slot, breaks: [...slot.breaks, { startTime: "12:00", endTime: "12:30" }] }
                    : slot
                ),
              }
            : item
        )
      )
    },
    [updateCreateDraftDays]
  )

  const updateCreateBreak = React.useCallback(
    (
      day: Weekday,
      slotIndex: number,
      breakIndex: number,
      patch: Partial<RecurringDraftBreak>
    ) => {
      updateCreateDraftDays((days) =>
        days.map((item) =>
          item.day === day
            ? {
                ...item,
                slots: item.slots.map((slot, index) =>
                  index === slotIndex
                    ? {
                        ...slot,
                        breaks: slot.breaks.map((slotBreak, currentBreakIndex) =>
                          currentBreakIndex === breakIndex ? { ...slotBreak, ...patch } : slotBreak
                        ),
                      }
                    : slot
                ),
              }
            : item
        )
      )
    },
    [updateCreateDraftDays]
  )

  const removeCreateBreak = React.useCallback(
    (day: Weekday, slotIndex: number, breakIndex: number) => {
      updateCreateDraftDays((days) =>
        days.map((item) =>
          item.day === day
            ? {
                ...item,
                slots: item.slots.map((slot, index) =>
                  index === slotIndex
                    ? {
                        ...slot,
                        breaks: slot.breaks.filter((_, currentBreakIndex) => currentBreakIndex !== breakIndex),
                      }
                    : slot
                ),
              }
            : item
        )
      )
    },
    [updateCreateDraftDays]
  )

  const updateEditDraftDays = React.useCallback(
    (updater: (days: RecurringDraftDay[]) => RecurringDraftDay[]) => {
      setEditDraftWeeks((prev) =>
        prev.map((week) =>
          week.weekIndex === editSelectedWeekIndex ? { ...week, days: updater(week.days) } : week
        )
      )
    },
    [editSelectedWeekIndex]
  )

  const editCurrentDays = React.useMemo(
    () =>
      editDraftWeeks.find((week) => week.weekIndex === editSelectedWeekIndex)?.days ??
      WEEKDAY_ORDER.map((day) => createEmptyDraftDay(day)),
    [editDraftWeeks, editSelectedWeekIndex]
  )

  const setEditDayOff = React.useCallback(
    (day: Weekday, isOff: boolean) => {
      updateEditDraftDays((days) =>
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
    [updateEditDraftDays]
  )

  const addEditSlot = React.useCallback(
    (day: Weekday) => {
      updateEditDraftDays((days) =>
        days.map((item) =>
          item.day === day
            ? { ...item, isOff: false, slots: [...item.slots, { startTime: "10:00", endTime: "14:00", breaks: [] }] }
            : item
        )
      )
    },
    [updateEditDraftDays]
  )

  const updateEditSlot = React.useCallback(
    (day: Weekday, slotIndex: number, patch: Partial<RecurringDraftSlot>) => {
      updateEditDraftDays((days) =>
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
    [updateEditDraftDays]
  )

  const removeEditSlot = React.useCallback(
    (day: Weekday, slotIndex: number) => {
      updateEditDraftDays((days) =>
        days.map((item) =>
          item.day === day
            ? {
                ...item,
                slots: item.slots.filter((_, index) => index !== slotIndex),
              }
            : item
        )
      )
    },
    [updateEditDraftDays]
  )

  const addEditBreak = React.useCallback(
    (day: Weekday, slotIndex: number) => {
      updateEditDraftDays((days) =>
        days.map((item) =>
          item.day === day
            ? {
                ...item,
                slots: item.slots.map((slot, index) =>
                  index === slotIndex
                    ? { ...slot, breaks: [...slot.breaks, { startTime: "12:00", endTime: "12:30" }] }
                    : slot
                ),
              }
            : item
        )
      )
    },
    [updateEditDraftDays]
  )

  const updateEditBreak = React.useCallback(
    (day: Weekday, slotIndex: number, breakIndex: number, patch: Partial<RecurringDraftBreak>) => {
      updateEditDraftDays((days) =>
        days.map((item) =>
          item.day === day
            ? {
                ...item,
                slots: item.slots.map((slot, index) =>
                  index === slotIndex
                    ? {
                        ...slot,
                        breaks: slot.breaks.map((slotBreak, currentBreakIndex) =>
                          currentBreakIndex === breakIndex ? { ...slotBreak, ...patch } : slotBreak
                        ),
                      }
                    : slot
                ),
              }
            : item
        )
      )
    },
    [updateEditDraftDays]
  )

  const removeEditBreak = React.useCallback(
    (day: Weekday, slotIndex: number, breakIndex: number) => {
      updateEditDraftDays((days) =>
        days.map((item) =>
          item.day === day
            ? {
                ...item,
                slots: item.slots.map((slot, index) =>
                  index === slotIndex
                    ? {
                        ...slot,
                        breaks: slot.breaks.filter((_, currentBreakIndex) => currentBreakIndex !== breakIndex),
                      }
                    : slot
                ),
              }
            : item
        )
      )
    },
    [updateEditDraftDays]
  )

  const openCloneDialog = React.useCallback(
    (item: StaffFlexiblePatternListItem) => {
      setCloneTarget(item)
      setCloneName(item.name ? `${item.name} (Copy)` : "")
      setCloneValidFrom(nextMonday())
      setCloneValidTo(item.validTo ?? "")
      setCloneActivate(true)
      setClonePreview(null)
    },
    [nextMonday]
  )

  const openAssignDialog = React.useCallback(
    (item: StaffFlexiblePatternListItem) => {
      setAssignTarget(item)
      setAssignStaffId("")
      setAssignName(item.name ? `${item.name} (Assigned)` : "")
      setAssignValidFrom(nextMonday())
      setAssignValidTo(item.validTo ?? "")
      setAssignActivate(true)
      setAssignPreview(null)
    },
    [nextMonday]
  )

  const loadImpactPreview = React.useCallback(
    async (input: {
      mode: "DEACTIVATE" | "CLONE" | "UPDATE"
      patternId: string
      targetStaffId?: string
      validFrom?: string
      validTo?: string
      activate?: boolean
      cycleLengthWeeks?: number
      weeks?: Array<{
        weekIndex: number
        days: Array<{
          day: Weekday
          isOff: boolean
          sortOrder: number
          slots: Array<{
            startTime: string
            endTime: string
            sortOrder: number
            breaks: Array<{
              startTime: string
              endTime: string
              sortOrder: number
            }>
          }>
        }>
      }>
    }) => {
      setPreviewLoading(true)
      try {
        const response = await fetch("/api/shifts/flexible-patterns/impact-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || "Failed to load impact preview.")
        }
        const data = (await response.json()) as { preview?: ImpactPreview }
        return data.preview ?? null
      } finally {
        setPreviewLoading(false)
      }
    },
    []
  )

  const previewDeactivateImpact = React.useCallback(async () => {
    if (!deactivateTarget) return
    try {
      const preview = await loadImpactPreview({
        mode: "DEACTIVATE",
        patternId: deactivateTarget.id,
      })
      setDeactivatePreview(preview)
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Unable to preview deactivation impact.")
    }
  }, [deactivateTarget, loadImpactPreview])

  const previewCloneImpact = React.useCallback(async () => {
    if (!cloneTarget) return
    if (!cloneValidFrom) {
      toast.error("Clone start date is required.")
      return
    }
    if (cloneValidTo && cloneValidFrom > cloneValidTo) {
      toast.error("Clone start date must be on or before end date.")
      return
    }
    try {
      const preview = await loadImpactPreview({
        mode: "CLONE",
        patternId: cloneTarget.id,
        validFrom: cloneValidFrom,
        validTo: cloneValidTo || "",
        activate: cloneActivate,
      })
      setClonePreview(preview)
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Unable to preview clone impact.")
    }
  }, [cloneActivate, cloneTarget, cloneValidFrom, cloneValidTo, loadImpactPreview])

  const previewAssignImpact = React.useCallback(async () => {
    if (!assignTarget) return
    if (!assignStaffId) {
      toast.error("Select a staff member to assign.")
      return
    }
    if (!assignValidFrom) {
      toast.error("Assignment start date is required.")
      return
    }
    if (assignValidTo && assignValidFrom > assignValidTo) {
      toast.error("Assignment start date must be on or before end date.")
      return
    }
    try {
      const preview = await loadImpactPreview({
        mode: "CLONE",
        patternId: assignTarget.id,
        targetStaffId: assignStaffId,
        validFrom: assignValidFrom,
        validTo: assignValidTo || "",
        activate: assignActivate,
      })
      setAssignPreview(preview)
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Unable to preview assignment impact.")
    }
  }, [assignActivate, assignStaffId, assignTarget, assignValidFrom, assignValidTo, loadImpactPreview])

  const previewEditImpact = React.useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false
    if (!editPatternId || !editStaffId) {
      if (!silent) toast.error("Unable to identify pattern or staff.")
      return
    }
    if (!editValidFrom) {
      if (!silent) toast.error("Valid from date is required.")
      return
    }
    if (editValidTo && editValidFrom > editValidTo) {
      if (!silent) toast.error("Valid from date must be on or before valid to date.")
      return
    }
    try {
      const requestId = editPreviewRequestRef.current + 1
      editPreviewRequestRef.current = requestId
      const preview = await loadImpactPreview({
        mode: "UPDATE",
        patternId: editPatternId,
        validFrom: editValidFrom,
        validTo: editValidTo || "",
        activate: true,
        cycleLengthWeeks: editCycleLength,
        weeks: editDraftWeeks.map((week) => ({
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
      })
      if (requestId !== editPreviewRequestRef.current) return
      setEditPreview(preview)
    } catch (error) {
      console.error(error)
      if (!silent) {
        toast.error(error instanceof Error ? error.message : "Unable to preview update impact.")
      }
    }
  }, [
    editCycleLength,
    editDraftWeeks,
    editPatternId,
    editStaffId,
    editValidFrom,
    editValidTo,
    loadImpactPreview,
  ])

  React.useEffect(() => {
    if (!editOpen || editLoading) return
    if (!editPatternId || !editStaffId || !editValidFrom || (editValidTo && editValidFrom > editValidTo)) {
      setEditPreview(null)
      return
    }
    const timer = setTimeout(() => {
      void previewEditImpact({ silent: true })
    }, 500)
    return () => clearTimeout(timer)
  }, [
    editCycleLength,
    editDraftWeeks,
    editLoading,
    editOpen,
    editPatternId,
    editStaffId,
    editValidFrom,
    editValidTo,
    previewEditImpact,
  ])

  React.useEffect(() => {
    if (!deactivateTarget) return
    void previewDeactivateImpact()
  }, [deactivateTarget, previewDeactivateImpact])

  const deactivatePattern = React.useCallback(async () => {
    if (!deactivateTarget) return
    setActionLoading(true)
    try {
      const response = await fetch(`/api/shifts/flexible-patterns/${deactivateTarget.id}/deactivate`, {
        method: "POST",
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Failed to deactivate recurring pattern.")
      }
      toast.success("Recurring pattern deactivated.")
      setDeactivateTarget(null)
      setDeactivatePreview(null)
      await loadPlans()
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Unable to deactivate recurring pattern.")
    } finally {
      setActionLoading(false)
    }
  }, [deactivateTarget, loadPlans])

  const clonePattern = React.useCallback(async () => {
    if (!cloneTarget) return
    if (!cloneValidFrom) {
      toast.error("Clone start date is required.")
      return
    }
    if (cloneValidTo && cloneValidFrom > cloneValidTo) {
      toast.error("Clone start date must be on or before end date.")
      return
    }
    setActionLoading(true)
    try {
      const response = await fetch(`/api/shifts/flexible-patterns/${cloneTarget.id}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cloneName,
          validFrom: cloneValidFrom,
          validTo: cloneValidTo || "",
          activate: cloneActivate,
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Failed to clone recurring pattern.")
      }
      toast.success("Recurring pattern cloned.")
      setCloneTarget(null)
      setClonePreview(null)
      await loadPlans()
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Unable to clone recurring pattern.")
    } finally {
      setActionLoading(false)
    }
  }, [cloneActivate, cloneName, cloneTarget, cloneValidFrom, cloneValidTo, loadPlans])

  const assignPattern = React.useCallback(async () => {
    if (!assignTarget) return
    if (!assignStaffId) {
      toast.error("Select a staff member to assign.")
      return
    }
    if (!assignValidFrom) {
      toast.error("Assignment start date is required.")
      return
    }
    if (assignValidTo && assignValidFrom > assignValidTo) {
      toast.error("Assignment start date must be on or before end date.")
      return
    }
    setActionLoading(true)
    try {
      const response = await fetch(`/api/shifts/flexible-patterns/${assignTarget.id}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: assignName,
          targetStaffId: assignStaffId,
          validFrom: assignValidFrom,
          validTo: assignValidTo || "",
          activate: assignActivate,
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Failed to assign recurring pattern.")
      }
      toast.success("Recurring pattern assigned to staff.")
      setAssignTarget(null)
      setAssignPreview(null)
      await loadPlans()
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Unable to assign recurring pattern.")
    } finally {
      setActionLoading(false)
    }
  }, [assignActivate, assignName, assignStaffId, assignTarget, assignValidFrom, assignValidTo, loadPlans])

  const saveEditPattern = React.useCallback(async () => {
    if (!editPatternId || !editStaffId) {
      toast.error("Unable to identify pattern or staff.")
      return
    }
    if (!editValidFrom) {
      toast.error("Valid from date is required.")
      return
    }
    if (editValidTo && editValidFrom > editValidTo) {
      toast.error("Valid from date must be on or before valid to date.")
      return
    }

    setFormError("")
    setActionLoading(true)
    try {
      const response = await fetch("/api/shifts/flexible-patterns", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patternId: editPatternId,
          staffId: editStaffId,
          name: editName,
          cycleLengthWeeks: editCycleLength,
          validFrom: editValidFrom,
          validTo: editValidTo || "",
          isActive: true,
          weeks: editDraftWeeks.map((week) => ({
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
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Failed to update recurring pattern.")
      }
      toast.success("Recurring pattern updated.")
      setEditOpen(false)
      setEditPreview(null)
      await loadPlans()
    } catch (error) {
      console.error(error)
      setFormError(error instanceof Error ? error.message : "Unable to save recurring plan.")
      toast.error(error instanceof Error ? error.message : "Unable to update recurring pattern.")
    } finally {
      setActionLoading(false)
    }
  }, [
    editCycleLength,
    editDraftWeeks,
    editName,
    editPatternId,
    editStaffId,
    editValidFrom,
    editValidTo,
    loadPlans,
  ])

  const createPattern = React.useCallback(async () => {
    if (!createStaffId) {
      toast.error("Select staff for this recurring plan.")
      return
    }
    if (!createValidFrom) {
      toast.error("Valid from date is required.")
      return
    }
    if (createValidTo && createValidFrom > createValidTo) {
      toast.error("Valid from date must be on or before valid to date.")
      return
    }

    setFormError("")
    setActionLoading(true)
    try {
      const response = await fetch("/api/shifts/flexible-patterns", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: createStaffId,
          name: createName,
          cycleLengthWeeks: createCycleLength,
          validFrom: createValidFrom,
          validTo: createValidTo || "",
          isActive: true,
          weeks: createDraftWeeks.map((week) => ({
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
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Failed to create recurring pattern.")
      }
      toast.success("Recurring pattern created.")
      setCreateOpen(false)
      await loadPlans()
    } catch (error) {
      console.error(error)
      setFormError(error instanceof Error ? error.message : "Unable to save recurring plan.")
      toast.error(error instanceof Error ? error.message : "Unable to create recurring pattern.")
    } finally {
      setActionLoading(false)
    }
  }, [
    createCycleLength,
    createDraftWeeks,
    createName,
    createStaffId,
    createValidFrom,
    createValidTo,
    loadPlans,
  ])

  const columns = React.useMemo<ColumnDef<StaffFlexiblePatternListItem>[]>(
    () => [
      {
        accessorKey: "pattern",
        header: () => <div>Pattern</div>,
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <button type="button" className="font-medium underline underline-offset-4" onClick={() => setViewing(row.original)}>{row.original.name?.trim() || "Untitled pattern"}</button>
            <div className="text-xs text-muted-foreground">{row.original.id.slice(-8)}</div>
          </div>
        ),
      },
      {
        accessorKey: "staff",
        header: "Staff",
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <div className="font-medium">{row.original.staffName || "Unnamed staff"}</div>
            <div className="text-xs text-muted-foreground">{row.original.staffEmail}</div>
          </div>
        ),
      },
      {
        accessorKey: "cycle",
        header: "Cycle",
        cell: ({ row }) => `${row.original.cycleLengthWeeks} week${row.original.cycleLengthWeeks === 1 ? "" : "s"}`,
      },
      {
        accessorKey: "validity",
        header: "Validity",
        cell: ({ row }) => (
          <div className="text-sm">
            {formatDate(row.original.validFrom)} -{" "}
            {row.original.validTo ? formatDate(row.original.validTo) : "Open ended"}
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <span className={row.original.isActive ? "text-emerald-500 font-medium" : "text-muted-foreground"}>
            {row.original.isActive ? "ACTIVE" : "INACTIVE"}
          </span>
        ),
      },
      {
        accessorKey: "effectiveNow",
        header: "Effective now",
        cell: ({ row }) => (row.original.isCurrentlyEffective ? "Yes" : "No"),
      },
      {
        accessorKey: "updatedAt",
        header: ({ column }) => (
          <button
            type="button"
            className="flex items-center gap-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Updated
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        cell: ({ row }) => formatDate(row.original.updatedAt),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 p-0" aria-label="Record actions">
                <MoreHorizontalIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem disabled={!canEdit} onClick={() => void openEditDialog(row.original)}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!can("shiftRoster.read")} asChild>
                <Link href={`/shifts/roster?staffId=${row.original.staffId ?? ""}`}>Open roster</Link>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canCreate} onClick={() => openCloneDialog(row.original)}>
                Clone pattern
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canCreate} onClick={() => openAssignDialog(row.original)}>
                Assign to staff
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeactivateTarget(row.original)}
                disabled={!canArchive || !row.original.isActive}
              >
                Deactivate
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
        enableSorting: false,
      },
    ],
    [formatDate, openAssignDialog, openCloneDialog, openEditDialog, canCreate, canEdit, canArchive, can]
  )

  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: totalPages,
    onPaginationChange: handlePaginationChange,
    onSortingChange: setSorting,
    state: {
      sorting,
      pagination,
      columnVisibility,
    },
    onColumnVisibilityChange: setColumnVisibility,
  })

  return (
    <div className={pageClass}>
      <PageHeader title={<> Recurring Plans </>} description={<> Manage flexible recurring availability patterns across staff. </>} actions={<> <Button disabled={!canCreate} type="button" onClick={openCreateDialog}>New recurring plan</Button> </>} />

      {viewing && <RecordPanel title={viewing.name || "Recurring plan"} description="Saved recurring availability." onClose={() => setViewing(null)} actions={<Button disabled={!canEdit} type="button" onClick={() => { void openEditDialog(viewing); setViewing(null) }}>Edit details</Button>}><Section title="Pattern details"><ReadOnlyFields fields={[{label:"Staff",value:viewing.staffName || viewing.staffEmail},{label:"Cycle weeks",value:viewing.cycleLengthWeeks},{label:"Valid from",value:formatDate(viewing.validFrom)},{label:"Valid to",value:viewing.validTo?formatDate(viewing.validTo):"Open ended"},{label:"Status",value:viewing.isActive?"Active":"Inactive"},{label:"Effective now",value:viewing.isCurrentlyEffective?"Yes":"No"}]} /></Section><RecurringPlanSummary key={viewing.id} id={viewing.id} /></RecordPanel>}
      <Surface>
      <TableToolbar table={table} showSearch={false}>
        <Input
          className="max-w-sm"
          aria-label="Search pattern or staff" placeholder="Search pattern or staff"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as "all" | "active" | "inactive")}
        >
          <option value="all">All status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
        <Filters activeCount={Number(staffFilter !== "all") + Number(Boolean(effectiveOn))} onReset={() => { setStaffFilter("all"); setEffectiveOn("") }}>
        <Select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={staffFilter}
          onValueChange={(value) => setStaffFilter(value)}
        >
          <option value="all">All staff</option>
          {staffOptions.map((staff) => (
            <option key={staff.id} value={staff.id}>
              {staff.name?.trim() || staff.email}
            </option>
          ))}
        </Select>
        <Input
          type="date" aria-label="Effective on"
          className="w-[170px]"
          value={effectiveOn}
          onChange={(event) => setEffectiveOn(event.target.value)}
        />
        </Filters>
      </TableToolbar>

      <DataTable table={table} loading={loading} emptyMessage="No recurring plans found." />
      <TablePagination table={table} totalRows={totalRows} />
      </Surface>

      {canCreate && createOpen && <DraftPanel title="New recurring plan" description="Configure repeating availability, then review the impact before saving." fingerprint={{staffId:createStaffId,name:createName,validFrom:createValidFrom,validTo:createValidTo,cycle:createCycleLength,weeks:createDraftWeeks}} saving={actionLoading || previewLoading} error={formError} saveLabel="Create pattern" onClose={() => setCreateOpen(false)} onSubmit={() => void createPattern()} ><div className="space-y-5"><Section title="Pattern details"><div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Staff</Label>
              <Select aria-label="Staff"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={createStaffId}
                onValueChange={(value) => setCreateStaffId(value)}
              >
                <option value="">Select staff</option>
                {staffOptions
                  .filter((staff) => staff.staffProfile?.schedulingMode === "FLEXIBLE")
                  .map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.name?.trim() || staff.email}
                    </option>
                  ))}
              </Select>
            </div>
<div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Pattern name</Label>
              <Input aria-label="Pattern name"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="Optional pattern name"
              />
            </div>
<div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Valid from</Label>
                <Input aria-label="Valid from"
                  type="date"
                  value={createValidFrom}
                  onChange={(event) => setCreateValidFrom(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Valid to</Label>
                <Input aria-label="Valid to"
                  type="date"
                  value={createValidTo}
                  onChange={(event) => setCreateValidTo(event.target.value)}
                />
              </div>
            </div>
<div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Cycle weeks</Label>
                <Input aria-label="Cycle weeks"
                  type="number"
                  min={1}
                  max={12}
                  value={createCycleLength}
                  onChange={(event) => {
                    const nextLength = Math.max(1, Math.min(12, Number(event.target.value) || 1))
                    setCreateCycleLength(nextLength)
                    setCreateDraftWeeks((prev) => {
                      const next = [...prev]
                      if (next.length < nextLength) {
                        for (let index = next.length; index < nextLength; index += 1) {
                          next.push({
                            weekIndex: index + 1,
                            days: WEEKDAY_ORDER.map((day) => createEmptyDraftDay(day)),
                          })
                        }
                      }
                      if (next.length > nextLength) {
                        next.splice(nextLength)
                      }
                      return next.map((week, index) => ({ ...week, weekIndex: index + 1 }))
                    })
                    setCreateSelectedWeekIndex((prev) => Math.min(prev, nextLength))
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Editing week</Label>
                <Select aria-label="Editing week"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={createSelectedWeekIndex}
                  onValueChange={(value) => setCreateSelectedWeekIndex(Number(value) || 1)}
                >
                  {Array.from({ length: createCycleLength }, (_, index) => (
                    <option key={`create-week-${index + 1}`} value={index + 1}>
                      Week {index + 1}
                    </option>
                  ))}
                </Select>
              </div>
            </div></Section><Section title="Weekly availability"><div className="space-y-3">
              {createCurrentDays.map((day) => (
                <div key={day.day} className="rounded-md border p-2">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-medium">{day.day}</div>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={day.isOff}
                        onChange={(event) => setCreateDayOff(day.day, event.target.checked)}
                      />
                      Off
                    </label>
                  </div>
                  {day.isOff ? null : (
                    <div className="space-y-2">
                      {day.slots.map((slot, slotIndex) => (
                        <div key={`${day.day}-create-slot-${slotIndex}`} className="rounded border p-2">
                          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                            <div>
                              <Label className="text-[10px] text-muted-foreground">Start</Label>
                              <TimePicker
                                value={slot.startTime}
                                onChange={(value) => updateCreateSlot(day.day, slotIndex, { startTime: value })}
                              />
                            </div>
                            <div>
                              <Label className="text-[10px] text-muted-foreground">End</Label>
                              <TimePicker
                                value={slot.endTime}
                                onChange={(value) => updateCreateSlot(day.day, slotIndex, { endTime: value })}
                              />
                            </div>
                            <div className="flex items-end">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => removeCreateSlot(day.day, slotIndex)}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                          <div className="mt-2 space-y-2">
                            {slot.breaks.map((slotBreak, breakIndex) => (
                              <div
                                key={`${day.day}-create-slot-${slotIndex}-break-${breakIndex}`}
                                className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                              >
                                <div>
                                  <Label className="text-[10px] text-muted-foreground">Break start</Label>
                                  <TimePicker
                                    value={slotBreak.startTime}
                                    onChange={(value) =>
                                      updateCreateBreak(day.day, slotIndex, breakIndex, { startTime: value })
                                    }
                                  />
                                </div>
                                <div>
                                  <Label className="text-[10px] text-muted-foreground">Break end</Label>
                                  <TimePicker
                                    value={slotBreak.endTime}
                                    onChange={(value) =>
                                      updateCreateBreak(day.day, slotIndex, breakIndex, { endTime: value })
                                    }
                                  />
                                </div>
                                <div className="flex items-end">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => removeCreateBreak(day.day, slotIndex, breakIndex)}
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
                              onClick={() => addCreateBreak(day.day, slotIndex)}
                            >
                              Add break
                            </Button>
                          </div>
                        </div>
                      ))}
                      <Button type="button" variant="outline" size="sm" onClick={() => addCreateSlot(day.day)}>
                        Add slot
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div></Section></div></DraftPanel>}

      {editOpen && !editLoading && <DraftPanel title="Edit recurring plan" description="Configure repeating availability, then review the impact before saving." fingerprint={{staffId:editStaffId,name:editName,validFrom:editValidFrom,validTo:editValidTo,cycle:editCycleLength,weeks:editDraftWeeks}} saving={actionLoading || previewLoading} error={formError} saveLabel="Save changes" onClose={() => setEditOpen(false)} onSubmit={() => void saveEditPattern()} footerActions={<Button type="button" variant="outline" disabled={actionLoading || previewLoading} onClick={() => void previewEditImpact()}>Preview impact</Button>}>{editLoading ? (
            <div className="py-8 text-sm text-muted-foreground">Loading pattern details...</div>
          ) : (
            <div className="space-y-5"><Section title="Pattern details"><div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Staff</Label>
                <Select aria-label="Staff"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={editStaffId}
                  onValueChange={(value) => setEditStaffId(value)}
                  disabled
                >
                  <option value="">Select staff</option>
                  {staffOptions
                    .filter((staff) => staff.staffProfile?.schedulingMode === "FLEXIBLE")
                    .map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.name?.trim() || staff.email}
                      </option>
                    ))}
                </Select>
              </div>
<div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Pattern name</Label>
                <Input aria-label="Pattern name"
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  placeholder="Optional pattern name"
                />
              </div>
<div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Valid from</Label>
                  <Input aria-label="Valid from"
                    type="date"
                    value={editValidFrom}
                    onChange={(event) => setEditValidFrom(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Valid to</Label>
                  <Input aria-label="Valid to"
                    type="date"
                    value={editValidTo}
                    onChange={(event) => setEditValidTo(event.target.value)}
                  />
                </div>
              </div>
<div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Cycle weeks</Label>
                  <Input aria-label="Cycle weeks"
                    type="number"
                    min={1}
                    max={12}
                    value={editCycleLength}
                    onChange={(event) => {
                      const nextLength = Math.max(1, Math.min(12, Number(event.target.value) || 1))
                      setEditCycleLength(nextLength)
                      setEditDraftWeeks((prev) => {
                        const next = [...prev]
                        if (next.length < nextLength) {
                          for (let index = next.length; index < nextLength; index += 1) {
                            next.push({
                              weekIndex: index + 1,
                              days: WEEKDAY_ORDER.map((day) => createEmptyDraftDay(day)),
                            })
                          }
                        }
                        if (next.length > nextLength) {
                          next.splice(nextLength)
                        }
                        return next.map((week, index) => ({ ...week, weekIndex: index + 1 }))
                      })
                      setEditSelectedWeekIndex((prev) => Math.min(prev, nextLength))
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Editing week</Label>
                  <Select aria-label="Editing week"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={editSelectedWeekIndex}
                    onValueChange={(value) => setEditSelectedWeekIndex(Number(value) || 1)}
                  >
                    {Array.from({ length: editCycleLength }, (_, index) => (
                      <option key={`edit-week-${index + 1}`} value={index + 1}>
                        Week {index + 1}
                      </option>
                    ))}
                  </Select>
                </div>
              </div></Section><Section title="Weekly availability"><div className="space-y-3">
                {editCurrentDays.map((day) => (
                  <div key={day.day} className="rounded-md border p-2">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-medium">{day.day}</div>
                      <label className="flex items-center gap-2 text-xs">
                        <Checkbox
                          checked={day.isOff}
                          onChange={(event) => setEditDayOff(day.day, event.target.checked)}
                        />
                        Off
                      </label>
                    </div>
                    {day.isOff ? null : (
                      <div className="space-y-2">
                        {day.slots.map((slot, slotIndex) => (
                          <div key={`${day.day}-edit-slot-${slotIndex}`} className="rounded border p-2">
                            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                              <div>
                                <Label className="text-[10px] text-muted-foreground">Start</Label>
                                <TimePicker
                                  value={slot.startTime}
                                  onChange={(value) => updateEditSlot(day.day, slotIndex, { startTime: value })}
                                />
                              </div>
                              <div>
                                <Label className="text-[10px] text-muted-foreground">End</Label>
                                <TimePicker
                                  value={slot.endTime}
                                  onChange={(value) => updateEditSlot(day.day, slotIndex, { endTime: value })}
                                />
                              </div>
                              <div className="flex items-end">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => removeEditSlot(day.day, slotIndex)}
                                >
                                  Remove
                                </Button>
                              </div>
                            </div>
                            <div className="mt-2 space-y-2">
                              {slot.breaks.map((slotBreak, breakIndex) => (
                                <div
                                  key={`${day.day}-edit-slot-${slotIndex}-break-${breakIndex}`}
                                  className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                                >
                                  <div>
                                    <Label className="text-[10px] text-muted-foreground">Break start</Label>
                                    <TimePicker
                                      value={slotBreak.startTime}
                                      onChange={(value) =>
                                        updateEditBreak(day.day, slotIndex, breakIndex, { startTime: value })
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-[10px] text-muted-foreground">Break end</Label>
                                    <TimePicker
                                      value={slotBreak.endTime}
                                      onChange={(value) =>
                                        updateEditBreak(day.day, slotIndex, breakIndex, { endTime: value })
                                      }
                                    />
                                  </div>
                                  <div className="flex items-end">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => removeEditBreak(day.day, slotIndex, breakIndex)}
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
                                onClick={() => addEditBreak(day.day, slotIndex)}
                              >
                                Add break
                              </Button>
                            </div>
                          </div>
                        ))}
                        <Button type="button" variant="outline" size="sm" onClick={() => addEditSlot(day.day)}>
                          Add slot
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div></Section>{editPreview ? (
                <div className="space-y-2 rounded-md border p-3 text-sm">
                  <div className="font-medium">Impact preview</div>
                  <div className="text-muted-foreground">
                    Window: {formatDate(editPreview.window.startDate)} -{" "}
                    {editPreview.window.endDate
                      ? formatDate(editPreview.window.endDate)
                      : "Open ended"}
                    {editPreview.window.truncatedAt
                      ? ` (previewed up to ${formatDate(editPreview.window.truncatedAt)})`
                      : ""}
                  </div>
                  <div>Estimated available hours in window: {editPreview.estimatedBookedHoursInWindow}</div>
                  <div>Active appointments in window: {editPreview.affectedAppointmentsCount}</div>
                  <div>Overlapping active patterns: {editPreview.overlappingActivePatternsCount}</div>
                  {editPreview.notes.map((note) => (
                    <div key={note} className="text-xs text-muted-foreground">
                      - {note}
                    </div>
                  ))}
                </div>
              ) : null}</div>
          )}</DraftPanel>}

      <Dialog
        open={Boolean(deactivateTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeactivateTarget(null)
            setDeactivatePreview(null)
          }
        }}
      >
        <ActionDialogContent title={<>Deactivate recurring pattern?</>} description={<>This will stop applying this pattern to roster/availability for future dates in its validity window.
            </>} className="sm:max-w-md" actions={<> <Button type="button"
              variant="outline"
              onClick={() => {
                setDeactivateTarget(null)
                setDeactivatePreview(null)
              }}
              disabled={actionLoading || previewLoading}
            >
              Cancel
            </Button><Button type="button" variant="outline" onClick={previewDeactivateImpact} disabled={actionLoading || previewLoading}>
              {previewLoading ? "Previewing..." : "Preview impact"}
            </Button><Button type="button" variant="destructive" onClick={deactivatePattern} disabled={actionLoading || previewLoading}>
              Deactivate
            </Button> </>}>{deactivateTarget ? (
            <div className="rounded-md border p-3 text-sm">
              <div className="font-medium">{deactivateTarget.name?.trim() || "Untitled pattern"}</div>
              <div className="text-muted-foreground">{deactivateTarget.staffName || deactivateTarget.staffEmail}</div>
            </div>
          ) : null}{deactivatePreview ? (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <div className="font-medium">Impact preview</div>
              <div className="text-muted-foreground">
                Window: {formatDate(deactivatePreview.window.startDate)} -{" "}
                {deactivatePreview.window.endDate
                  ? formatDate(deactivatePreview.window.endDate)
                  : "Open ended"}
                {deactivatePreview.window.truncatedAt
                  ? ` (previewed up to ${formatDate(deactivatePreview.window.truncatedAt)})`
                  : ""}
              </div>
              <div>Estimated available hours in window: {deactivatePreview.estimatedBookedHoursInWindow}</div>
              <div>Active appointments in window: {deactivatePreview.affectedAppointmentsCount}</div>
              {deactivatePreview.notes.map((note) => (
                <div key={note} className="text-xs text-muted-foreground">
                  - {note}
                </div>
              ))}
            </div>
          ) : null}</ActionDialogContent>
      </Dialog>

      <Dialog
        open={Boolean(cloneTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setCloneTarget(null)
            setClonePreview(null)
          }
        }}
      >
        <ActionDialogContent title={<>Clone recurring pattern</>} description={<>Create a new version from this pattern with a new validity range.
            </>} className="sm:max-w-md" actions={<> <Button type="button"
              variant="outline"
              onClick={() => {
                setCloneTarget(null)
                setClonePreview(null)
              }}
              disabled={actionLoading || previewLoading}
            >
              Cancel
            </Button><Button type="button" variant="outline" onClick={previewCloneImpact} disabled={actionLoading || previewLoading}>
              {previewLoading ? "Previewing..." : "Preview impact"}
            </Button><Button type="button" onClick={clonePattern} disabled={actionLoading || previewLoading}>
              Create clone
            </Button> </>}><div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Name</label>
              <Input aria-label="Name"
                value={cloneName}
                onChange={(event) => setCloneName(event.target.value)}
                placeholder="Optional pattern name"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Valid from</label>
                <Input aria-label="Valid from"
                  type="date"
                  value={cloneValidFrom}
                  onChange={(event) => setCloneValidFrom(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Valid to</label>
                <Input aria-label="Valid to"
                  type="date"
                  value={cloneValidTo}
                  onChange={(event) => setCloneValidTo(event.target.value)}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={cloneActivate}
                onChange={(event) => setCloneActivate(event.target.checked)}
              />
              Activate cloned pattern now
            </label>
            {clonePreview ? (
              <div className="space-y-2 rounded-md border p-3 text-sm">
                <div className="font-medium">Impact preview</div>
                <div className="text-muted-foreground">
                  Window: {formatDate(clonePreview.window.startDate)} -{" "}
                  {clonePreview.window.endDate
                    ? formatDate(clonePreview.window.endDate)
                    : "Open ended"}
                  {clonePreview.window.truncatedAt
                    ? ` (previewed up to ${formatDate(clonePreview.window.truncatedAt)})`
                    : ""}
                </div>
                <div>Estimated available hours in window: {clonePreview.estimatedBookedHoursInWindow}</div>
                <div>Active appointments in window: {clonePreview.affectedAppointmentsCount}</div>
                <div>Overlapping active patterns: {clonePreview.overlappingActivePatternsCount}</div>
                {clonePreview.notes.map((note) => (
                  <div key={note} className="text-xs text-muted-foreground">
                    - {note}
                  </div>
                ))}
              </div>
            ) : null}
          </div></ActionDialogContent>
      </Dialog>

      <Dialog
        open={Boolean(assignTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setAssignTarget(null)
            setAssignPreview(null)
          }
        }}
      >
        <ActionDialogContent title={<>Assign recurring pattern</>} description={<>Assign this recurring pattern to a staff member in this tenant.
            </>} className="sm:max-w-md" actions={<> <Button type="button"
              variant="outline"
              onClick={() => {
                setAssignTarget(null)
                setAssignPreview(null)
              }}
              disabled={actionLoading || previewLoading}
            >
              Cancel
            </Button><Button type="button" variant="outline" onClick={previewAssignImpact} disabled={actionLoading || previewLoading}>
              {previewLoading ? "Previewing..." : "Preview impact"}
            </Button><Button type="button" onClick={assignPattern} disabled={actionLoading || previewLoading}>
              Assign pattern
            </Button> </>}><div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Target staff</label>
              <Select aria-label="Target staff"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={assignStaffId}
                onValueChange={(value) => setAssignStaffId(value)}
              >
                <option value="">Select staff</option>
                {staffOptions.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.name?.trim() || staff.email}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Pattern name</label>
              <Input aria-label="Pattern name"
                value={assignName}
                onChange={(event) => setAssignName(event.target.value)}
                placeholder="Optional pattern name"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Valid from</label>
                <Input aria-label="Valid from"
                  type="date"
                  value={assignValidFrom}
                  onChange={(event) => setAssignValidFrom(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Valid to</label>
                <Input aria-label="Valid to"
                  type="date"
                  value={assignValidTo}
                  onChange={(event) => setAssignValidTo(event.target.value)}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={assignActivate}
                onChange={(event) => setAssignActivate(event.target.checked)}
              />
              Activate assigned pattern now
            </label>
            {assignPreview ? (
              <div className="space-y-2 rounded-md border p-3 text-sm">
                <div className="font-medium">Impact preview</div>
                <div className="text-muted-foreground">
                  Window: {formatDate(assignPreview.window.startDate)} -{" "}
                  {assignPreview.window.endDate
                    ? formatDate(assignPreview.window.endDate)
                    : "Open ended"}
                  {assignPreview.window.truncatedAt
                    ? ` (previewed up to ${formatDate(assignPreview.window.truncatedAt)})`
                    : ""}
                </div>
                <div>Estimated available hours in window: {assignPreview.estimatedBookedHoursInWindow}</div>
                <div>Active appointments in window: {assignPreview.affectedAppointmentsCount}</div>
                <div>Overlapping active patterns: {assignPreview.overlappingActivePatternsCount}</div>
                {assignPreview.notes.map((note) => (
                  <div key={note} className="text-xs text-muted-foreground">
                    - {note}
                  </div>
                ))}
              </div>
            ) : null}
          </div></ActionDialogContent>
      </Dialog>
    </div>
  )
}
