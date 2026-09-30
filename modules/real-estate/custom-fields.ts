import type { FieldResource } from "@/platform/custom-fields/resources"
export const projectFields: FieldResource = { key: "project", permissionResource: "projects", label: "Projects", module: "realEstate", table: "RealEstateProjectFieldValue", scopes: ["PROJECT"] }
