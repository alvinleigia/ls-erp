"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  ColumnDef,
  SortingState,
  VisibilityState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import type { ScheduleComponent } from "@syncfusion/ej2-react-schedule"
import { Calendar, CalendarUnavailable } from "@/components/calendar"
import { calendarViewsEnabled } from "@/lib/calendar-features"
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, MoreHorizontalIcon } from "lucide-react"
import { toast } from "sonner"

import { DataTable, DataTablePagination, DataTableToolbar } from "@/components/data-table"
import { DateRangePicker } from "@/components/date-range-picker"
import { SearchableSelect } from "@/components/searchable-select"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useFormErrors } from "@/hooks/use-form-errors"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { weekdayToSchedulerFirstDay } from "@/lib/formatting"
import { cn } from "@/lib/utils"
import type { ListResponse } from "@/types/api"
import type { DateRange } from "react-day-picker"
import type {
  AppointmentAvailabilityResult,
  AppointmentCustomerOption,
  AppointmentFormValues,
  AppointmentRow,
  AppointmentServiceOption,
  AppointmentStaffOption,
  AppointmentStatus,
} from "@/types/appointments"
import type { AppSettingsPayload } from "@/types/scheduling"
import { AppointmentFormFields } from "./appointment-form-fields"
import {
  buildEndTimePreview,
  combineLocalDateTimeToISO,
  defaultAppointmentFormValues,
} from "./appointment-form-model"

type PaginationState = { pageIndex: number; pageSize: number }

type CalendarEvent = {
  Id: string
  Subject: string
  StartTime: Date
  EndTime: Date
  Status: AppointmentStatus
  CategoryColor?: string
}

type AppointmentQuickInfo = {
  lines: Array<{
    service: string
    attendant: string
    quantity: number
    lineTotalCents: number | null
  }>
  subtotalCents: number | null
  discountCents: number | null
  taxCents: number | null
  totalCents: number | null
}

const APPOINTMENT_STATUS_OPTIONS: Array<AppointmentStatus | "all"> = [
  "all",
  "SCHEDULED",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELED",
  "NO_SHOW",
]

const STATUS_COLORS: Record<AppointmentStatus, string> = {
  SCHEDULED: "#0ea5e9",
  CONFIRMED: "#22c55e",
  IN_PROGRESS: "#f59e0b",
  COMPLETED: "#64748b",
  CANCELED: "#ef4444",
  NO_SHOW: "#e11d48",
}

const canRescheduleAppointment = (status: AppointmentStatus) =>
  status === "SCHEDULED" || status === "CONFIRMED"

const canCancelAppointment = (status: AppointmentStatus) =>
  status === "SCHEDULED" || status === "CONFIRMED" || status === "IN_PROGRESS"

const canEditAppointment = (status: AppointmentStatus) =>
  status === "SCHEDULED" || status === "CONFIRMED"

const STATUS_BADGE_CLASS: Record<AppointmentStatus, string> = {
  SCHEDULED: "bg-sky-500/15 text-sky-800 dark:text-sky-300 border-sky-500/30",
  CONFIRMED: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
  IN_PROGRESS: "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30",
  COMPLETED: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
  CANCELED: "bg-rose-500/15 text-rose-800 dark:text-rose-300 border-rose-500/30",
  NO_SHOW: "bg-pink-500/15 text-pink-800 dark:text-pink-300 border-pink-500/30",
}

const APPOINTMENT_STATUS_META: Record<AppointmentStatus, { label: string; helperText: string }> = {
  SCHEDULED: {
    label: "Scheduled",
    helperText: "Scheduled and awaiting confirmation or service start.",
  },
  CONFIRMED: {
    label: "Confirmed",
    helperText: "Confirmed and ready for service.",
  },
  IN_PROGRESS: {
    label: "In progress",
    helperText: "Service is currently underway.",
  },
  COMPLETED: {
    label: "Completed",
    helperText: "Service has been completed.",
  },
  CANCELED: {
    label: "Canceled",
    helperText: "Appointment was canceled.",
  },
  NO_SHOW: {
    label: "No show",
    helperText: "Customer did not attend.",
  },
}

const SortIndicator = ({ value }: { value: false | "asc" | "desc" }) => {
  if (value === "asc") return <ArrowUpIcon className="h-4 w-4" />
  if (value === "desc") return <ArrowDownIcon className="h-4 w-4" />
  return <ArrowUpDownIcon className="h-4 w-4" />
}

const toDateInput = (value: Date) => {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const toMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map((part) => Number(part))
  return (Number.isNaN(hours) ? 0 : hours) * 60 + (Number.isNaN(minutes) ? 0 : minutes)
}

