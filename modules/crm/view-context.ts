// Code-owned references passed by application composition, never permission scope.
export type CrmViewReferences = { primaryId: string; secondaryId: string }
export type CrmCreateQuery = Record<string, string | string[] | undefined>
