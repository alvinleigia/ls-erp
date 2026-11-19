export type ImportIssue = { field: string; message: string }
export const IMPORT_MAX_ROWS = 1000
export const IMPORT_MAX_BYTES = 3 * 1024 * 1024
export const importReportColumns = ["Import row", "Import status", "Import errors"]
