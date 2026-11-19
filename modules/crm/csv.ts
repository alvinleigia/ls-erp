import { CrmError } from "./policy"

export const CRM_EXPORT_LIMIT = 2000
export function checkExportLimit(total: number) {
  if (total > CRM_EXPORT_LIMIT) throw new CrmError(400, `This export exceeds ${CRM_EXPORT_LIMIT.toLocaleString("en-US")} rows. Narrow the filters and try again.`)
}

export { spreadsheetCsv as crmCsv } from "@/platform/imports/csv"
