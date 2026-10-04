"use client"

import { Section } from "@/components/erp/section"
import { Textarea } from "@/components/erp/controls"
import { Select } from "@/components/erp/controls"

import * as React from "react"
import { Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { FormField } from "@/components/form-field"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/searchable-select"
import { TimePicker } from "@/components/ui/time-picker"
import type {
  AppointmentCustomerOption,
  AppointmentOrderFormValues,
  AppointmentProductOption,
  AppointmentServiceOption,
  AppointmentStaffOption,
  DiscountType,
} from "@/types/appointments"
import type { TimeFormat } from "@/types/scheduling"
import {
  addCouponCode,
  createEmptyOrderLine,
  createEmptyProductLine,
  formatCurrencyCents,
} from "./appointment-order-form-model"

type AppointmentOrderFormFieldsProps = {
  values: AppointmentOrderFormValues
  setValues: React.Dispatch<React.SetStateAction<AppointmentOrderFormValues>>
  errors: Record<string, string>
  customers: AppointmentCustomerOption[]
  staff: AppointmentStaffOption[]
  services: AppointmentServiceOption[]
  products: AppointmentProductOption[]
  productsEnabled?: boolean
  couponsEnabled?: boolean
  couponOptions?: Array<{ value: string; label: string }>
  couponHints?: Array<{
    code: string
    eligible: boolean
    reason?: string
    discountCents?: number
  }>
  formatCurrencyCentsValue?: (valueInCents: number) => string
  allowMultipleLines?: boolean
  lineTaxCentsById?: Record<string, number>
  lineScheduleMeta?: Record<
    string,
    {
      startsAtLabel: string
      endsAtLabel: string
      waitMinutes: number
    }
  >
  timeFormat?: TimeFormat
}

export function AppointmentOrderFormFields({
  values,
  setValues,
  errors,
  customers,
  staff,
  services,
  products,
  productsEnabled = true,
  couponsEnabled = true,
  couponOptions = [],
  couponHints = [],
  formatCurrencyCentsValue = formatCurrencyCents,
  allowMultipleLines = true,
  lineTaxCentsById = {},
  lineScheduleMeta = {},
  timeFormat = "H24",
}: AppointmentOrderFormFieldsProps) {
  const [priceInputs, setPriceInputs] = React.useState<Record<string, string>>({})

  const getLineTotalCents = (
    quantity: number,
    unitPriceCents: number,
    discountType: DiscountType,
    discountValue: number
  ) => {
    const subtotal = Math.max(0, quantity) * Math.max(0, unitPriceCents)
    if (discountType === "NONE" || discountValue <= 0) return subtotal
    if (discountType === "AMOUNT") {
      return Math.max(0, subtotal - Math.round(discountValue * 100))
    }
    const percentDiscount = Math.round((subtotal * discountValue) / 100)
    return Math.max(0, subtotal - percentDiscount)
  }

  const update = <K extends keyof AppointmentOrderFormValues>(
    key: K,
    value: AppointmentOrderFormValues[K]
  ) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  const getPriceInputValue = (lineId: string, unitPriceCents: number) => {
    if (Object.prototype.hasOwnProperty.call(priceInputs, lineId)) {
      return priceInputs[lineId]
    }
    if (!unitPriceCents) return ""
    return (unitPriceCents / 100).toString()
  }

  return (
    <div className="grid gap-6">
      <div className="space-y-4">
        <Section title="Booking details">
          <div className="space-y-3">
            <FormField id="order-customer" label="Customer" error={errors.customerId}>
              <SearchableSelect
                id="order-customer"
                value={values.customerId}
                placeholder="Select customer"
                searchPlaceholder="Search customer..."
                options={customers.map((customer) => ({
                  value: customer.id,
                  label: `${customer.name?.trim() || customer.email} (${customer.email})`,
                }))}
                onChange={(nextValue) => update("customerId", nextValue)}
              />
            </FormField>
            <FormField id="order-date" label="Date">
              <Input
                id="order-date"
                type="date"
                value={values.appointmentDate}
                onChange={(event) => update("appointmentDate", event.target.value)}
              />
            </FormField>
            <FormField id="order-start" label="Start time">
              <TimePicker
                id="order-start"
                value={values.appointmentStartTime}
                timeFormat={timeFormat}
                minuteStep={15}
                onChange={(nextValue) => update("appointmentStartTime", nextValue)}
              />
            </FormField>
            <fieldset disabled={!couponsEnabled} className="min-w-0">
            <FormField id="order-coupon" label="Coupon code">
              <div className="space-y-2">
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <SearchableSelect
                    id="order-coupon"
                    value={values.couponInput}
                    placeholder="Select coupon"
                    searchPlaceholder="Search coupon..."
                    options={couponOptions}
                    onChange={(nextValue) => update("couponInput", nextValue)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const nextCoupons = addCouponCode(values.coupons, values.couponInput)
                      setValues((prev) => ({
                        ...prev,
                        coupons: nextCoupons,
                        couponInput: "",
                      }))
                    }}
                  >
                    Apply
                  </Button>
                </div>
                {values.coupons.length ? (
                  <div className="flex flex-wrap gap-2">
                    {values.coupons.map((coupon) => (
                      <button
                        key={coupon.code}
                        type="button"
                        className="rounded-md border border-input px-2 py-1 text-xs"
                        onClick={() =>
                          setValues((prev) => ({
                            ...prev,
                            coupons: prev.coupons.filter((item) => item.code !== coupon.code),
                          }))
                        }
                      >
                        {coupon.code} x
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No coupons applied.</p>
                )}
                {couponOptions.length ? (
                  <p className="text-xs text-muted-foreground">
                    Select from active coupons. Click an applied coupon chip to remove it.
                  </p>
                ) : null}
                {couponHints.length ? (
                  <div className="space-y-1 rounded-md border border-input p-2">
                    {couponHints.map((hint) => (
                      <p
                        key={hint.code}
                        className={`text-xs ${hint.eligible ? "text-emerald-600" : "text-amber-700"}`}
                      >
                        {hint.code}:{" "}
                        {hint.eligible
                          ? `Applied (${formatCurrencyCentsValue(hint.discountCents ?? 0)})`
                          : hint.reason ?? "Not applicable"}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            </FormField>
            </fieldset>
            <FormField id="order-customer-note" label="Customer note">
              <Textarea
                id="order-customer-note"
                value={values.customerNote}
                onChange={(event) => update("customerNote", event.target.value)}
              />
            </FormField>
            <FormField id="order-internal-note" label="Internal note">
              <Textarea
                id="order-internal-note"
                value={values.internalNote}
                onChange={(event) => update("internalNote", event.target.value)}
              />
            </FormField>
          </div>
        </Section>
      </div>
      <Section title="Service items">
        <div className="flex items-center justify-between">

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!allowMultipleLines}
            onClick={() =>
              setValues((prev) => ({
                ...prev,
                lines: [...prev.lines, createEmptyOrderLine()],
              }))
            }
          >
            Add item
          </Button>
        </div>

        <div className="space-y-3">
          {values.lines.map((line, index) => (
            <div key={line.id} className="rounded-lg border bg-background p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-muted-foreground">Item {index + 1}</span>
                  {lineScheduleMeta[line.id] ? (
                    <>
                      <span className="rounded border border-input px-2 py-0.5 text-foreground">
                        {lineScheduleMeta[line.id].startsAtLabel} - {lineScheduleMeta[line.id].endsAtLabel}
                      </span>
                      {lineScheduleMeta[line.id].waitMinutes > 0 ? (
                        <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-amber-800 dark:text-amber-300">
                          Wait {lineScheduleMeta[line.id].waitMinutes}m
                        </span>
                      ) : null}
                    </>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={`Remove service item ${index + 1}`}
                  onClick={() =>
                    setValues((prev) => ({
                      ...prev,
                      lines:
                        prev.lines.length > 1
                          ? prev.lines.filter((item) => item.id !== line.id)
                          : prev.lines,
                    }))
                  }
                  disabled={!allowMultipleLines || values.lines.length <= 1}
                >
                  <Trash2Icon className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField id={`line-service-${line.id}`} label="Service">
                  <SearchableSelect
                    id={`line-service-${line.id}`}
                    value={line.serviceId}
                    placeholder="Select service"
                    searchPlaceholder="Search service..."
                    options={services.map((service) => ({
                      value: service.id,
                      label: `${service.name} (${service.durationMinutes}m)`,
                    }))}
                    onChange={(nextValue) => {
                      const service = services.find((item) => item.id === nextValue)
                      setValues((prev) => ({
                        ...prev,
                        lines: prev.lines.map((item) =>
                          item.id === line.id
                            ? {
                                ...item,
                                serviceId: nextValue,
                                durationMinutes: service?.durationMinutes ?? 0,
                                unitPriceCents: service?.priceCents ?? item.unitPriceCents,
                                taxIds: service?.taxIds ?? [],
                                taxMode: service?.taxMode ?? "EXCLUSIVE",
                              }
                            : item
                        ),
                      }))
                    }}
                  />
                </FormField>
                <FormField id={`line-staff-${line.id}`} label="Attendant">
                  <SearchableSelect
                    id={`line-staff-${line.id}`}
                    value={line.staffId}
                    placeholder="Select attendant"
                    searchPlaceholder="Search attendant..."
                    options={staff.map((member) => ({
                      value: member.id,
                      label: member.name?.trim() || member.email,
                    }))}
                    onChange={(nextValue) =>
                      setValues((prev) => ({
                        ...prev,
                        lines: prev.lines.map((item) =>
                          item.id === line.id ? { ...item, staffId: nextValue } : item
                        ),
                      }))
                    }
                  />
                </FormField>
                <FormField id={`line-qty-${line.id}`} label="Qty">
                  <Input
                    id={`line-qty-${line.id}`}
                    type="number"
                    min={1}
                    value={line.quantity}
                    onChange={(event) =>
                      setValues((prev) => ({
                        ...prev,
                        lines: prev.lines.map((item) =>
                          item.id === line.id
                            ? { ...item, quantity: Math.max(1, Number(event.target.value || 1)) }
                            : item
                        ),
                      }))
                    }
                  />
                </FormField>
                <FormField id={`line-price-${line.id}`} label="Unit price">
                  <Input
                    id={`line-price-${line.id}`}
                    type="text"
                    inputMode="decimal"
                    min={0}
                    value={getPriceInputValue(line.id, line.unitPriceCents)}
                    onChange={(event) =>
                      {
                        const nextValue = event.target.value
                        setPriceInputs((prev) => ({ ...prev, [line.id]: nextValue }))
                        const parsed = Number.parseFloat(nextValue)
                        if (Number.isNaN(parsed)) return
                        setValues((prev) => ({
                          ...prev,
                          lines: prev.lines.map((item) =>
                            item.id === line.id
                              ? {
                                  ...item,
                                  unitPriceCents: Math.max(0, Math.round(parsed * 100)),
                                }
                              : item
                          ),
                        }))
                      }
                    }
                    onBlur={() => {
                      const raw = priceInputs[line.id]
                      if (raw === undefined) return
                      const parsed = Number.parseFloat(raw)
                      if (!Number.isNaN(parsed)) {
                        const normalized = (Math.max(0, parsed)).toFixed(2)
                        setPriceInputs((prev) => ({ ...prev, [line.id]: normalized }))
                      } else {
                        setPriceInputs((prev) => {
                          const next = { ...prev }
                          delete next[line.id]
                          return next
                        })
                      }
                    }}
                  />
                </FormField>
                <FormField id={`line-discount-type-${line.id}`} label="Discount type">
                  <Select
                    id={`line-discount-type-${line.id}`}
                    className="w-full"
                    value={line.discountType}
                    onValueChange={(value) =>
                      setValues((prev) => ({
                        ...prev,
                        lines: prev.lines.map((item) =>
                          item.id === line.id
                            ? { ...item, discountType: value as DiscountType }
                            : item
                        ),
                      }))
                    }
                  >
                    <option value="NONE">None</option>
                    <option value="PERCENT">Percent</option>
                    <option value="AMOUNT">Amount</option>
                  </Select>
                </FormField>
                <FormField id={`line-discount-value-${line.id}`} label="Discount value">
                  <Input
                    id={`line-discount-value-${line.id}`}
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.discountValue}
                    onChange={(event) =>
                      setValues((prev) => ({
                        ...prev,
                        lines: prev.lines.map((item) =>
                          item.id === line.id
                            ? { ...item, discountValue: Math.max(0, Number(event.target.value || 0)) }
                            : item
                        ),
                      }))
                    }
                  />
                </FormField>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <FormField id={`line-note-${line.id}`} label="Line note">
                  <Input
                    id={`line-note-${line.id}`}
                    value={line.note}
                    onChange={(event) =>
                      setValues((prev) => ({
                        ...prev,
                        lines: prev.lines.map((item) =>
                          item.id === line.id ? { ...item, note: event.target.value } : item
                        ),
                      }))
                    }
                  />
                </FormField>
                <div className="justify-self-end text-right">
                  {(() => {
                    const baseLineTotalCents = getLineTotalCents(
                      line.quantity,
                      line.unitPriceCents,
                      line.discountType,
                      line.discountValue
                    )
                    const taxCents = lineTaxCentsById[line.id] ?? line.lineTaxCents ?? 0
                    const netCents =
                      line.taxMode === "INCLUSIVE"
                        ? Math.max(0, baseLineTotalCents - taxCents)
                        : baseLineTotalCents
                    const totalCents =
                      line.taxMode === "INCLUSIVE"
                        ? baseLineTotalCents
                        : baseLineTotalCents + taxCents

                    return (
                      <div className="grid gap-1 text-right text-xs text-muted-foreground">
                        <div className="flex items-center justify-end gap-3">
                          <span>Price</span>
                          <span className="min-w-[80px] text-foreground">
                            {formatCurrencyCentsValue(netCents)}
                          </span>
                        </div>
                        <div className="flex items-center justify-end gap-3">
                          <span>Tax</span>
                          <span className="min-w-[80px] text-foreground">
                            {formatCurrencyCentsValue(taxCents)}
                          </span>
                        </div>
                        <div className="flex items-center justify-end gap-3">
                          <span>Total</span>
                          <span className="min-w-[80px] text-sm font-semibold text-foreground">
                            {formatCurrencyCentsValue(totalCents)}
                          </span>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              </div>
            </div>
          ))}
        </div>

        </Section>
      <fieldset disabled={!productsEnabled} className="min-w-0">
      <Section title="Product items">
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setValues((prev) => ({
                ...prev,
                productLines: [...(prev.productLines ?? []), createEmptyProductLine()],
              }))
            }
          >
            Add product
          </Button>
        </div>

        {!(values.productLines ?? []).length ? (
          <p className="text-xs text-muted-foreground">No products added.</p>
        ) : null}

        <div className="space-y-3">
          {(values.productLines ?? []).map((line, index) => (
            <div key={line.id} className="rounded-lg border bg-background p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-muted-foreground">Product {index + 1}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={`Remove product item ${index + 1}`}
                  onClick={() =>
                    setValues((prev) => ({
                      ...prev,
                      productLines: (prev.productLines ?? []).filter((item) => item.id !== line.id),
                    }))
                  }
                >
                  <Trash2Icon className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField id={`line-product-${line.id}`} label="Product">
                  <SearchableSelect
                    id={`line-product-${line.id}`}
                    value={line.productId}
                    placeholder="Select product"
                    searchPlaceholder="Search product..."
                    options={products.map((product) => ({
                      value: product.id,
                      label: `${product.name} (${product.sku})`,
                    }))}
                    onChange={(nextValue) => {
                      const product = products.find((item) => item.id === nextValue)
                      setValues((prev) => ({
                        ...prev,
                        productLines: (prev.productLines ?? []).map((item) =>
                          item.id === line.id
                            ? {
                                ...item,
                                productId: nextValue,
                                unitPriceCents: product?.mrpCents ?? item.unitPriceCents,
                                taxIds: product?.taxIds ?? [],
                              }
                            : item
                        ),
                      }))
                    }}
                  />
                </FormField>
                <FormField id={`line-product-qty-${line.id}`} label="Qty">
                  <Input
                    id={`line-product-qty-${line.id}`}
                    type="number"
                    min={1}
                    value={line.quantity}
                    onChange={(event) =>
                      setValues((prev) => ({
                        ...prev,
                        productLines: (prev.productLines ?? []).map((item) =>
                          item.id === line.id
                            ? { ...item, quantity: Math.max(1, Number(event.target.value || 1)) }
                            : item
                        ),
                      }))
                    }
                  />
                </FormField>
                <FormField id={`line-product-price-${line.id}`} label="Unit price">
                  <Input
                    id={`line-product-price-${line.id}`}
                    type="text"
                    inputMode="decimal"
                    min={0}
                    value={getPriceInputValue(`product-${line.id}`, line.unitPriceCents)}
                    onChange={(event) => {
                      const inputKey = `product-${line.id}`
                      const nextValue = event.target.value
                      setPriceInputs((prev) => ({ ...prev, [inputKey]: nextValue }))
                      const parsed = Number.parseFloat(nextValue)
                      if (Number.isNaN(parsed)) return
                      setValues((prev) => ({
                        ...prev,
                        productLines: (prev.productLines ?? []).map((item) =>
                          item.id === line.id
                            ? {
                                ...item,
                                unitPriceCents: Math.max(0, Math.round(parsed * 100)),
                              }
                            : item
                        ),
                      }))
                    }}
                    onBlur={() => {
                      const inputKey = `product-${line.id}`
                      const raw = priceInputs[inputKey]
                      if (raw === undefined) return
                      const parsed = Number.parseFloat(raw)
                      if (!Number.isNaN(parsed)) {
                        const normalized = Math.max(0, parsed).toFixed(2)
                        setPriceInputs((prev) => ({ ...prev, [inputKey]: normalized }))
                      } else {
                        setPriceInputs((prev) => {
                          const next = { ...prev }
                          delete next[inputKey]
                          return next
                        })
                      }
                    }}
                  />
                </FormField>
                <FormField id={`line-product-discount-type-${line.id}`} label="Discount type">
                  <Select
                    id={`line-product-discount-type-${line.id}`}
                    className="w-full"
                    value={line.discountType}
                    onValueChange={(value) =>
                      setValues((prev) => ({
                        ...prev,
                        productLines: (prev.productLines ?? []).map((item) =>
                          item.id === line.id
                            ? { ...item, discountType: value as DiscountType }
                            : item
                        ),
                      }))
                    }
                  >
                    <option value="NONE">None</option>
                    <option value="PERCENT">Percent</option>
                    <option value="AMOUNT">Amount</option>
                  </Select>
                </FormField>
                <FormField id={`line-product-discount-value-${line.id}`} label="Discount value">
                  <Input
                    id={`line-product-discount-value-${line.id}`}
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.discountValue}
                    onChange={(event) =>
                      setValues((prev) => ({
                        ...prev,
                        productLines: (prev.productLines ?? []).map((item) =>
                          item.id === line.id
                            ? { ...item, discountValue: Math.max(0, Number(event.target.value || 0)) }
                            : item
                        ),
                      }))
                    }
                  />
                </FormField>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <FormField id={`line-product-note-${line.id}`} label="Line note">
                  <Input
                    id={`line-product-note-${line.id}`}
                    value={line.note}
                    onChange={(event) =>
                      setValues((prev) => ({
                        ...prev,
                        productLines: (prev.productLines ?? []).map((item) =>
                          item.id === line.id ? { ...item, note: event.target.value } : item
                        ),
                      }))
                    }
                  />
                </FormField>
                <div className="justify-self-end text-right">
                  <div className="grid gap-1 text-right text-xs text-muted-foreground">
                    <div className="flex items-center justify-end gap-3">
                      <span>Total</span>
                      <span className="min-w-[80px] text-sm font-semibold text-foreground">
                        {formatCurrencyCentsValue(
                          getLineTotalCents(
                            line.quantity,
                            line.unitPriceCents,
                            line.discountType,
                            line.discountValue
                          )
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>
      </fieldset>


    </div>
  )
}

