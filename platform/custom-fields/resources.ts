import type { Resource } from "../access/catalog"
import type { FieldScope } from "./validation"

// Resource descriptors are registered by modules, never supplied by requests.
export type FieldResource = { key: string; permissionResource: Resource; label: string; module: string; table: string; scopes: readonly FieldScope[] }
