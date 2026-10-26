"use client"
import { useCreationOfficeSnapshot } from "@/platform/companies/creation-snapshot"
import { useBusinessModules } from "@/platform/module-provider"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { PageHeader, pageClass } from "@/components/erp/page"
import { Section } from "@/components/erp/section"
import { DraftPanel } from "@/components/erp/record-detail"
import { ConfirmAction } from "@/components/erp/confirm-action"
import { AppointmentOrderSummary } from "./appointment-order-summary"
import { Button } from "@/components/ui/button"
import { useFormErrors } from "@/hooks/use-form-errors"
import type {
  AppointmentCustomerOption,
  AppointmentOrderStatus,
  AppointmentOrderPricingPreview,
  CouponRow,
  AppointmentOrderRow,
  AppointmentOrderFormValues,
  AppointmentProductOption,
  AppointmentServiceOption,
  AppointmentStaffOption,
  TaxMode,
} from "@/types/appointments"
import type { AppSettingsPayload } from "@/types/scheduling"
import { formatCurrencyFromCents, formatTimeFrom24h } from "@/lib/formatting"
import { AppointmentOrderFormFields } from "./appointment-order-form-fields"
import {
  orderFormInput,
  defaultAppointmentOrderFormValues,
} from "./appointment-order-form-model"
import { subtotalAfterLineDiscounts } from "@/modules/appointments/order-pricing"
import { wallTime, wallTimeToInstant } from "@/lib/business-time"

type AppointmentOrderEditorProps = {
  mode: "create" | "edit"
  appointmentId?: string
}

type StartSuggestion = {
  suggestedStartAt: string
  reason: string
  requestKey: string
}

type LineScheduleSnapshot = Record<string, { startAt: string; endAt: string }>

const formatCouponScopeLabel = (coupon: CouponRow) => {
  if (coupon.appliesTo === "SERVICE_LINES") return "Services"
  if (coupon.appliesTo === "PRODUCT_LINES") return "Products"
  return "Order"
}

const ORDER_STATUS_META: Record<
  AppointmentOrderStatus,
  { label: string; badgeClass: string; helperText: string }
> = {
  DRAFT: {
    label: "Draft",
    badgeClass: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
    helperText: "Draft booking. Confirm to lock the schedule and mark it as active.",
  },
  CONFIRMED: {
    label: "Confirmed",
    badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
    helperText: "Confirmed booking. Save changes to update details while keeping status confirmed.",
  },
  COMPLETED: {
    label: "Completed",
    badgeClass: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
    helperText: "Completed booking. This record is read-only.",
  },
  CANCELED: {
    label: "Canceled",
    badgeClass: "border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-300",
    helperText: "Canceled booking. This record is read-only.",
  },
}

