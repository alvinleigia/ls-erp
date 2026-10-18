"use client"
import { useTerminology } from "@/platform/terminology/provider"

import type { CrmExtensionView, ExtensionEditorProps } from "@/modules/crm/components/extension-provider"
import type { PropertyContext } from "@/types/real-estate"
import type { PropertyContextInput } from "../sales-validation"
import { PropertyFields, emptyProperty, propertyFields, useRealEstateEnabled } from "./property-fields"
import { PropertyCaption } from "./property-caption"
import { ProjectFilter } from "./project-filter"
import { AccessSummarySection } from "@/platform/access/record-view"
import { realEstateFilterQuery } from "../crm-view-context"

type RecordContext = { propertyContext?: PropertyContext | null; realEstateEnabled?: boolean } | null
function Editor({ value, record, onChange, disabled, readOnly, errors }: ExtensionEditorProps) {
  const enabled = useRealEstateEnabled()
  const selected = record as RecordContext
  if (!(selected ? selected.realEstateEnabled : enabled)) return null
  return <PropertyFields isNew={!record} value={value as PropertyContextInput} selected={selected?.propertyContext} onChange={onChange} disabled={disabled} readOnly={readOnly} error={errors.propertyContext} />
}
export const realEstateCrmView: CrmExtensionView = {
  filterQuery: realEstateFilterQuery,
  initial: ({ primaryId, secondaryId }) => ({ ...emptyProperty, projectId: primaryId, subprojectId: secondaryId }),
  load: record => propertyFields((record as RecordContext)?.propertyContext),
  payload: value => ({ propertyContext: value }),
  Editor,
  Summary: function Summary({ record }) {
    const term = useTerminology()
    const selected = record as RecordContext, context = selected?.propertyContext
    if (!selected?.realEstateEnabled) return null
    return <AccessSummarySection title="Property interest" fields={[
      { label: term("realEstate.project.singular", "Project"), value: context?.project?.name }, { label: term("realEstate.subproject.singular", "Subproject"), value: context?.subproject?.name },
      { label: "Property category", value: context?.propertyCategoryName }, { label: "Bedrooms", value: context?.bedrooms },
      { label: "Minimum budget", value: context?.budgetMin ? `${context.budgetCurrency || ""} ${context.budgetMin}` : null },
      { label: "Maximum budget", value: context?.budgetMax ? `${context.budgetCurrency || ""} ${context.budgetMax}` : null },
      { label: "Buying timeframe", value: context?.buyingTimeframeName },
    ]} />
  },
  Caption: ({ record }) => <PropertyCaption context={(record as RecordContext)?.propertyContext} />,
  Filter: ({ primaryId, secondaryId, onChange }) => <ProjectFilter projectId={primaryId} subprojectId={secondaryId} onChange={onChange} />,
}
