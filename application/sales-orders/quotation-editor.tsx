"use client"
import { QuotationEditor as Editor } from "@/modules/sales-documents/components/quotations"
import { CreateSalesOrder } from "@/modules/sales-orders/components/create"
export function QuotationEditor(props: React.ComponentProps<typeof Editor>) {
  return <Editor {...props} documentActions={(document, disabled) => <CreateSalesOrder quotationId={document.id} revision={document.revision} disabled={disabled} />} />
}