export function AppointmentOrderEditor({ mode, appointmentId }: AppointmentOrderEditorProps) {
  const { can, enabled } = useBusinessModules()
  const servicesAllowed = enabled("services") && can("services.read")
  const productsAllowed = enabled("inventory") && can("inventoryProducts.read")
  const couponsAllowed = can("appointmentCoupons.read")
  const canExport = can("appointments.export")
  const canEmail = canExport && can("appointments.edit")
  const router = useRouter()
  const [loading, setLoading] = React.useState(true)
  const [settingsReady, setSettingsReady] = React.useState(false)
  const initializedSettings = React.useRef(false)
  const [savedOrder, setSavedOrder] = React.useState<AppointmentOrderRow | null>(null)
  const canWrite = savedOrder?.office?.active !== false && servicesAllowed && can(mode === "create" ? "appointments.create" : "appointments.edit") && (!savedOrder?.productLines?.length || productsAllowed) && (!savedOrder?.coupons.length || couponsAllowed)
  const [editOpen, setEditOpen] = React.useState(false)
  const [formError, setFormError] = React.useState("")
  const [loadError, setLoadError] = React.useState("")
  const [discardCreate, setDiscardCreate] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [emailing, setEmailing] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(appointmentId ?? null)
  const creationHeaders = useCreationOfficeSnapshot(mode === "create" && !editingId)
  const [values, setValues] = React.useState<AppointmentOrderFormValues>(
    defaultAppointmentOrderFormValues
  )
  const [initialDraft] = React.useState(() => JSON.stringify(values))
  const [customers, setCustomers] = React.useState<AppointmentCustomerOption[]>([])
  const [staff, setStaff] = React.useState<AppointmentStaffOption[]>([])
  const [services, setServices] = React.useState<AppointmentServiceOption[]>([])
  const [products, setProducts] = React.useState<AppointmentProductOption[]>([])
  const [coupons, setCoupons] = React.useState<CouponRow[]>([])
  const [startSuggestion, setStartSuggestion] = React.useState<StartSuggestion | null>(null)
  const [savedLineSchedule, setSavedLineSchedule] = React.useState<LineScheduleSnapshot>({})
  const [savedLineScheduleKey, setSavedLineScheduleKey] = React.useState<string | null>(null)
  const [settings, setSettings] = React.useState<AppSettingsPayload>({
    locale: "en-US",
    currency: "USD",
    currencySymbolPlacement: "BEFORE",
    numberFormat: "US_UK",
    timeFormat: "H24",
  })
  const { errors } = useFormErrors()

  const timeZone = settings.timeZone ?? "UTC"
  const toDateInput = (value: Date) => wallTime(value, timeZone).slice(0, 10)
  const toTimeInput = (value: Date) => wallTime(value, timeZone).slice(11, 16)
  const formatTimeFromDate = (value: Date, format: Pick<AppSettingsPayload, "timeFormat">) => formatTimeFrom24h(toTimeInput(value), format)
  const bookingInstant = React.useMemo(() => {
    try { return wallTimeToInstant(`${values.appointmentDate}T${values.appointmentStartTime}`, timeZone) }
    catch { return null }
  }, [values.appointmentDate, values.appointmentStartTime, timeZone])

  const buildRequestKey = React.useCallback(
    (nextValues: AppointmentOrderFormValues) =>
      JSON.stringify({
        customerId: nextValues.customerId,
        appointmentDate: nextValues.appointmentDate,
        appointmentStartTime: nextValues.appointmentStartTime,
        lines: nextValues.lines.map((line) => ({
          serviceId: line.serviceId,
          staffId: line.staffId,
          quantity: line.quantity,
          durationMinutes: line.durationMinutes,
        })),
      }),
    []
  )

  const orderInput = React.useMemo(() => bookingInstant ? orderFormInput(values, bookingInstant, savedOrder) : null, [values, bookingInstant, savedOrder])
  const hasPricingInputs = Boolean(values.customerId && values.lines.length && values.lines.every(line => line.serviceId && line.staffId) &&
    (values.productLines ?? []).every(line => line.productId))
  const previewKey = orderInput && hasPricingInputs ? JSON.stringify({ orderId: editingId ?? undefined, input: {
    ...orderInput, customerNote: undefined, internalNote: undefined,
    lines: orderInput.lines.map(line => ({ ...line, note: undefined })),
    productLines: orderInput.productLines.map(line => ({ ...line, note: undefined })),
  } }) : null
  const [previewState, setPreviewState] = React.useState<{ key: string; data?: AppointmentOrderPricingPreview; error?: string } | null>(null)
  const [previewAttempt, retryPreview] = React.useReducer(count => count + 1, 0)
  const previewActive = settingsReady && !loading && (mode === "create" || editOpen)
  React.useEffect(() => {
    if (!previewActive || !previewKey) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/appointments/orders/preview", { method: "POST", cache: "no-store",
          headers: { "Content-Type": "application/json" }, body: previewKey, signal: controller.signal })
        const data = await response.json()
        const validationMessage = Object.values(data.details?.fieldErrors ?? {}).flat().filter(item => typeof item === "string").join(" ")
        if (!controller.signal.aborted) setPreviewState(response.ok ? { key: previewKey, data } : { key: previewKey, error: validationMessage || data.error || "Unable to calculate pricing." })
      } catch {
        if (!controller.signal.aborted) setPreviewState({ key: previewKey, error: "Pricing is unavailable. Please retry." })
      }
    }, 350)
    return () => { clearTimeout(timer); controller.abort() }
  }, [previewActive, previewKey, previewAttempt])
  const pricingPreview = previewState?.key === previewKey ? previewState?.data : undefined
  const previewError = previewState?.key === previewKey ? previewState?.error : undefined
  const totals = pricingPreview?.totals
  const linePricingById = pricingPreview ? Object.fromEntries([
    ...values.lines.map((line, index) => [line.id, pricingPreview.lines[index]]),
    ...(values.productLines ?? []).map((line, index) => [line.id, pricingPreview.productLines[index]]),
  ]) : {}

  const requestKey = React.useMemo(
    () => buildRequestKey(values),
    [buildRequestKey, values]
  )

  const schedulePreview = React.useMemo(() => {
    if (!bookingInstant) return []
    const start = new Date(bookingInstant)
    if (Number.isNaN(start.getTime())) return []

    const formatTime = (value: Date) => formatTimeFrom24h(wallTime(value, timeZone).slice(11, 16), settings)

    const useSavedSchedule = savedLineScheduleKey === requestKey
    let cursor = new Date(start)
    let previousEnd: Date | null = null
    return values.lines.map((line, index) => {
      const service = services.find((item) => item.id === line.serviceId)
      const staffMember = staff.find((member) => member.id === line.staffId)
      const savedLine = savedOrder?.lines.find(saved => saved.id === line.id)
      const durationMinutes = savedLine && savedLine.serviceId === line.serviceId && savedLine.quantity === line.quantity
        ? savedLine.durationMinutes : (service?.durationMinutes ?? line.durationMinutes ?? 0) * Math.max(1, line.quantity)
      const savedWindow = useSavedSchedule ? savedLineSchedule[line.id] : undefined
      const startsAt = savedWindow ? new Date(savedWindow.startAt) : new Date(cursor)
      const endsAt = savedWindow ? new Date(savedWindow.endAt) : new Date(cursor)
      if (!savedWindow) endsAt.setTime(endsAt.getTime() + Math.max(0, durationMinutes) * 60000)
      const waitMinutes = previousEnd
        ? Math.max(0, Math.round((startsAt.getTime() - previousEnd.getTime()) / 60000))
        : 0
      cursor = endsAt
      previousEnd = endsAt
      return {
        id: line.id,
        index,
        serviceLabel: service?.name || "Service",
        staffLabel: staffMember?.name?.trim() || staffMember?.email || "Unassigned staff",
        startAt: startsAt.toISOString(), endAt: endsAt.toISOString(),
        startsAtLabel: formatTime(startsAt),
        endsAtLabel: formatTime(endsAt),
        waitMinutes,
        durationMinutes: Math.max(0, durationMinutes),
      }
    })
  }, [
    bookingInstant, timeZone, savedOrder,
    requestKey,
    savedLineSchedule,
    savedLineScheduleKey,
    settings,
    services,
    staff,
    values.lines,
  ])

  const scheduleMetaByLineId = React.useMemo(
    () =>
      Object.fromEntries(
        schedulePreview.map((slot) => [
          slot.id,
          {
            startAt: slot.startAt, endAt: slot.endAt,
            startsAtLabel: slot.startsAtLabel,
            endsAtLabel: slot.endsAtLabel,
            waitMinutes: slot.waitMinutes,
          },
        ])
      ),
    [schedulePreview]
  )

  const applyOrderToForm = React.useCallback(
    (order: AppointmentOrderRow) => {
      setSavedOrder(order)
      setStaff(order.lines.flatMap(line => line.staffProfile?.user ? [line.staffProfile.user] : []))
      const start = wallTime(order.appointmentStartAt, timeZone)
      const nextValues: AppointmentOrderFormValues = {
        customerId: order.customerId,
        appointmentDate: start.slice(0, 10),
        appointmentStartTime: start.slice(11, 16),
        couponInput: "",
        coupons: order.coupons.map((coupon) => ({ code: coupon.code })),
        customerNote: order.customerNote ?? "",
        internalNote: order.internalNote ?? "",
        status: order.status,
        lines: order.lines.map((line) => ({
          id: line.id,
          serviceId: line.serviceId,
          staffId: line.staffProfile?.user?.id ?? "",
          quantity: line.quantity,
          durationMinutes: line.durationMinutes,
          unitPriceCents: line.unitPriceCents,
          discountType: line.discountType,
          discountValue: line.discountValue,
          taxIds: line.taxIds ?? [],
          taxMode: line.taxMode ?? "EXCLUSIVE",
          lineTaxCents: line.lineTaxCents ?? 0,
          note: line.note ?? "",
        })),
        productLines: (order.productLines ?? []).map((line) => ({
          id: line.id,
          productId: line.productId,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          discountType: line.discountType,
          discountValue: line.discountValue,
          taxIds: line.taxIds ?? [],
          taxMode: line.taxMode ?? "EXCLUSIVE",
          lineTaxCents: line.lineTaxCents ?? 0,
          note: line.note ?? "",
        })),
      }
      setValues(nextValues)
      setSavedLineSchedule(
        Object.fromEntries(
          order.lines.map((line) => [line.id, { startAt: line.startAt, endAt: line.endAt }])
        )
      )
      setSavedLineScheduleKey(buildRequestKey(nextValues))
      setEditingId(order.id)
    },
    [buildRequestKey, timeZone]
  )

  React.useEffect(() => {
    const loadLookups = async () => {
      const [customerRes, serviceRes, productRes, couponRes, settingsRes] = await Promise.all([
        fetch("/api/directory?role=CUSTOMER&status=ACTIVE&page=1&pageSize=100", {
          cache: "no-store",
        }),
        servicesAllowed ? fetch("/api/services?status=ACTIVE&page=1&pageSize=100&sort=name&order=asc", {
          cache: "no-store",
        }) : Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 })),
        productsAllowed ? fetch("/api/inventory/products?status=ACTIVE&page=1&pageSize=100&sort=name&order=asc", {
          cache: "no-store",
        }) : Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 })),
        couponsAllowed ? fetch("/api/appointments/coupons?page=1&pageSize=100&active=true", {
          cache: "no-store",
        }) : Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 })),
        fetch("/api/settings/operations", { cache: "no-store" }),
      ])

      if (customerRes.ok) {
        const data = (await customerRes.json()) as {
          items?: Array<{ id: string; name: string | null; email: string }>
        }
        setCustomers(data.items ?? [])
      }

      if (serviceRes.ok) {
        const data = (await serviceRes.json()) as {
          items?: Array<{
            id: string
            name: string
            category?: { id: string }
            durationMinutes: number
            priceCents?: number
            taxMode?: TaxMode
            taxIds?: string[]
          }>
        }
        setServices((data.items ?? []).map((service) => ({
          id: service.id,
          name: service.name,
          categoryId: service.category?.id,
          durationMinutes: service.durationMinutes,
          priceCents: service.priceCents,
          taxMode: service.taxMode,
          taxIds: service.taxIds,
        })))
      }

      if (productRes.ok) {
        const data = (await productRes.json()) as {
          items?: Array<{
            id: string
            sku: string
            name: string
            category?: { id: string }
            mrpCents: number
            taxIds?: string[]
          }>
        }
        setProducts((data.items ?? []).map((product) => ({
          id: product.id,
          sku: product.sku,
          name: product.name,
          categoryId: product.category?.id,
          mrpCents: product.mrpCents,
          taxIds: product.taxIds,
        })))
      }

      if (couponRes.ok) {
        const data = (await couponRes.json()) as { items?: CouponRow[] }
        setCoupons(data.items ?? [])
      }

      if (!settingsRes.ok) throw new Error("Booking settings unavailable")
      if (settingsRes.ok) {
        const data = (await settingsRes.json()) as { settings?: AppSettingsPayload }
        if (data.settings) {
          setSettings((prev) => ({ ...prev, ...data.settings }))
          if (!initializedSettings.current && mode === "create") {
            const local = wallTime(new Date(), data.settings.timeZone ?? "UTC")
            setValues(prev => ({ ...prev, appointmentDate: local.slice(0, 10), appointmentStartTime: local.slice(11, 16) }))
          }
          initializedSettings.current = true
        }
      }
    }

    void loadLookups().catch(() => {
      setLoadError("Unable to load booking settings and choices. Please refresh.")
      toast.error("Unable to load booking choices. Please refresh.")
    }).finally(() => setSettingsReady(true))
  }, [servicesAllowed, productsAllowed, couponsAllowed, mode])

  React.useEffect(() => {
    if (mode !== "edit") { setLoading(false); return }
    if (!appointmentId) { setLoadError("Booking order not found."); setLoading(false); return }

    const load = async () => {
      setLoading(true)
      setLoadError("")
      setEditingId(appointmentId)

      const orderResponse = await fetch(`/api/appointments/orders/${appointmentId}`, {
        cache: "no-store",
      })
      if (orderResponse.ok) {
        const data = (await orderResponse.json()) as { order?: AppointmentOrderRow }
        const order = data.order
        if (order) {
          applyOrderToForm(order)
          setLoading(false)
          return
        }
      }

      setLoadError("Booking order not found.")
      toast.error("Booking order not found.")
      setLoading(false)
    }
    void load().catch(() => { setLoadError("Unable to load booking. Please refresh."); setLoading(false) })
  }, [appointmentId, applyOrderToForm, mode])

  const bookingStartAt = React.useMemo(() => bookingInstant ? new Date(bookingInstant) : null, [bookingInstant])

  const isHistoricalStatus = values.status === "COMPLETED" || values.status === "CANCELED"
  const isAfterBookingDay = React.useMemo(() => {
    if (!bookingStartAt) return false
    const now = new Date()
    const bookingDateKey = wallTime(bookingStartAt, timeZone).slice(0, 10)
    const nowDateKey = wallTime(now, timeZone).slice(0, 10)
    return nowDateKey > bookingDateKey
  }, [bookingStartAt, timeZone])
  const isReadOnlyBooking = mode === "edit" && (isHistoricalStatus || isAfterBookingDay)
  const currentStatus: AppointmentOrderStatus = values.status ?? "DRAFT"
  const currentStatusMeta = ORDER_STATUS_META[currentStatus]
  const canSaveDraft = !isReadOnlyBooking && currentStatus === "DRAFT"
  const primaryActionLabel = currentStatus === "DRAFT" ? "Confirm booking" : "Save changes"

  const handleSave = async (target: "draft" | "confirm") => {
    if (!canWrite || !pricingPreview || !orderInput) return
    if (isReadOnlyBooking) {
      toast.error("This booking is historical and cannot be modified.")
      return
    }
    if (!values.lines.length) {
      setFormError("Add at least one service item.")
      toast.error("Add at least one service item.")
      return
    }
    if (!values.customerId || !values.appointmentDate || !values.appointmentStartTime) {
      setFormError("Customer, date and start time are required.")
      toast.error("Customer, date and start time are required.")
      return
    }

    setSaving(true)
    setFormError("")
    try {
      setStartSuggestion(null)

      const response = await fetch(
        editingId ? `/api/appointments/orders/${editingId}` : "/api/appointments/orders",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", ...(!editingId ? await creationHeaders() : {}) },
          body: JSON.stringify({ ...orderInput, status: target === "confirm" ? "CONFIRMED" : "DRAFT" }),
        }
      )

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string
          suggestedStartAt?: string
          canApplySuggestion?: boolean
        }
        if (
          target === "confirm" &&
          data.suggestedStartAt &&
          data.canApplySuggestion !== false
        ) {
          setStartSuggestion({
            suggestedStartAt: data.suggestedStartAt,
            reason: data.error ?? "Selected time is unavailable.",
            requestKey,
          })
        }
        setFormError(data.error ?? "Unable to save booking.")
        toast.error(data.error ?? "Unable to save booking.")
        return
      }

      const data = (await response.json()) as { order?: AppointmentOrderRow }
      const nextId = data.order?.id ?? editingId
      if (data.order) {
        applyOrderToForm(data.order)
      }
      toast.success(target === "draft" ? "Draft saved." : "Booking confirmed.")
      setEditOpen(false)
      if (nextId) {
        router.replace(`/appointments/${nextId}/edit`)
      }
    } catch { setFormError("Unable to save booking. Please try again.") } finally { setSaving(false) }
  }

  const handlePrintInvoice = React.useCallback(() => {
    if (!canExport) return
    if (!editingId) {
      toast.error("Save the booking before printing the invoice.")
      return
    }
    window.open(`/api/appointments/orders/${editingId}/invoice`, "_blank", "noopener")
  }, [editingId, canExport])

  const handleEmailInvoice = React.useCallback(async () => {
    if (!canEmail) return
    if (!editingId) {
      toast.error("Save the booking before emailing the invoice.")
      return
    }
    setEmailing(true)
    try {
      const response = await fetch(`/api/appointments/orders/${editingId}/invoice-email`, {
        method: "POST",
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        toast.error(data.error ?? "Unable to email invoice.")
        return
      }
      toast.success("Invoice emailed.")
    } catch { toast.error("Unable to email invoice.") } finally { setEmailing(false) }
  }, [editingId, canEmail])

  React.useEffect(() => {
    if (savedLineScheduleKey && savedLineScheduleKey !== requestKey) {
      setSavedLineSchedule({})
      setSavedLineScheduleKey(null)
    }
  }, [requestKey, savedLineScheduleKey])

  if (loading || !settingsReady) {
    return <div className="text-sm text-muted-foreground">Loading appointment...</div>
  }

  const activeSuggestion =
    startSuggestion?.requestKey === requestKey ? startSuggestion : null

  const applySuggestedStart = (suggestion: StartSuggestion) => {
    const suggestedDate = new Date(suggestion.suggestedStartAt)
    if (Number.isNaN(suggestedDate.getTime())) return
    setValues((prev) => ({
      ...prev,
      appointmentDate: toDateInput(suggestedDate),
      appointmentStartTime: toTimeInput(suggestedDate),
    }))
    setStartSuggestion(null)
    toast.success("Applied next available start time.")
  }

  const closeCreate = () => { if (JSON.stringify(values) !== initialDraft) setDiscardCreate(true); else router.push("/appointments") }
  const formContent = <>
      {activeSuggestion && !isReadOnlyBooking ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          <p>{activeSuggestion.reason}</p>
          <p className="mt-1">
            Next available start:{" "}
            {`${toDateInput(new Date(activeSuggestion.suggestedStartAt))} ${formatTimeFromDate(
              new Date(activeSuggestion.suggestedStartAt),
              settings
            )}`}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => applySuggestedStart(activeSuggestion)}
          >
            Apply suggested time
          </Button>
        </div>
      ) : null}

      <div className={isReadOnlyBooking ? "pointer-events-none select-none opacity-80" : undefined}>
        <AppointmentOrderFormFields
          values={values}
          setValues={setValues}
          errors={errors}
          customers={customers}
          staff={staff}
          staffScope={{ family: "ORDER", action: editingId ? "edit" : "create", sourceId: editingId ?? undefined, headers: creationHeaders }}
          onStaffChoice={choice => setStaff(previous => [...previous.filter(row => row.id !== choice.id), choice])}
          services={services}
          products={products}
          productsEnabled={productsAllowed}
          couponsEnabled={couponsAllowed}
          timeFormat={settings.timeFormat}
          timeZone={timeZone}
          couponOptions={coupons.map((coupon) => ({
            value: coupon.code,
            label: `${coupon.code} (${formatCouponScopeLabel(coupon)})`,
          }))}
          couponHints={pricingPreview?.couponHints ?? []}
          formatCurrencyCentsValue={(valueInCents) => formatCurrencyFromCents(valueInCents, settings)}
          allowMultipleLines
          linePricingById={linePricingById}
          lineScheduleMeta={scheduleMetaByLineId}
        />
      </div>

      <Section title="Schedule preview">
        <p className="mb-3 text-xs text-muted-foreground">
          Services are scheduled sequentially from the selected start time; wait gaps appear when a later slot is needed.
        </p>
        {schedulePreview.length ? (
          <div className="space-y-2">
            {schedulePreview.map((slot) => (
              <div
                key={slot.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <div className="font-medium">
                  {slot.index + 1}. {slot.serviceLabel}
                </div>
                <div className="text-xs text-muted-foreground">
                  {slot.staffLabel}
                </div>
                <div className="text-xs font-medium">
                  {slot.startsAtLabel} - {slot.endsAtLabel} ({slot.durationMinutes}m)
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Select date and start time to preview slots.
          </p>
        )}
      </Section>

      <Section title="Totals">
        {totals ? <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="text-muted-foreground">Subtotal after line discounts (excl. tax)</div>
          <div className="text-right">{formatCurrencyFromCents(subtotalAfterLineDiscounts(totals), settings)}</div>
          <div className="text-muted-foreground">Line discounts included</div>
          <div className="text-right">{formatCurrencyFromCents(totals.lineDiscountCents, settings)}</div>
          <div className="text-muted-foreground">Coupon</div>
          <div className="text-right">- {formatCurrencyFromCents(totals.couponDiscountCents, settings)}</div>
          <div className="text-muted-foreground">Tax</div>
          <div className="text-right">{formatCurrencyFromCents(totals.taxCents, settings)}</div>
          <div className="font-semibold">Grand total</div>
          <div className="text-right font-semibold">{formatCurrencyFromCents(totals.totalCents, settings)}</div>
        </div> : <div role="status" className="text-sm text-muted-foreground">
          {previewError ?? (!previewKey ? "Select a customer and items with attendants, and enter a valid date and start time to calculate pricing." : "Calculating pricing...")}
          {previewError && <Button type="button" variant="outline" size="sm" className="ml-3" onClick={() => { setPreviewState(null); retryPreview() }}>Retry pricing</Button>}
        </div>}
        {pricingPreview?.source === "saved" && <p className="mt-3 text-xs text-muted-foreground">Saved prices and taxes retained. Changing items, prices or coupons recalculates pricing.</p>}
      </Section>
  </>
  if (loadError) return <div className={pageClass}><PageHeader title="Booking" backHref="/appointments" /><p role="alert" className="text-destructive">{loadError}</p></div>
  return <div className={pageClass}>
    <PageHeader title={mode === "create" ? "New booking" : "Booking"} description={canWrite ? currentStatusMeta.helperText : "View saved booking details and pricing."} badge={<span className={`rounded-full border px-2 py-0.5 text-xs ${currentStatusMeta.badgeClass}`}>{currentStatusMeta.label}</span>} actions={mode === "create" ? <>
      <Button variant="outline" disabled={saving} onClick={closeCreate}>Cancel</Button>
      <Button variant="outline" disabled={!canWrite || !pricingPreview} loading={saving} onClick={() => void handleSave("draft")}>Save draft</Button>
      <Button disabled={!canWrite || !pricingPreview} loading={saving} onClick={() => void handleSave("confirm")}>Confirm booking</Button>
    </> : <>
      <Button variant="outline" onClick={() => router.push("/appointments")}>Back</Button>
      <Button variant="outline" onClick={handlePrintInvoice} disabled={!savedOrder || !canExport}>Print invoice</Button>
      <Button variant="outline" onClick={() => void handleEmailInvoice()} loading={emailing} disabled={!savedOrder || !canEmail || savedOrder.office?.active === false}>Email invoice</Button>
      {canWrite && !isReadOnlyBooking && savedOrder && <Button onClick={() => { applyOrderToForm(savedOrder); setFormError(""); setEditOpen(true) }}>Edit booking</Button>}
    </>} />
    {savedOrder?.office && <p className="text-sm text-muted-foreground">Office: {savedOrder.office.companyName} / {savedOrder.office.name}{!savedOrder.office.active && " (closed; read-only)"}</p>}
    {isReadOnlyBooking && <p className="text-sm text-muted-foreground">This booking is in the past or in a closed status and is read-only.</p>}
    {mode === "create" ? <>{formError && <p role="alert" className="text-destructive">{formError}</p>}<fieldset disabled={saving || !canWrite} className="min-w-0 space-y-6">{formContent}</fieldset></> : savedOrder && <AppointmentOrderSummary order={savedOrder} settings={settings} />}
    {editOpen && savedOrder && <DraftPanel disabled={!canWrite || !pricingPreview} title="Edit booking" description="Update booking details, items and schedule." fingerprint={values} saving={saving} error={formError} footerActions={canSaveDraft ? <Button type="button" disabled={saving || !pricingPreview} onClick={() => void handleSave("draft")}>Save draft</Button> : undefined} saveLabel={primaryActionLabel} onClose={() => { applyOrderToForm(savedOrder); setStartSuggestion(null); setEditOpen(false) }} onSubmit={() => void handleSave("confirm")}>
      {formContent}
    </DraftPanel>}
    {discardCreate && <ConfirmAction title="Discard unsaved booking?" description="Your booking has not been saved." label="Discard changes" busy={false} onCancel={() => setDiscardCreate(false)} onConfirm={() => router.push("/appointments")} />}
  </div>
}
