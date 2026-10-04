"use client"

import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { RecordPanel, ReadOnlyFields } from "@/components/erp/record-detail"
import { Section } from "@/components/erp/section"
import type { InventoryCategoryRow, InventoryProductRow, SupplierRow, PurchaseOrderRow } from "@/types/inventory"

type ViewProps = { onClose: () => void; onEdit?: () => void }
const edit = (onEdit?: () => void) => onEdit ? <Button onClick={onEdit}>Edit details</Button> : undefined
const status = (value: string) => value.charAt(0) + value.slice(1).toLowerCase()

export function CategoryView({ item, onClose, onEdit }: ViewProps & { item: InventoryCategoryRow }) {
  return <RecordPanel title={item.name} description="Inventory category" onClose={onClose} actions={edit(onEdit)}>
    <Section title="Category details"><ReadOnlyFields fields={[{ label: "Name", value: item.name }, { label: "Status", value: status(item.status) }, { label: "Sort order", value: item.sortOrder }, { label: "Description", value: item.description }]} /></Section>
  </RecordPanel>
}

export function SupplierView({ item, onClose, onEdit }: ViewProps & { item: SupplierRow }) {
  return <RecordPanel title={item.name} description="Supplier details" onClose={onClose} actions={edit(onEdit)}>
    <Section title="Contact and ordering"><ReadOnlyFields fields={[{ label: "Contact person", value: item.contactPerson }, { label: "Email", value: item.email }, { label: "Phone", value: item.phone }, { label: "Lead days", value: item.leadTimeDays }, { label: "Status", value: status(item.status) }]} /></Section>
    <Section title="Tax registration"><ReadOnlyFields fields={[{ label: "Tax registered", value: item.isTaxRegistered ? "Yes" : "No" }, { label: "Registration type", value: item.taxRegistrationType }, { label: "Registration number", value: item.taxRegistrationNumber }]} /></Section>
    <Section title="Address"><ReadOnlyFields fields={[{ label: "City", value: item.city }, { label: "State / province", value: item.state }, { label: "Country", value: item.country }]} /></Section>
    <Section title="Notes"><p className="whitespace-pre-wrap break-words text-sm">{item.notes || "No notes."}</p></Section>
  </RecordPanel>
}

export function ProductView({ item, onClose, onEdit, formatMoney, taxNames }: ViewProps & { item: InventoryProductRow; formatMoney: (cents: number) => string; taxNames: string[] }) {
  return <RecordPanel title={item.name} description={item.sku} onClose={onClose} actions={edit(onEdit)}>
    <Section title="Product details"><ReadOnlyFields fields={[{ label: "SKU", value: item.sku }, { label: "Category", value: item.category.name }, { label: "Unit", value: item.unit }, { label: "Status", value: status(item.status) }, { label: "Description", value: item.description }]} /></Section>
    <Section title="Pricing and stock"><ReadOnlyFields fields={[{ label: "Cost price", value: formatMoney(item.costPriceCents) }, { label: "MRP", value: formatMoney(item.mrpCents) }, { label: "Stock on hand", value: item.onHandQty }, { label: "Reorder point", value: item.reorderPoint }, { label: "Reorder quantity", value: item.reorderQty }, { label: "Physical product", value: item.isPhysical ? "Yes" : "No" }]} /></Section>
    <Section title="Taxes"><p className="text-sm">{taxNames.length ? taxNames.join(", ") : item.taxIds.length ? `${item.taxIds.length} assigned taxes` : "No taxes assigned."}</p></Section>
    <Section title="Suppliers">{!item.supplierLinks.length ? <p className="text-sm text-muted-foreground">No linked suppliers.</p> : item.supplierLinks.map(link => <div key={link.supplierId} className="space-y-3 rounded-lg border p-4"><h3 className="font-medium">{link.supplierName}{link.isPreferred ? " (Preferred)" : ""}</h3><ReadOnlyFields fields={[{ label: "Supplier SKU", value: link.supplierSku }, { label: "Supplier cost", value: link.supplierCostCents === null ? null : formatMoney(link.supplierCostCents) }, { label: "Minimum order", value: link.minOrderQty }, { label: "Lead days", value: link.leadTimeDays }]} /></div>)}</Section>
  </RecordPanel>
}

export function PurchaseView({ item, onClose, actions, formatMoney, formatDate }: { item: PurchaseOrderRow; onClose: () => void; actions?: ReactNode; formatMoney: (cents: number) => string; formatDate: (value: string) => string }) {
  return <RecordPanel title={item.orderNumber} description="Purchase order" onClose={onClose} actions={actions}>
    <Section title="Order details"><ReadOnlyFields fields={[{ label: "Supplier", value: item.supplier.name }, { label: "Status", value: status(item.status) }, { label: "Order date", value: formatDate(item.orderDate) }, { label: "Expected date", value: item.expectedDate ? formatDate(item.expectedDate) : null }, { label: "Notes", value: item.notes }]} /></Section>
    <Section title="Order items">{item.items.map(line => <div key={line.id} className="space-y-3 rounded-lg border p-4"><h3 className="font-medium">{line.product.sku} — {line.product.name}</h3><ReadOnlyFields fields={[{ label: "Ordered quantity", value: line.quantity }, { label: "Received quantity", value: line.receivedQty }, { label: "Unit cost", value: formatMoney(line.unitCostCents) }, { label: "Tax", value: formatMoney(line.lineTaxCents) }, { label: "Line total", value: formatMoney(line.lineTotalCents) }]} /></div>)}</Section>
    <Section title="Totals"><ReadOnlyFields fields={[{ label: "Subtotal", value: formatMoney(item.subtotalCents) }, { label: "Tax", value: formatMoney(item.taxCents) }, { label: "Total", value: formatMoney(item.totalCents) }]} /></Section>
  </RecordPanel>
}
