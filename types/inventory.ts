import type { InventoryUnit } from "@/lib/constants/inventory"

export type InventoryCategoryStatus = "ACTIVE" | "INACTIVE"
export type SupplierStatus = "ACTIVE" | "INACTIVE"
export type TaxRegistrationType = "VAT" | "GST" | "SALES_TAX_ID" | "EIN" | "OTHER"
export type InventoryProductStatus = "ACTIVE" | "INACTIVE"
export type PurchaseOrderStatus = "DRAFT" | "ORDERED" | "RECEIVED" | "CANCELED"

export type InventoryCategoryRow = {
  id: string
  name: string
  description: string | null
  status: InventoryCategoryStatus
  sortOrder: number
  createdAt: string
}

export type InventoryCategoryOption = {
  id: string
  name: string
  status: InventoryCategoryStatus
}

export type SupplierRow = {
  notes?: string | null
  id: string
  name: string
  contactPerson: string | null
  email: string | null
  phone: string | null
  isTaxRegistered: boolean
  taxRegistrationType: TaxRegistrationType | null
  taxRegistrationNumber: string | null
  leadTimeDays: number
  status: SupplierStatus
  city: string | null
  state: string | null
  country: string | null
  createdAt: string
}

export type SupplierOption = {
  id: string
  name: string
  status: SupplierStatus
}

export type ProductSupplierLink = {
  supplierId: string
  supplierName: string
  supplierSku: string | null
  supplierCostCents: number | null
  minOrderQty: number
  leadTimeDays: number | null
  isPreferred: boolean
}

export type ProductSupplierFormLink = {
  supplierId: string
  supplierSku: string
  supplierCost: string
  minOrderQty: number
  leadTimeDays: number
  isPreferred: boolean
}

export type InventoryProductRow = {
  id: string
  sku: string
  name: string
  description: string | null
  unit: InventoryUnit
  category: { id: string; name: string }
  status: InventoryProductStatus
  costPriceCents: number
  mrpCents: number
  reorderPoint: number
  reorderQty: number
  onHandQty: number
  isPhysical: boolean
  taxIds: string[]
  supplierLinks: ProductSupplierLink[]
  createdAt: string
}

export type InventoryProductFormValues = {
  sku: string
  name: string
  description: string
  unit: InventoryUnit
  categoryId: string
  status: InventoryProductStatus
  costPrice: string
  mrp: string
  reorderPoint: number
  reorderQty: number
  onHandQty: number
  isPhysical: boolean
  taxIds: string[]
  supplierLinks: ProductSupplierFormLink[]
}

export type PurchaseOrderItemRow = {
  id: string
  product: { id: string; sku: string; name: string }
  quantity: number
  receivedQty: number
  unitCostCents: number
  taxPercent: number
  lineSubtotalCents: number
  lineTaxCents: number
  lineTotalCents: number
}

export type PurchaseOrderRow = {
  notes?: string | null
  id: string
  orderNumber: string
  supplier: { id: string; name: string }
  status: PurchaseOrderStatus
  orderDate: string
  expectedDate: string | null
  subtotalCents: number
  taxCents: number
  totalCents: number
  createdAt: string
  items: PurchaseOrderItemRow[]
}

export type PurchaseOrderFormValues = {
  supplierId: string
  orderDate: string
  expectedDate: string
  status: PurchaseOrderStatus
  notes: string
  items: {
    productId: string
    quantity: number
    unitCost: string
  }[]
}