const minutesToTime = (value: number) => {
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

export default function AppointmentsPage() {
  const router = useRouter()
  const { formatDate } = useDateFormatter()
  const scheduleRef = React.useRef<ScheduleComponent | null>(null)

  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [appointments, setAppointments] = React.useState<AppointmentRow[]>([])
  const [calendarAppointments, setCalendarAppointments] = React.useState<AppointmentRow[]>([])
  const [customers, setCustomers] = React.useState<AppointmentCustomerOption[]>([])
  const [staff, setStaff] = React.useState<AppointmentStaffOption[]>([])
  const [services, setServices] = React.useState<AppointmentServiceOption[]>([])
  const [firstDayOfWeek, setFirstDayOfWeek] = React.useState(0)
  const [timeFormat, setTimeFormat] = React.useState<AppSettingsPayload["timeFormat"]>("H24")
  const [currency, setCurrency] = React.useState("USD")
  const [calendarHourMode, setCalendarHourMode] = React.useState<"working" | "full">("working")
  const [calendarStatusFilter, setCalendarStatusFilter] = React.useState<
    "non_canceled" | "all" | AppointmentStatus
  >("non_canceled")
  const [workingHourBounds, setWorkingHourBounds] = React.useState({
    startHour: "09:00",
    endHour: "18:00",
  })
  const [totalRows, setTotalRows] = React.useState(0)

  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<AppointmentStatus | "all">("all")
  const [staffFilter, setStaffFilter] = React.useState<string>("all")
  const [dateRangeFilter, setDateRangeFilter] = React.useState<DateRange | undefined>(undefined)
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({
    customer: true,
    service: true,
    staff: true,
    startAt: true,
    status: true,
  })
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })

  const [viewDates, setViewDates] = React.useState<Date[]>([])
  const [formOpen, setFormOpen] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [formMode, setFormMode] = React.useState<"create" | "edit" | "reschedule">("create")
  const [cancelConfirmOpen, setCancelConfirmOpen] = React.useState(false)
  const [cancelTarget, setCancelTarget] = React.useState<AppointmentRow | null>(null)
  const [formValues, setFormValues] = React.useState<AppointmentFormValues>(
    defaultAppointmentFormValues()
  )
  const [availabilityChecking, setAvailabilityChecking] = React.useState(false)
  const [availability, setAvailability] = React.useState<AppointmentAvailabilityResult | null>(
    null
  )
  const [quickInfoOpen, setQuickInfoOpen] = React.useState(false)
  const [quickInfoTarget, setQuickInfoTarget] = React.useState<AppointmentRow | null>(null)
  const [quickInfoData, setQuickInfoData] = React.useState<AppointmentQuickInfo | null>(null)
  const [quickInfoLoading, setQuickInfoLoading] = React.useState(false)
  const quickInfoStart = React.useMemo(
    () => (quickInfoTarget ? new Date(quickInfoTarget.startAt) : null),
    [quickInfoTarget]
  )
  const quickInfoEnd = React.useMemo(
    () => (quickInfoTarget ? new Date(quickInfoTarget.endAt) : null),
    [quickInfoTarget]
  )
  const quickInfoDateLabel = React.useMemo(() => {
    if (!quickInfoStart) return "-"
    return quickInfoStart.toLocaleDateString(undefined, {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
  }, [quickInfoStart])
  const quickInfoTimeLabel = React.useMemo(() => {
    if (!quickInfoStart || !quickInfoEnd) return "-"
    const startLabel = quickInfoStart.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    })
    const endLabel = quickInfoEnd.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    })
    return `${startLabel} - ${endLabel}`
  }, [quickInfoEnd, quickInfoStart])
  const formatMoney = React.useCallback(
    (cents: number | null) => {
      if (cents === null) return "-"
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
      }).format(cents / 100)
    },
    [currency]
  )

  const {
    errors,
    setErrorsFromResponse,
    clearErrors,
  } = useFormErrors()

  const totalPages = Math.max(1, Math.ceil(totalRows / pagination.pageSize))
  const startDateFilter = dateRangeFilter?.from ? toDateInput(dateRangeFilter.from) : ""
  const endDateFilter = dateRangeFilter?.to ? toDateInput(dateRangeFilter.to) : ""
  const selectedService = React.useMemo(
    () => services.find((service) => service.id === formValues.serviceId),
    [formValues.serviceId, services]
  )
  const endTimePreview = React.useMemo(
    () =>
      buildEndTimePreview(
        formValues.date,
        formValues.startTime,
        selectedService?.durationMinutes,
        { timeFormat }
      ),
    [formValues.date, formValues.startTime, selectedService?.durationMinutes, timeFormat]
  )

  const loadLookups = React.useCallback(async () => {
    const [customerRes, staffRes, serviceRes, settingsRes] = await Promise.all([
      fetch("/api/users?role=CUSTOMER&status=ACTIVE&page=1&pageSize=100", { cache: "no-store" }),
      fetch("/api/users?role=STAFF&status=ACTIVE&page=1&pageSize=100", { cache: "no-store" }),
      fetch("/api/services?status=ACTIVE&page=1&pageSize=100&sort=name&order=asc", {
        cache: "no-store",
      }),
      fetch("/api/settings", { cache: "no-store" }),
    ])

    if (customerRes.ok) {
      const data = (await customerRes.json()) as {
        items?: Array<{ id: string; name: string | null; email: string }>
      }
      setCustomers(data.items ?? [])
    }

    if (staffRes.ok) {
      const data = (await staffRes.json()) as {
        items?: Array<{ id: string; name: string | null; email: string }>
      }
      setStaff(data.items ?? [])
    }

    if (serviceRes.ok) {
      const data = (await serviceRes.json()) as {
        items?: Array<{ id: string; name: string; durationMinutes: number }>
      }
      setServices(data.items ?? [])
    }

    if (settingsRes.ok) {
      const data = (await settingsRes.json()) as { settings?: AppSettingsPayload }
      setFirstDayOfWeek(weekdayToSchedulerFirstDay(data.settings?.firstDayOfWeek))
      setTimeFormat(data.settings?.timeFormat ?? "H24")
      setCurrency(data.settings?.currency ?? "USD")
      const workingPeriods =
        data.settings?.workingHours
          ?.flatMap((day) =>
            day.isOpen
              ? (day.periods ?? []).filter((period) => period.kind === "WORK")
              : []
          ) ?? []
      if (workingPeriods.length) {
        const start = Math.min(...workingPeriods.map((period) => toMinutes(period.startTime)))
        const end = Math.max(...workingPeriods.map((period) => toMinutes(period.endTime)))
        if (end > start) {
          setWorkingHourBounds({
            startHour: minutesToTime(start),
            endHour: minutesToTime(end),
          })
        }
      }
    }
  }, [])

  const loadAppointments = React.useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set("page", String(pagination.pageIndex + 1))
    params.set("pageSize", String(pagination.pageSize))
    if (search.trim()) params.set("q", search.trim())
    if (statusFilter !== "all") params.set("status", statusFilter)
    if (staffFilter !== "all") params.set("staffId", staffFilter)
    if (startDateFilter) params.set("startDate", startDateFilter)
    if (endDateFilter) params.set("endDate", endDateFilter)
    if (sorting[0]) {
      params.set("sort", sorting[0].id)
      params.set("order", sorting[0].desc ? "desc" : "asc")
    }

    const response = await fetch(`/api/appointments?${params.toString()}`, {
      cache: "no-store",
    })
    if (!response.ok) {
      toast.error("Unable to load appointments.")
      setAppointments([])
      setTotalRows(0)
      setLoading(false)
      return
    }
    const data = (await response.json()) as ListResponse<AppointmentRow>
    setAppointments(data.items)
    setTotalRows(data.total)
    setLoading(false)
  }, [
    endDateFilter,
    pagination.pageIndex,
    pagination.pageSize,
    search,
    sorting,
    staffFilter,
    startDateFilter,
    statusFilter,
  ])

  const loadCalendarAppointments = React.useCallback(async () => {
    const fallbackDates = scheduleRef.current?.getCurrentViewDates?.() ?? []
    const effectiveViewDates = viewDates.length ? viewDates : fallbackDates
    if (!effectiveViewDates.length) return

    if (!viewDates.length && fallbackDates.length) {
      setViewDates(fallbackDates)
    }

    const startDate = toDateInput(effectiveViewDates[0])
    const endDate = toDateInput(effectiveViewDates[effectiveViewDates.length - 1])
    const params = new URLSearchParams()
    params.set("page", "1")
    params.set("pageSize", "100")
    params.set("startDate", startDate)
    params.set("endDate", endDate)
    if (calendarStatusFilter !== "all" && calendarStatusFilter !== "non_canceled") {
      params.set("status", calendarStatusFilter)
    }
    if (staffFilter !== "all") params.set("staffId", staffFilter)

    const response = await fetch(`/api/appointments?${params.toString()}`, {
      cache: "no-store",
    })
    if (!response.ok) {
      toast.error("Unable to load calendar appointments.")
      setCalendarAppointments([])
      return
    }
    const data = (await response.json()) as ListResponse<AppointmentRow>
    if (calendarStatusFilter === "non_canceled") {
      setCalendarAppointments(data.items.filter((item) => item.status !== "CANCELED"))
      return
    }
    setCalendarAppointments(data.items)
  }, [calendarStatusFilter, staffFilter, viewDates])

  React.useEffect(() => {
    void loadLookups()
  }, [loadLookups])

  React.useEffect(() => {
    void loadAppointments()
  }, [loadAppointments])

  React.useEffect(() => {
    void loadCalendarAppointments()
  }, [loadCalendarAppointments])

  React.useEffect(() => {
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }))
  }, [endDateFilter, search, sorting, staffFilter, startDateFilter, statusFilter])

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

  const openCreateDialog = React.useCallback(
    (seedDate?: Date) => {
      const base = defaultAppointmentFormValues()
      if (seedDate) {
        base.date = toDateInput(seedDate)
        base.startTime = "09:00"
      }
      setFormMode("create")
      setEditingId(null)
      setFormValues(base)
      setAvailability(null)
      setAvailabilityChecking(false)
      clearErrors()
      setFormOpen(true)
    },
    [clearErrors]
  )

  const submitForm = React.useCallback(async () => {
    if (!formValues.customerId || !formValues.serviceId || !formValues.staffId) {
      toast.error("Customer, service and staff are required.")
      return
    }
    if (!formValues.date || !formValues.startTime) {
      toast.error("Date and time are required.")
      return
    }
    if (availabilityChecking) {
      toast.error("Checking availability. Please wait.")
      return
    }
    if (availability && !availability.available) {
      toast.error(availability.reason ?? "Selected slot is not available.")
      return
    }

    setSaving(true)
    clearErrors()
    const payload = {
      customerId: formValues.customerId,
      serviceId: formValues.serviceId,
      staffId: formValues.staffId,
      startAt: combineLocalDateTimeToISO(formValues.date, formValues.startTime),
      status: formValues.status,
    }

    const response = await fetch(
      editingId ? `/api/appointments/${editingId}` : "/api/appointments",
      {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    )

    if (!response.ok) {
      const data = (await response.json()) as {
        error?: string
        details?: { fieldErrors?: Record<string, string[]> }
      }
      setErrorsFromResponse(data)
      toast.error(data.error ?? "Unable to save appointment.")
      setSaving(false)
      return
    }

    toast.success(editingId ? "Appointment updated." : "Appointment created.")
    setSaving(false)
    setFormOpen(false)
    await Promise.all([loadAppointments(), loadCalendarAppointments()])
  }, [
    availability,
    availabilityChecking,
    clearErrors,
    editingId,
    formValues,
    loadAppointments,
    loadCalendarAppointments,
    setErrorsFromResponse,
  ])

  React.useEffect(() => {
    if (!formOpen) return
    if (!formValues.staffId || !formValues.serviceId || !formValues.date || !formValues.startTime) {
      setAvailability(null)
      setAvailabilityChecking(false)
      return
    }

    const timer = setTimeout(async () => {
      setAvailabilityChecking(true)
      const response = await fetch("/api/appointments/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointmentId: editingId ?? undefined,
          customerId: formValues.customerId || undefined,
          serviceId: formValues.serviceId,
          staffId: formValues.staffId,
          startAt: combineLocalDateTimeToISO(formValues.date, formValues.startTime),
        }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        setAvailability({
          available: false,
          reason: data.error ?? "Unable to verify slot availability.",
        })
        setAvailabilityChecking(false)
        return
      }
      const data = (await response.json()) as AppointmentAvailabilityResult
      setAvailability(data)
      setAvailabilityChecking(false)
    }, 250)

    return () => {
      clearTimeout(timer)
    }
  }, [editingId, formOpen, formValues])

  const confirmCancelAppointment = React.useCallback(async (appointmentId: string) => {
    setDeleting(true)
    const response = await fetch(`/api/appointments/${appointmentId}`, {
      method: "DELETE",
    })
    if (!response.ok) {
      const data = (await response.json()) as { error?: string }
      toast.error(data.error ?? "Unable to cancel appointment.")
      setDeleting(false)
      return
    }
    toast.success("Appointment canceled.")
    setDeleting(false)
    setCancelConfirmOpen(false)
    setCancelTarget(null)
    setFormOpen(false)
    await Promise.all([loadAppointments(), loadCalendarAppointments()])
  }, [loadAppointments, loadCalendarAppointments])

  const requestCancelAppointment = React.useCallback((appointment: AppointmentRow | null, id?: string) => {
    if (appointment) {
      setCancelTarget(appointment)
    } else if (id) {
      setCancelTarget((prev) =>
        prev?.id === id
          ? prev
          : appointments.find((item) => item.id === id) ?? null
      )
    }
    setCancelConfirmOpen(true)
  }, [appointments])

  const syncViewDates = React.useCallback(() => {
    const dates = scheduleRef.current?.getCurrentViewDates?.() ?? []
    if (dates.length) setViewDates(dates)
  }, [])

  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (!viewDates.length) {
        syncViewDates()
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [syncViewDates, viewDates.length])

  const calendarEvents = React.useMemo<CalendarEvent[]>(
    () =>
      calendarAppointments.map((appointment) => {
        const customerLabel = appointment.customer?.name || appointment.customer?.email || "Customer"
        const serviceLabel = appointment.service?.name || "Service"
        return {
          Id: appointment.id,
          Subject: `${serviceLabel} [${appointment.status}] - ${customerLabel}`,
          StartTime: new Date(appointment.startAt),
          EndTime: new Date(appointment.endAt),
          Status: appointment.status,
          CategoryColor: STATUS_COLORS[appointment.status],
        }
      }),
    [calendarAppointments]
  )

  const handleCellClick = React.useCallback(
    (args: { startTime?: Date }) => {
      if (!(args.startTime instanceof Date)) return
      openCreateDialog(args.startTime)
    },
    [openCreateDialog]
  )

  const openAppointmentEditor = React.useCallback(
    (appointment: AppointmentRow) => {
      const orderId = appointment.orderLine?.order?.id
      if (!orderId) {
        toast.error(
          "Legacy appointment cannot be edited. Cancel it and create a new booking order."
        )
        return
      }
      router.push(`/appointments/${orderId}/edit`)
    },
    [router]
  )

  const loadQuickInfo = React.useCallback(async (appointment: AppointmentRow) => {
    const fallbackService = appointment.service?.name ?? "Service"
    const fallbackAttendant = appointment.staffProfile?.user
      ? appointment.staffProfile.user.name || appointment.staffProfile.user.email
      : "Staff"
    const orderId = appointment.orderLine?.order?.id
    if (!orderId) {
      setQuickInfoData({
        lines: [
          {
            service: fallbackService,
            attendant: fallbackAttendant,
            quantity: 1,
            lineTotalCents: appointment.service?.priceCents ?? null,
          },
        ],
        subtotalCents: appointment.service?.priceCents ?? null,
        discountCents: null,
        taxCents: null,
        totalCents: appointment.service?.priceCents ?? null,
      })
      return
    }

    setQuickInfoLoading(true)
    const response = await fetch(`/api/appointments/orders/${orderId}`, { cache: "no-store" })
    if (!response.ok) {
      setQuickInfoData({
        lines: [
          {
            service: fallbackService,
            attendant: fallbackAttendant,
            quantity: 1,
            lineTotalCents: appointment.service?.priceCents ?? null,
          },
        ],
        subtotalCents: appointment.service?.priceCents ?? null,
        discountCents: null,
        taxCents: null,
        totalCents: appointment.service?.priceCents ?? null,
      })
      setQuickInfoLoading(false)
      return
    }
    const data = (await response.json()) as {
      order?: {
        subtotalCents?: number
        lineDiscountCents?: number
        couponDiscountCents?: number
        taxCents?: number
        totalCents?: number
        lines?: Array<{
          quantity?: number
          lineTotalCents?: number
          service?: { name?: string | null } | null
          staffProfile?: { user?: { name?: string | null; email?: string | null } | null } | null
        }>
      }
    }
    const lines = (data.order?.lines ?? []).map((line) => {
      const user = line.staffProfile?.user
      return {
        service: line.service?.name?.trim() || fallbackService,
        attendant: user?.name?.trim() || user?.email?.trim() || fallbackAttendant,
        quantity: line.quantity ?? 1,
        lineTotalCents:
          typeof line.lineTotalCents === "number" ? line.lineTotalCents : null,
      }
    })
    setQuickInfoData({
      lines: lines.length
        ? lines
        : [
            {
              service: fallbackService,
              attendant: fallbackAttendant,
              quantity: 1,
              lineTotalCents: appointment.service?.priceCents ?? null,
            },
          ],
      subtotalCents:
        typeof data.order?.subtotalCents === "number" ? data.order.subtotalCents : null,
      discountCents:
        typeof data.order?.lineDiscountCents === "number" &&
        typeof data.order?.couponDiscountCents === "number"
          ? data.order.lineDiscountCents + data.order.couponDiscountCents
          : null,
      taxCents: typeof data.order?.taxCents === "number" ? data.order.taxCents : null,
      totalCents: typeof data.order?.totalCents === "number" ? data.order.totalCents : null,
    })
    setQuickInfoLoading(false)
  }, [])

  const handleEventClick = React.useCallback(
    (args: { event?: Record<string, unknown> }) => {
      const eventId = args.event?.Id as string | undefined
      if (!eventId) return
      const appointment = calendarAppointments.find((item) => item.id === eventId)
      if (!appointment) return
      setQuickInfoTarget(appointment)
      setQuickInfoData(null)
      setQuickInfoOpen(true)
      void loadQuickInfo(appointment)
    },
    [calendarAppointments, loadQuickInfo]
  )

  const openQuickInfoDialog = React.useCallback((appointment: AppointmentRow) => {
    setQuickInfoTarget(appointment)
    setQuickInfoData(null)
    setQuickInfoOpen(true)
    void loadQuickInfo(appointment)
  }, [loadQuickInfo])

  const handleEventRendered = React.useCallback(
    (args: { data?: Record<string, unknown>; element?: HTMLElement }) => {
      const color = args.data?.CategoryColor as string | undefined
      const status = args.data?.Status as AppointmentStatus | undefined
      if (color && args.element) {
        args.element.style.backgroundColor = color
        args.element.style.borderColor = color
        args.element.style.color = "#ffffff"
        if (status === "CANCELED") {
          args.element.style.opacity = "0.6"
          args.element.style.textDecoration = "line-through"
        } else if (status === "COMPLETED") {
          args.element.style.opacity = "0.85"
        } else {
          args.element.style.opacity = "1"
          args.element.style.textDecoration = "none"
        }
      }
    },
    []
  )

  const columns = React.useMemo<ColumnDef<AppointmentRow>[]>(
    () => [
      {
        id: "customer",
        meta: { label: "Customer" },
        header: "Customer",
        accessorFn: (row) => row.customer?.name || row.customer?.email || "-",
      },
      {
        id: "service",
        meta: { label: "Service" },
        header: "Service",
        accessorFn: (row) => row.service?.name || "-",
      },
      {
        id: "staff",
        meta: { label: "Staff" },
        header: "Staff",
        accessorFn: (row) => row.staffProfile?.user?.name || row.staffProfile?.user?.email || "-",
      },
      {
        id: "order",
        meta: { label: "Order" },
        header: "Order",
        cell: ({ row }) => {
          const order = row.original.orderLine?.order
          if (!order) return "-"
          return `${order.status} (${order.id.slice(-6)})`
        },
      },
      {
        id: "startAt",
        accessorFn: (row) => row.startAt,
        meta: { label: "Start" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Start
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        cell: ({ row }) => formatDate(row.original.startAt),
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        meta: { label: "Status" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Status
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        cell: ({ row }) => (
          <span
            className={cn(
              "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
              STATUS_BADGE_CLASS[row.original.status]
            )}
          >
            {APPOINTMENT_STATUS_META[row.original.status].label}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableHiding: false,
        cell: ({ row }) => {
          const appointment = row.original
          const canEdit = canEditAppointment(appointment.status)
          const canReschedule = canRescheduleAppointment(appointment.status)
          const canCancel = canCancelAppointment(appointment.status)
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost">
                  <MoreHorizontalIcon className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit ? (
                  <DropdownMenuItem onSelect={() => openAppointmentEditor(appointment)}>
                    Edit
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => openQuickInfoDialog(appointment)}>
                    View details
                  </DropdownMenuItem>
                )}
                {canReschedule ? (
                  <DropdownMenuItem onSelect={() => openAppointmentEditor(appointment)}>
                    Reschedule
                  </DropdownMenuItem>
                ) : null}
                {canCancel ? (
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={() => requestCancelAppointment(appointment)}
                  >
                    Cancel appointment
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        },
      },
    ],
    [formatDate, openAppointmentEditor, openQuickInfoDialog, requestCancelAppointment]
  )

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: appointments,
    columns,
    state: { sorting, columnVisibility, pagination, globalFilter: search },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setSearch,
    onPaginationChange: handlePaginationChange,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: totalPages,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Appointments</h1>
          <p className="text-sm text-muted-foreground">
            Manage bookings below or use New appointment to create one.
          </p>
        </div>
        <Button onClick={() => router.push("/appointments/new")}>New appointment</Button>
      </div>

      {calendarViewsEnabled ? <div className="rounded-xl border bg-card p-3 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={calendarStatusFilter}
            onChange={(event) =>
              setCalendarStatusFilter(
                event.target.value as "non_canceled" | "all" | AppointmentStatus
              )
            }
          >
            <option value="non_canceled">Calendar: Active only</option>
            <option value="all">Calendar: All statuses</option>
            {APPOINTMENT_STATUS_OPTIONS.filter((status) => status !== "all").map((status) => (
              <option key={`calendar-${status}`} value={status}>
                Calendar: {status}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            variant={calendarHourMode === "working" ? "default" : "outline"}
            onClick={() => setCalendarHourMode("working")}
          >
            Working hours
          </Button>
          <Button
            type="button"
            size="sm"
            variant={calendarHourMode === "full" ? "default" : "outline"}
            onClick={() => setCalendarHourMode("full")}
          >
            Full day
          </Button>
        </div>
        <Calendar
          scheduleRef={scheduleRef}
          currentView="Week"
          firstDayOfWeek={firstDayOfWeek}
          startHour={calendarHourMode === "full" ? "00:00" : workingHourBounds.startHour}
          endHour={calendarHourMode === "full" ? "24:00" : workingHourBounds.endHour}
          showQuickInfo={false}
          readonly
          allowDragAndDrop={false}
          allowResizing={false}
          eventSettings={{
            dataSource: calendarEvents,
            fields: {
              id: "Id",
              subject: { name: "Subject" },
              startTime: { name: "StartTime" },
              endTime: { name: "EndTime" },
              categoryColor: { name: "CategoryColor" },
            },
          }}
          actionComplete={syncViewDates}
          created={syncViewDates}
          cellClick={handleCellClick}
          eventClick={handleEventClick}
          eventRendered={handleEventRendered}
          height="auto"
          views={["Day", "Week", "Month"]}
        />
      </div> : <CalendarUnavailable />}

      <DataTableToolbar table={table} searchPlaceholder="Search appointments">
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as AppointmentStatus | "all")
          }
        >
          {APPOINTMENT_STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {status === "all" ? "All statuses" : status}
            </option>
          ))}
        </select>
        <div className="w-56">
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
        <div className="flex items-center gap-2">
          <DateRangePicker
            value={dateRangeFilter}
            onChange={(nextValue) => setDateRangeFilter(nextValue)}
            placeholder="Filter by date range"
          />
          <Button
            variant="outline"
            onClick={() => {
              setDateRangeFilter(undefined)
            }}
            disabled={!startDateFilter && !endDateFilter}
          >
            Clear dates
          </Button>
        </div>
      </DataTableToolbar>

      <DataTable table={table} loading={loading} emptyMessage="No appointments found." />
      <DataTablePagination table={table} totalRows={totalRows} />

      <Dialog
        open={quickInfoOpen}
        onOpenChange={(open) => {
          setQuickInfoOpen(open)
          if (!open) {
            setQuickInfoTarget(null)
            setQuickInfoData(null)
            setQuickInfoLoading(false)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Appointment info</DialogTitle>
            <DialogDescription>
              Quick details and actions for this booking.
            </DialogDescription>
          </DialogHeader>
          {quickInfoTarget ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border p-3">
                <p className="font-medium text-base">
                  {quickInfoTarget.customer?.name || quickInfoTarget.customer?.email || "Customer"}
                </p>
                <div className="mt-2 grid gap-1 text-muted-foreground">
                  <p>
                    <span className="font-medium text-foreground">Date:</span> {quickInfoDateLabel}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Time:</span> {quickInfoTimeLabel}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Booking:</span>{" "}
                    {quickInfoTarget.orderLine?.order?.id
                      ? `#${quickInfoTarget.orderLine.order.id.slice(-6)}`
                      : `#${quickInfoTarget.id.slice(-6)}`}
                  </p>
                </div>
                <div className="mt-2">
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
                      STATUS_BADGE_CLASS[quickInfoTarget.status]
                    )}
                  >
                    {APPOINTMENT_STATUS_META[quickInfoTarget.status].label}
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {APPOINTMENT_STATUS_META[quickInfoTarget.status].helperText}
                  </p>
                </div>
              </div>
              <div className="rounded-md border p-3">
                <p className="font-medium">Services and attendants</p>
                {quickInfoLoading ? (
                  <p className="text-muted-foreground">Loading...</p>
                ) : quickInfoData?.lines.length ? (
                  <div className="mt-2 overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="py-1 pr-3 font-medium">Service</th>
                          <th className="py-1 pr-3 font-medium">Attendant</th>
                          <th className="py-1 pr-3 font-medium">Qty</th>
                          <th className="py-1 font-medium">Line total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quickInfoData.lines.map((line, index) => (
                          <tr key={`${line.service}-${line.attendant}-${index}`} className="border-t">
                            <td className="py-1 pr-3">{line.service}</td>
                            <td className="py-1 pr-3">{line.attendant}</td>
                            <td className="py-1 pr-3">{line.quantity}</td>
                            <td className="py-1">{formatMoney(line.lineTotalCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-muted-foreground">-</p>
                )}
              </div>
              <div className="rounded-md border p-3">
                <p className="font-medium">Price summary</p>
                <div className="mt-2 grid grid-cols-2 gap-y-1 text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="text-right">{formatMoney(quickInfoData?.subtotalCents ?? null)}</span>
                  <span>Discount</span>
                  <span className="text-right">{formatMoney(quickInfoData?.discountCents ?? null)}</span>
                  <span>Tax</span>
                  <span className="text-right">{formatMoney(quickInfoData?.taxCents ?? null)}</span>
                  <span className="font-medium text-foreground">Total</span>
                  <span className="text-right font-medium text-foreground">
                    {formatMoney(quickInfoData?.totalCents ?? null)}
                  </span>
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickInfoOpen(false)}>
              Close
            </Button>
            {quickInfoTarget && canCancelAppointment(quickInfoTarget.status) ? (
              <Button
                variant="outline"
                className="text-destructive"
                onClick={() => {
                  setQuickInfoOpen(false)
                  requestCancelAppointment(quickInfoTarget)
                }}
              >
                Cancel appointment
              </Button>
            ) : null}
            {quickInfoTarget ? (
              <Button
                onClick={() => {
                  setQuickInfoOpen(false)
                  openAppointmentEditor(quickInfoTarget)
                }}
                disabled={!quickInfoTarget.orderLine?.order?.id}
              >
                {canEditAppointment(quickInfoTarget.status) ? "Edit booking" : "View booking"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={cancelConfirmOpen}
        onOpenChange={(open) => {
          setCancelConfirmOpen(open)
          if (!open) {
            setCancelTarget(null)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel appointment</DialogTitle>
            <DialogDescription>
              {cancelTarget
                ? `Cancel this appointment for ${cancelTarget.customer?.name || cancelTarget.customer?.email || "the customer"}?`
                : "Cancel this appointment?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCancelConfirmOpen(false)
                setCancelTarget(null)
              }}
              disabled={deleting}
            >
              Keep appointment
            </Button>
            <Button
              variant="destructive"
              onClick={() => (cancelTarget ? void confirmCancelAppointment(cancelTarget.id) : undefined)}
              disabled={deleting || !cancelTarget}
            >
              {deleting ? "Canceling..." : "Confirm cancel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) {
            setEditingId(null)
            setFormMode("create")
            clearErrors()
          }
        }}
      >
        <DialogContent className="max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? formMode === "reschedule"
                  ? "Reschedule appointment"
                  : "Edit appointment"
                : "New appointment"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? formMode === "reschedule"
                  ? "Update date and time for this booking."
                  : "Update appointment details, staff, service, and status."
                : "Use the same booking form whether you open from calendar or button."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <AppointmentFormFields
              values={formValues}
              errors={errors}
              customers={customers}
              services={services}
              staff={staff}
              timeFormat={timeFormat}
              showStatus={Boolean(editingId)}
              disableParticipantFields={formMode === "reschedule"}
              onChange={setFormValues}
            />
            <div className="mt-3 text-xs text-muted-foreground">
              {endTimePreview
                ? `Expected end time: ${endTimePreview}`
                : "Select service, date and start time to calculate end time."}
            </div>
            <div className="mt-3 text-xs">
              {availabilityChecking ? (
                <p className="text-muted-foreground">Checking slot availability...</p>
              ) : availability ? (
                <p className={availability.available ? "text-green-500" : "text-destructive"}>
                  {availability.available
                    ? "Slot available"
                    : availability.reason ?? "Slot unavailable"}
                </p>
              ) : (
                <p className="text-muted-foreground">
                  Select staff, service, date and time to validate availability.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            {editingId && canCancelAppointment(formValues.status) ? (
              <Button
                variant="outline"
                onClick={() => requestCancelAppointment(null, editingId)}
                disabled={deleting}
              >
                {deleting ? "Canceling..." : "Cancel appointment"}
              </Button>
            ) : null}
            <Button
              onClick={submitForm}
              loading={saving}
              loadingText="Saving..."
              disabled={availabilityChecking || availability?.available === false}
            >
              {editingId ? "Save changes" : "Create appointment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
