"use client"
import { useCurrentResourceAction } from "@/platform/access/view-guard"

import { DraftPanel, RecordPanel, ReadOnlyFields } from "@/components/erp/record-detail"
import { Section } from "@/components/erp/section"

import { ActionDialogContent } from "@/components/erp/action-dialog"

import { PageHeader, pageClass, Surface, TableToolbar } from "@/components/erp/page"
import { TablePagination } from "@/components/erp/pagination"

import { Select } from "@/components/erp/controls"

import * as React from "react"
import {
  ColumnDef,
  SortingState,
  VisibilityState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, MoreHorizontalIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/data-table"
import { SearchableSelect } from "@/components/searchable-select"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { useFormErrors } from "@/hooks/use-form-errors"
import { toISODate } from "@/lib/date"
import type { ListResponse } from "@/types/api"
import { WEEKDAY_OPTIONS } from "@/types/scheduling"
import type {
  ShiftSchedule,
  ShiftScheduleBlock,
  ShiftScheduleForm,
  ShiftTemplateOption,
  StaffOption,
} from "@/types/shifts"
import { ScheduleFormFields } from "./schedule-form-fields"
import { createDefaultScheduleForm } from "./schedule-form-model"

const SortIndicator = ({ value }: { value: false | "asc" | "desc" }) => {
  if (value === "asc") return <ArrowUpIcon className="h-4 w-4" />
  if (value === "desc") return <ArrowDownIcon className="h-4 w-4" />
  return <ArrowUpDownIcon className="h-4 w-4" />
}

const toDateInputValue = (value?: string | null) => {
  if (!value) return ""
  return toISODate(value)
}

const summarizeBlocks = (blocks: ShiftScheduleBlock[]) => {
  if (!blocks.length) return "-"
  return blocks
    .map((block) => {
      const label = block.template?.name ?? "Template"
      return `${label} x${block.repeatDays}`
    })
    .join(" - ")
}

const summarizeWeekOff = (schedule: ShiftSchedule) => {
  const day1 =
    WEEKDAY_OPTIONS.find((item) => item.value === schedule.weekOffDay1)?.label ??
    schedule.weekOffDay1
  if (!schedule.weekOffDay2) {
    return day1
  }
  const day2 =
    WEEKDAY_OPTIONS.find((item) => item.value === schedule.weekOffDay2)?.label ??
    schedule.weekOffDay2
  const weeks =
    schedule.weekOff2Weeks?.length ? ` (weeks ${schedule.weekOff2Weeks.join(", ")})` : ""
  return `${day1} + ${day2}${weeks}`
}

const summarizeAssignments = (schedule: ShiftSchedule) => {
  if (schedule.isDefault) return "All staff"
  const assignments = schedule.assignments ?? []
  const names = assignments
    .map((assignment) => assignment.staffProfile?.user?.name || assignment.staffProfile?.user?.email)
    .filter(Boolean) as string[]
  if (!names.length) return "-"
  if (names.length <= 2) return names.join(", ")
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`
}

const summarizeAssignmentRange = (
  schedule: ShiftSchedule,
  formatDate: (value?: string | Date | null) => string
) => {
  const assignments = schedule.assignments ?? []
  if (!assignments.length) return "-"
  const rangeStart = assignments[0]?.startDate
  const rangeEnd = assignments[0]?.endDate
  if (!rangeStart) return "-"
  if (!rangeEnd) return `${formatDate(rangeStart)} onward`
  return `${formatDate(rangeStart)} - ${formatDate(rangeEnd)}`
}

export default function ShiftSchedulesPage() {
  const canCreate = useCurrentResourceAction("create")
  const canEdit = useCurrentResourceAction("edit")
  const canArchive = useCurrentResourceAction("archive")

  const { formatDate } = useDateFormatter()
  type PaginationState = { pageIndex: number; pageSize: number }

  const [schedules, setSchedules] = React.useState<ShiftSchedule[]>([])
  const [formError, setFormError] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [totalRows, setTotalRows] = React.useState(0)

  const [templates, setTemplates] = React.useState<ShiftTemplateOption[]>([])
  const [staffOptions, setStaffOptions] = React.useState<StaffOption[]>([])

  const [staffFilter, setStaffFilter] = React.useState("all")
  const [startDateFilter, setStartDateFilter] = React.useState("")
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({
    name: true,
    staff: true,
    startDate: true,
    weekOff: true,
    blocks: true,
    updatedAt: true,
  })
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })

  const [viewing, setViewing] = React.useState<ShiftSchedule | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<ShiftSchedule | null>(null)
  const [editingSchedule, setEditingSchedule] = React.useState<ShiftSchedule | null>(null)
  const [unassignOpen, setUnassignOpen] = React.useState(false)
  const [unassignTarget, setUnassignTarget] = React.useState<ShiftSchedule | null>(null)
  const [unassignAssignmentId, setUnassignAssignmentId] = React.useState("")
  const [unassignEndDate, setUnassignEndDate] = React.useState("")
  const [unassigning, setUnassigning] = React.useState(false)

  const today = React.useMemo(() => toISODate(new Date()), [])
  const defaultForm = React.useMemo(() => createDefaultScheduleForm(today), [today])

  const [newSchedule, setNewSchedule] = React.useState<ShiftScheduleForm>(defaultForm)
  const [editSchedule, setEditSchedule] = React.useState<ShiftScheduleForm>(defaultForm)
  const standardStaffOptions = React.useMemo(
    () =>
      staffOptions.filter(
        (staff) => (staff.staffProfile?.schedulingMode ?? "STANDARD") === "STANDARD"
      ),
    [staffOptions]
  )
  const standardStaffIdSet = React.useMemo(
    () => new Set(standardStaffOptions.map((staff) => staff.id)),
    [standardStaffOptions]
  )

  const {
    errors: createErrors,
    setErrorsFromResponse: setCreateErrorsFromResponse,
    clearErrors: clearCreateErrors,
  } = useFormErrors()
  const {
    errors: editErrors,
    setErrorsFromResponse: setEditErrorsFromResponse,
    clearErrors: clearEditErrors,
  } = useFormErrors()

  const totalPages = Math.max(1, Math.ceil(totalRows / pagination.pageSize))

  const loadSchedules = React.useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set("page", String(pagination.pageIndex + 1))
    params.set("pageSize", String(pagination.pageSize))
    if (staffFilter !== "all") {
      params.set("staffId", staffFilter)
    }
    if (startDateFilter) {
      params.set("startDate", startDateFilter)
    }
    if (sorting[0]) {
      params.set("sort", sorting[0].id)
      params.set("order", sorting[0].desc ? "desc" : "asc")
    }

    const response = await fetch(`/api/shifts/schedules?${params.toString()}`)
    if (!response.ok) {
      toast.error("Unable to load shift schedules.")
      setSchedules([])
      setTotalRows(0)
      setLoading(false)
      return
    }
    const data = (await response.json()) as ListResponse<ShiftSchedule>
    setSchedules(data.items)
    setTotalRows(data.total)
    setLoading(false)
  }, [pagination.pageIndex, pagination.pageSize, sorting, staffFilter, startDateFilter])

  const loadTemplates = React.useCallback(async () => {
    const response = await fetch("/api/shifts/templates?includeInactive=true", {
      cache: "no-store",
    })
    if (!response.ok) {
      toast.error("Unable to load shift templates.")
      setTemplates([])
      return
    }
    const data = (await response.json()) as { items?: ShiftTemplateOption[] }
    setTemplates(data.items ?? [])
  }, [])

  const loadStaff = React.useCallback(async () => {
    const response = await fetch("/api/directory?role=STAFF&pageSize=100", {
      cache: "no-store",
    })
    if (!response.ok) {
      toast.error("Unable to load staff list.")
      setStaffOptions([])
      return
    }
    const data = (await response.json()) as { items?: StaffOption[] }
    setStaffOptions(data.items ?? [])
  }, [])

  React.useEffect(() => {
    void loadSchedules()
  }, [loadSchedules])

  React.useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  React.useEffect(() => {
    void loadStaff()
  }, [loadStaff])

  React.useEffect(() => {
    setPagination((prev) =>
      prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }
    )
  }, [sorting, staffFilter, startDateFilter])

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

  const createSchedule = async () => {
    const normalizedStaffIds = newSchedule.staffIds.filter((staffId) => standardStaffIdSet.has(staffId))
    if (!newSchedule.isDefault && !normalizedStaffIds.length) {
      toast.error("Select at least one staff member.")
      return
    }
    setFormError(""); setSaving(true)
    try {
      clearCreateErrors()
      const response = await fetch("/api/shifts/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newSchedule,
          staffIds: normalizedStaffIds,
        }),
      })

      if (!response.ok) {
        const data = (await response.json()) as {
          error?: string
          details?: { fieldErrors?: Record<string, string[]> }
        }
        setCreateErrorsFromResponse(data)
        setFormError(data.error ?? "Unable to create shift schedule."); toast.error(data.error ?? "Unable to create shift schedule.")
        setSaving(false)
        return
      }

      toast.success("Shift schedule created.")
      setNewSchedule(defaultForm)
      setSaving(false)
      setCreateOpen(false)
      await loadSchedules()
    } catch {
      setFormError("Unable to save. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  const startEdit = React.useCallback(
    (schedule: ShiftSchedule) => {
      clearEditErrors()
      setFormError("")
      const assignments = schedule.assignments ?? []
      const assignmentStart = assignments[0]?.startDate
        ? toDateInputValue(assignments[0].startDate)
        : ""
      const assignmentEnd = assignments[0]?.endDate
        ? toDateInputValue(assignments[0].endDate)
        : ""
      setEditingSchedule(schedule)
      const editableStaffIds = assignments
        .map((assignment) => assignment.staffProfile?.user?.id)
        .filter((staffId): staffId is string => Boolean(staffId && standardStaffIdSet.has(staffId)))
      if (assignments.length && !editableStaffIds.length && !schedule.isDefault) {
        toast.warning("This schedule had flexible staff assignments. Flexible staff are excluded from shift schedules.")
      }
      setEditSchedule({
        name: schedule.name ?? "",
        staffIds: editableStaffIds,
        isDefault: Boolean(schedule.isDefault),
        startDate: toDateInputValue(schedule.startDate),
        assignmentStartDate: assignmentStart || toDateInputValue(schedule.startDate),
        assignmentEndDate: assignmentEnd,
        weekOffDay1: schedule.weekOffDay1,
        weekOffDay2: schedule.weekOffDay2 ?? "",
        weekOff2Weeks:
          schedule.weekOffDay2 && (!schedule.weekOff2Weeks || !schedule.weekOff2Weeks.length)
            ? [1, 2, 3, 4, 5]
            : schedule.weekOff2Weeks ?? [],
        blocks: schedule.blocks.length
          ? schedule.blocks.map((block) => ({
              templateId: block.templateId,
              repeatDays: block.repeatDays,
            }))
          : [{ templateId: "", repeatDays: 1 }],
      })
      setEditOpen(true)
    },
    [clearEditErrors, standardStaffIdSet]
  )

  const saveEdit = async () => {
    if (!editingSchedule) return
    const normalizedStaffIds = editSchedule.staffIds.filter((staffId) => standardStaffIdSet.has(staffId))
    if (!editSchedule.isDefault && !normalizedStaffIds.length) {
      toast.error("Select a staff member.")
      return
    }
    setFormError(""); setSaving(true)
    try {
      const response = await fetch(`/api/shifts/schedules/${editingSchedule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editSchedule,
          staffIds: normalizedStaffIds,
        }),
      })

      if (!response.ok) {
        const data = (await response.json()) as {
          error?: string
          details?: { fieldErrors?: Record<string, string[]> }
        }
        setEditErrorsFromResponse(data)
        setFormError(data.error ?? "Unable to update shift schedule."); toast.error(data.error ?? "Unable to update shift schedule.")
        setSaving(false)
        return
      }

      toast.success("Shift schedule updated.")
      setSaving(false)
      setEditOpen(false)
      setEditingSchedule(null)
      await loadSchedules()
    } catch {
      setFormError("Unable to save. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  const requestDelete = React.useCallback((schedule: ShiftSchedule) => {
    setDeleteTarget(schedule)
    setDeleteOpen(true)
  }, [])

  const requestUnassign = React.useCallback((schedule: ShiftSchedule) => {
    const assignments = schedule.assignments ?? []
    if (!assignments.length) {
      toast.error("No assignments found for this schedule.")
      return
    }
    const firstAssignment = assignments[0]
    const todayDate = toISODate(new Date())
    const startDate = toDateInputValue(firstAssignment?.startDate)
    setUnassignTarget(schedule)
    setUnassignAssignmentId(firstAssignment?.id ?? "")
    setUnassignEndDate(startDate && startDate > todayDate ? startDate : todayDate)
    setUnassignOpen(true)
  }, [])

  const confirmDelete = React.useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const response = await fetch(`/api/shifts/schedules/${deleteTarget.id}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        toast.error(data.error ?? "Unable to delete shift schedule.")
        setDeleting(false)
        return
      }
      toast.success("Shift schedule deleted.")
      setDeleting(false)
      setDeleteOpen(false)
      setDeleteTarget(null)
      await loadSchedules()
    } catch {
      toast.error("Unable to complete this action. Please try again.")
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, loadSchedules])

  const confirmUnassign = React.useCallback(async () => {
    if (!unassignAssignmentId) {
      toast.error("Select an assigned staff member.")
      return
    }
    if (!unassignEndDate) {
      toast.error("Select an end date.")
      return
    }
    setUnassigning(true)
    try {
      const response = await fetch(`/api/shifts/assignments/${unassignAssignmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endDate: unassignEndDate }),
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        throw new Error(data.error ?? "Unable to end assignment.")
      }
      toast.success("Staff assignment ended.")
      setUnassignOpen(false)
      setUnassignTarget(null)
      setUnassignAssignmentId("")
      setUnassignEndDate("")
      await loadSchedules()
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Unable to end assignment.")
    } finally {
      setUnassigning(false)
    }
  }, [loadSchedules, unassignAssignmentId, unassignEndDate])

  const columns = React.useMemo<ColumnDef<ShiftSchedule>[]>(
    () => [
      {
        accessorKey: "name",
        meta: { label: "Schedule" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Schedule
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-medium">
                {row.original.name || "Shift schedule"}
              </span>
              {row.original.isDefault ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  Default
                </span>
              ) : null}
            </div>
            <span className="text-xs text-muted-foreground">
              {row.original.startDate
                ? formatDate(row.original.startDate)
                : "-"}
            </span>
          </div>
        ),
      },
      {
        id: "staff",
        meta: { label: "Staff" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Staff
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        accessorFn: (row) => summarizeAssignments(row),
        cell: ({ row }) => (
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <span>{summarizeAssignments(row.original)}</span>
            <span className="text-xs text-muted-foreground">
              {summarizeAssignmentRange(row.original, formatDate)}
            </span>
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
              Standard only
            </span>
          </div>
        ),
      },
      {
        id: "startDate",
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
        accessorFn: (row) => row.startDate,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.startDate
              ? formatDate(row.original.startDate)
              : "-"}
          </span>
        ),
      },
      {
        id: "weekOff",
        meta: { label: "Week off" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Week off
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        accessorFn: (row) => summarizeWeekOff(row),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {summarizeWeekOff(row.original)}
          </span>
        ),
      },
      {
        id: "blocks",
        meta: { label: "Blocks" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Blocks
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        accessorFn: (row) => summarizeBlocks(row.blocks),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {summarizeBlocks(row.original.blocks)}
          </span>
        ),
      },
      {
        accessorKey: "updatedAt",
        meta: { label: "Updated" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
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
        enableHiding: false,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Record actions">
                <MoreHorizontalIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setViewing(row.original)}>View details</DropdownMenuItem>
              <DropdownMenuItem disabled={!canEdit} onSelect={() => startEdit(row.original)}>
                Edit
              </DropdownMenuItem>
              {!row.original.isDefault && (row.original.assignments?.length ?? 0) > 0 ? (
                <DropdownMenuItem disabled={!canArchive} onSelect={() => requestUnassign(row.original)}>
                  End staff assignment
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                disabled={!canArchive} onSelect={() => requestDelete(row.original)}
                className="text-destructive"
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [formatDate, requestDelete, requestUnassign, startEdit, canEdit, canArchive]
  )

  const table = useReactTable({
    data: schedules,
    columns,
    state: {
      sorting,
      columnVisibility,
      pagination,
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: handlePaginationChange,
    manualPagination: true,
    manualSorting: true,
    pageCount: totalPages,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className={pageClass}>
      <PageHeader title={<> Shift schedules </>} description={<> Assign shift templates in repeating blocks with week off rules. </>} actions={<> <Button disabled={!canCreate} onClick={() => { setFormError(""); setCreateOpen(true) }}>New schedule</Button> </>} />

      {viewing && <RecordPanel title={viewing.name || "Shift schedule"} description="Saved scheduling details." onClose={() => setViewing(null)} actions={<Button disabled={!canEdit} onClick={() => { startEdit(viewing); setViewing(null) }}>Edit details</Button>}><Section title="Schedule details"><ReadOnlyFields fields={[{label:"Start date",value:formatDate(viewing.startDate)},{label:"Default schedule",value:viewing.isDefault?"Yes":"No"},{label:"Week off day 1",value:viewing.weekOffDay1},{label:"Week off day 2",value:viewing.weekOffDay2},{label:"Second day weeks",value:viewing.weekOff2Weeks.join(", ")}]} /></Section><Section title="Repeating blocks">{viewing.blocks.map((block,index)=><p key={block.id||index}>{block.template?.name || templates.find(item=>item.id===block.templateId)?.name || "Shift template"}: {block.repeatDays} working days</p>)}</Section><Section title="Staff assignments">{viewing.assignments?.length?viewing.assignments.map(item=><p key={item.id}>{item.staffProfile?.user?.name || item.staffProfile?.user?.email}: {formatDate(item.startDate)} - {item.endDate?formatDate(item.endDate):"Open ended"}</p>):<p>No explicit assignments.</p>}</Section></RecordPanel>}
      <Surface>
      <TableToolbar table={table} showSearch={false}>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-muted-foreground">Start date</label>
          <Input aria-label="Start date"
            type="date"
            className="h-9 w-44"
            value={startDateFilter}
            onChange={(event) => setStartDateFilter(event.target.value)}
          />
          <div className="w-56">
            <SearchableSelect
              value={staffFilter}
              placeholder="All staff"
              searchPlaceholder="Search staff..."
              options={[
                { value: "all", label: "All staff" },
                ...standardStaffOptions.map((staff) => ({
                  value: staff.id,
                  label: staff.name?.trim() || staff.email,
                })),
              ]}
              onChange={(nextValue) => setStaffFilter(nextValue)}
            />
          </div>
        </div>
      </TableToolbar>

      <DataTable table={table} loading={loading} emptyMessage="No shift schedules found." />

      <TablePagination table={table} totalRows={totalRows} />
      </Surface>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open)
          if (!open) {
            setDeleteTarget(null)
            setDeleting(false)
          }
        }}
      >
        <ActionDialogContent title={<>Delete shift schedule</>} description={<>{deleteTarget
                ? `Delete "${deleteTarget.name ?? "Shift schedule"}"? This cannot be undone.`
                : "Delete this shift schedule? This cannot be undone."}</>} className="sm:max-w-md" actions={<> <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button><Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button> </>}></ActionDialogContent>
      </Dialog>

      <Dialog
        open={unassignOpen}
        onOpenChange={(open) => {
          setUnassignOpen(open)
          if (!open) {
            setUnassignTarget(null)
            setUnassignAssignmentId("")
            setUnassignEndDate("")
            setUnassigning(false)
          }
        }}
      >
        <ActionDialogContent title={<>End assignment</>} description={<>Set an end date for the selected staff assignment. Historical schedule data remains preserved.
            </>} className="sm:max-w-md" actions={<> <Button
              variant="outline"
              onClick={() => setUnassignOpen(false)}
              disabled={unassigning}
            >
              Cancel
            </Button><Button onClick={confirmUnassign} loading={unassigning} loadingText="Saving...">
              End assignment
            </Button> </>}><div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Assigned staff</label>
              <Select aria-label="Assigned staff"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={unassignAssignmentId}
                onValueChange={(value) => {
                  const nextId = value
                  setUnassignAssignmentId(nextId)
                  const selected = (unassignTarget?.assignments ?? []).find((item) => item.id === nextId)
                  const todayDate = toISODate(new Date())
                  const startDate = toDateInputValue(selected?.startDate)
                  if (startDate) {
                    setUnassignEndDate(startDate > todayDate ? startDate : todayDate)
                  }
                }}
              >
                {(unassignTarget?.assignments ?? []).map((assignment) => (
                  <option key={assignment.id} value={assignment.id}>
                    {(assignment.staffProfile?.user?.name || assignment.staffProfile?.user?.email || "Staff") +
                      ` (${toDateInputValue(assignment.startDate)} - ${
                        assignment.endDate ? toDateInputValue(assignment.endDate) : "ongoing"
                      })`}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">End date</label>
              <Input aria-label="End date"
                type="date"
                value={unassignEndDate}
                min={toDateInputValue(
                  (unassignTarget?.assignments ?? []).find((item) => item.id === unassignAssignmentId)?.startDate
                )}
                onChange={(event) => setUnassignEndDate(event.target.value)}
              />
            </div>
          </div></ActionDialogContent>
      </Dialog>

      {canCreate && createOpen && <DraftPanel title="New shift schedule" description="Update the details and scheduling rules below." fingerprint={newSchedule} saving={saving} error={formError} saveLabel="Create schedule" onClose={() => { setCreateOpen(false); setNewSchedule(defaultForm); clearCreateErrors(); setFormError("") }} onSubmit={() => void createSchedule()}><ScheduleFormFields
              mode="create"
              form={newSchedule}
              setForm={setNewSchedule}
              errors={createErrors}
              allowMultiStaff
              today={today}
              staffOptions={standardStaffOptions}
              templates={templates}
            /></DraftPanel>}

      {canEdit && editOpen && <DraftPanel title="Edit shift schedule" description="Update the details and scheduling rules below." fingerprint={editSchedule} saving={saving} error={formError} saveLabel="Save changes" onClose={() => { setEditOpen(false) }} onSubmit={() => void saveEdit()}><ScheduleFormFields
              mode="edit"
              form={editSchedule}
              setForm={setEditSchedule}
              errors={editErrors}
              allowMultiStaff
              today={today}
              staffOptions={standardStaffOptions}
              templates={templates}
            /></DraftPanel>}
    </div>
  )
}
