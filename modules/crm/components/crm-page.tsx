"use client"
import type { ComponentProps, ReactNode } from "react"
import { ArrowLeft } from "lucide-react"
import Link from "@/platform/access/link"
import { useCurrentResourceAction } from "@/platform/access/view-guard"
import { useCrmRecordView } from "./crm-record-view"
import { Button } from "@/components/ui/button"
import { PageHeader, FormActions } from "@/components/erp/page"
export { pageClass as crmPageClass, Surface as CrmSurface, ActionBar as CrmActionBar, Filters as CrmFilters, TableToolbar as CrmTableToolbar } from "@/components/erp/page"

export function CrmPageHeader(props: ComponentProps<typeof PageHeader>) {
  return <PageHeader {...props} backLink={props.backHref && <Link href={props.backHref} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" />{props.backLabel || "Back"}</Link>} />
}

export function CrmFormActions({ form, cancelHref, saving, disabled, canSave = true, saveLabel, loadingText = "Saving…", children }: {
  form: string; cancelHref: string; saving?: boolean; disabled?: boolean; canSave?: boolean; saveLabel: string; loadingText?: string; children?: ReactNode;
}) {
  const view = useCrmRecordView()
  const canEdit = useCurrentResourceAction("edit"), canCreate = useCurrentResourceAction("create")
  canSave = canSave && (view?.existing ? canEdit : canCreate)
  if (view?.existing) return <>{children}{canSave && <Button type="button" disabled={disabled || saving} onClick={() => view.begin()}>Edit details</Button>}</>
  return <FormActions form={form} cancelHref={cancelHref} saving={saving} disabled={disabled} canSave={canSave} saveLabel={saveLabel} loadingText={loadingText}>{children}</FormActions>
}
