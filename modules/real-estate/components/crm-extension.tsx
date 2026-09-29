"use client"

import type { CrmExtensionView, ExtensionEditorProps } from "@/modules/crm/components/extension-provider"
import type { PropertyContext } from "@/types/real-estate"
import type { PropertyContextInput } from "../sales-validation"
import { PropertyFields, emptyProperty, propertyFields, useRealEstateEnabled } from "./property-fields"
import { PropertyCaption } from "./property-caption"
import { ProjectFilter } from "./project-filter"

type RecordContext = { propertyContext?: PropertyContext | null; realEstateEnabled?: boolean } | null
function Editor({ value, record, onChange, disabled, readOnly, errors }: ExtensionEditorProps) {
  const enabled = useRealEstateEnabled()
  const selected = record as RecordContext
  if (!(selected ? selected.realEstateEnabled : enabled)) return null
  return <PropertyFields isNew={!record} value={value as PropertyContextInput} selected={selected?.propertyContext} onChange={onChange} disabled={disabled} readOnly={readOnly} error={errors.propertyContext} />
}
export const realEstateCrmView: CrmExtensionView = {
  initial: ({ primaryId, secondaryId }) => ({ ...emptyProperty, projectId: primaryId, subprojectId: secondaryId }),
  load: record => propertyFields((record as RecordContext)?.propertyContext),
  payload: value => ({ propertyContext: value }),
  Editor,
  Caption: ({ record }) => <PropertyCaption context={(record as RecordContext)?.propertyContext} />,
  Filter: ({ primaryId, secondaryId, onChange }) => <ProjectFilter projectId={primaryId} subprojectId={secondaryId} onChange={onChange} />,
}
