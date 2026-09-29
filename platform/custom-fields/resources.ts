import type { FieldScope } from "./validation"

// Resource descriptors are registered by modules, never supplied by requests.
export type FieldResource = { key: string; label: string; module: string; table: string; scopes: readonly FieldScope[] }
