"use client"

import { Select, Textarea, Checkbox } from "@/components/erp/controls"

import { useCurrentResourceAction } from "@/platform/access/view-guard"

import { Section } from "@/components/erp/section"
import { FormField } from "@/components/form-field"
import { Trash2Icon } from "lucide-react"
import { RecordSelect } from "@/components/erp/record-select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type {
  InventoryProductFormValues,
} from "@/types/inventory"
import type { InventoryUnit } from "@/lib/constants/inventory"
import type { TaxRow } from "@/types/scheduling"
import {
  inventoryProductStatusOptions,
  inventoryProductUnitOptions,
} from "./product-form-model"

type ProductFormFieldsProps = {
  values: InventoryProductFormValues
  errors: Record<string, string | undefined>
  selectedCategory?: { id: string; name: string }
  selectedSuppliers: { supplierId: string; supplierName: string }[]
  taxes: TaxRow[]
  onChange: (next: InventoryProductFormValues) => void
}

const updateSupplierLink = (
  values: InventoryProductFormValues,
  index: number,
  patch: Partial<InventoryProductFormValues["supplierLinks"][number]>
) =>
  values.supplierLinks.map((link, linkIndex) =>
    linkIndex === index ? { ...link, ...patch } : link
  )

export function ProductFormFields({
  values,
  errors,
  selectedCategory,
  selectedSuppliers,
  taxes,
  onChange,
}: ProductFormFieldsProps) {
  const canArchive = useCurrentResourceAction("archive")

  return (
    <div className="space-y-5"><Section title="Product details">
      <div className="grid gap-4 md:grid-cols-2">
        <FormField id="product-sku" label="SKU" error={errors.sku}>
          <Input
            id="product-sku"
            required minLength={2}
            value={values.sku}
            onChange={(event) => onChange({ ...values, sku: event.target.value })}
          />
        </FormField>
        <FormField id="product-name" label="Product name" error={errors.name}>
          <Input
            id="product-name"
            required minLength={2}
            value={values.name}
            onChange={(event) => onChange({ ...values, name: event.target.value })}
          />
        </FormField>
      </div>

      <FormField id="product-description" label="Description" error={errors.description}>
        <Textarea
          id="product-description"
          value={values.description}
          onChange={(event) => onChange({ ...values, description: event.target.value })}
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="product-unit" label="Unit" error={errors.unit}>
          <Select
            id="product-unit"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={values.unit}
            onValueChange={(value) =>
              onChange({ ...values, unit: value as InventoryUnit })
            }
          >
            {inventoryProductUnitOptions.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="product-category" label="Category" error={errors.categoryId}>
          <RecordSelect
            id="product-category"
            value={values.categoryId}
            placeholder="Select category"
            endpoint="/api/inventory/categories?status=ACTIVE"
            selected={selectedCategory ? { value: selectedCategory.id, label: selectedCategory.name } : undefined}
            onChange={(nextValue) => onChange({ ...values, categoryId: nextValue })}
          />
        </FormField>
        <FormField id="product-status" label="Status" error={errors.status}>
          <Select
            id="product-status"
            disabled={!canArchive}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={values.status}
            onValueChange={(value) =>
              onChange({
                ...values,
                status: value as InventoryProductFormValues["status"],
              })
            }
          >
            {inventoryProductStatusOptions.map((status) => (
              <option key={status} value={status}>
                {status === "ACTIVE" ? "Active" : "Inactive"}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      </Section><Section title="Pricing and stock">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="product-cp" label="Cost price (CP)" error={errors.costPriceCents}>
          <Input
            id="product-cp"
            value={values.costPrice}
            onChange={(event) => onChange({ ...values, costPrice: event.target.value })}
          />
        </FormField>
        <FormField id="product-mrp" label="MRP" error={errors.mrpCents}>
          <Input
            id="product-mrp"
            value={values.mrp}
            onChange={(event) => onChange({ ...values, mrp: event.target.value })}
          />
        </FormField>
        <FormField id="product-on-hand" label="Stock on hand" error={errors.onHandQty}>
          <Input
            id="product-on-hand"
            type="number"
            min={0}
            value={values.onHandQty}
            onChange={(event) =>
              onChange({
                ...values,
                onHandQty: Math.max(0, Number(event.target.value || 0)),
              })
            }
          />
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="product-reorder-point" label="Reorder point" error={errors.reorderPoint}>
          <Input
            id="product-reorder-point"
            type="number"
            min={0}
            value={values.reorderPoint}
            onChange={(event) =>
              onChange({
                ...values,
                reorderPoint: Math.max(0, Number(event.target.value || 0)),
              })
            }
          />
        </FormField>
        <FormField id="product-reorder-qty" label="Reorder qty" error={errors.reorderQty}>
          <Input
            id="product-reorder-qty"
            type="number"
            min={0}
            value={values.reorderQty}
            onChange={(event) =>
              onChange({
                ...values,
                reorderQty: Math.max(0, Number(event.target.value || 0)),
              })
            }
          />
        </FormField>
        <label className="inline-flex items-center gap-2 text-sm pt-8">
          <Checkbox
            checked={values.isPhysical}
            onChange={(event) =>
              onChange({ ...values, isPhysical: event.target.checked })
            }
          />
          Physical product
        </label>
      </div>

      </Section><Section title="Taxes">
      <div className="space-y-2">
        <div className="grid gap-2 md:grid-cols-2">
          {taxes.map((tax) => {
            const checked = values.taxIds.includes(tax.id)
            return (
              <label key={tax.id} className="inline-flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  onChange={(event) =>
                    onChange({
                      ...values,
                      taxIds: event.target.checked
                        ? [...values.taxIds, tax.id]
                        : values.taxIds.filter((taxId) => taxId !== tax.id),
                    })
                  }
                />
                {tax.name} ({tax.percent}%)
              </label>
            )
          })}
        </div>
      </div>

      </Section><Section title="Suppliers">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Supplier links</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange({
                ...values,
                supplierLinks: [
                  ...values.supplierLinks,
                  {
                    supplierId: "",
                    supplierSku: "",
                    supplierCost: "",
                    minOrderQty: 1,
                    leadTimeDays: 0,
                    isPreferred: values.supplierLinks.length === 0,
                  },
                ],
              })
            }
          >
            Add supplier
          </Button>
        </div>
        {values.supplierLinks.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No suppliers linked. Add one or more suppliers for purchasing.
          </p>
        ) : null}
        {values.supplierLinks.map((link, index) => (
          <div key={`${link.supplierId}-${index}`} className="rounded-md border p-3 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <FormField
                id={`supplier-${index}`}
                label="Supplier"
                error={errors[`supplierLinks.${index}.supplierId`]}
              >
                <RecordSelect
                  id={`supplier-${index}`}
                  value={link.supplierId}
                  placeholder="Select supplier"
                  endpoint="/api/inventory/suppliers?status=ACTIVE"
                  selected={selectedSuppliers.find(row => row.supplierId === link.supplierId) ? { value: link.supplierId, label: selectedSuppliers.find(row => row.supplierId === link.supplierId)!.supplierName } : undefined}
                  onChange={(nextValue) =>
                    onChange({
                      ...values,
                      supplierLinks: updateSupplierLink(values, index, {
                        supplierId: nextValue,
                      }),
                    })
                  }
                />
              </FormField>
              <FormField
                id={`supplier-sku-${index}`}
                label="Supplier SKU"
                error={errors[`supplierLinks.${index}.supplierSku`]}
              >
                <Input
                  id={`supplier-sku-${index}`}
                  value={link.supplierSku}
                  onChange={(event) =>
                    onChange({
                      ...values,
                      supplierLinks: updateSupplierLink(values, index, {
                        supplierSku: event.target.value,
                      }),
                    })
                  }
                />
              </FormField>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                id={`supplier-cost-${index}`}
                label="Supplier cost"
                error={errors[`supplierLinks.${index}.supplierCostCents`]}
              >
                <Input
                  id={`supplier-cost-${index}`}
                  value={link.supplierCost}
                  onChange={(event) =>
                    onChange({
                      ...values,
                      supplierLinks: updateSupplierLink(values, index, {
                        supplierCost: event.target.value,
                      }),
                    })
                  }
                />
              </FormField>
              <FormField
                id={`supplier-min-${index}`}
                label="Min order qty"
                error={errors[`supplierLinks.${index}.minOrderQty`]}
              >
                <Input
                  id={`supplier-min-${index}`}
                  type="number"
                  min={1}
                  value={link.minOrderQty}
                  onChange={(event) =>
                    onChange({
                      ...values,
                      supplierLinks: updateSupplierLink(values, index, {
                        minOrderQty: Math.max(1, Number(event.target.value || 1)),
                      }),
                    })
                  }
                />
              </FormField>
              <FormField
                id={`supplier-lead-${index}`}
                label="Lead days"
                error={errors[`supplierLinks.${index}.leadTimeDays`]}
              >
                <Input
                  id={`supplier-lead-${index}`}
                  type="number"
                  min={0}
                  value={link.leadTimeDays}
                  onChange={(event) =>
                    onChange({
                      ...values,
                      supplierLinks: updateSupplierLink(values, index, {
                        leadTimeDays: Math.max(0, Number(event.target.value || 0)),
                      }),
                    })
                  }
                />
              </FormField>
            </div>
            <div className="flex items-center justify-between">
              <label className="inline-flex items-center gap-2 text-sm">
                <Checkbox
                  checked={link.isPreferred}
                  onChange={(event) =>
                    onChange({
                      ...values,
                      supplierLinks: values.supplierLinks.map((entry, entryIndex) => ({
                        ...entry,
                        isPreferred:
                          entryIndex === index ? event.target.checked : false,
                      })),
                    })
                  }
                />
                Preferred supplier
              </label>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Remove supplier link"
                onClick={() =>
                  onChange({
                    ...values,
                    supplierLinks: values.supplierLinks.filter(
                      (_, entryIndex) => entryIndex !== index
                    ),
                  })
                }
              >
                <Trash2Icon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Section>
    </div>
  )
}
