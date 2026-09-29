"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import type { Table } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { DropdownSelect } from "@/components/ui/dropdown-select"

export function CrmPagination({ page, pageSize, total, totalPages = Math.max(1, Math.ceil(total / pageSize)), loading = false, onPageChange, onPageSizeChange, label = "Pagination" }: {
  page: number; pageSize: number; total: number; totalPages?: number; loading?: boolean;
  onPageChange: (page: number) => void; onPageSizeChange?: (size: number) => void; label?: string;
}) {
  if (!loading && total === 0) return null
  const start = total ? Math.min(total, (page - 1) * pageSize + 1) : 0
  const end = Math.min(total, page * pageSize)
  return <nav aria-label={label} className="@container border-t pt-4">
    <div className="grid grid-cols-2 items-center gap-3 @3xl:grid-cols-[1fr_auto_1fr]">
      <p className="text-xs text-muted-foreground sm:text-sm">Showing <span className="font-medium text-foreground">{start}</span> to <span className="font-medium text-foreground">{end}</span> of <span className="font-medium text-foreground">{total}</span></p>
      <div className="order-3 col-span-2 flex items-center justify-center gap-2 @3xl:order-none @3xl:col-span-1">
        <Button type="button" variant="outline" size="icon" aria-label="Previous page" title="Previous page" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft aria-hidden="true" /></Button>
        <span className="min-w-24 text-center text-sm text-muted-foreground" aria-live="polite">Page {page} of {Math.max(1, totalPages)}</span>
        <Button type="button" variant="outline" size="icon" aria-label="Next page" title="Next page" disabled={loading || page >= totalPages} onClick={() => onPageChange(page + 1)}><ChevronRight aria-hidden="true" /></Button>
      </div>
      <div className="justify-self-end">{onPageSizeChange ? <DropdownSelect label="Rows per page" value={String(pageSize)} disabled={loading} options={[5, 10, 20, 30].map(size => ({ value: String(size), label: `${size} / page` }))} onValueChange={value => onPageSizeChange(Number(value))} /> : <span className="text-xs text-muted-foreground">{pageSize} / page</span>}</div>
    </div>
  </nav>
}

export function CrmTablePagination<T>({ table, totalRows, loading = false }: { table: Table<T>; totalRows: number; loading?: boolean }) {
  const { pageIndex, pageSize } = table.getState().pagination
  return <CrmPagination page={pageIndex + 1} pageSize={pageSize} total={totalRows} loading={loading} onPageChange={page => table.setPageIndex(page - 1)} onPageSizeChange={size => table.setPageSize(size)} />
}
