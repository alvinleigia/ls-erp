import { emptyVerificationPolicy, type VerificationPolicy } from "./contracts"

// An opt-in draft, not a statutory checklist or a default for existing tenants.
export function simpleIndividualVerificationPolicy(): VerificationPolicy {
  return {
    ...emptyVerificationPolicy(),
    documents: [
      { code: "tax_identification", label: "Tax identification proof", subjects: ["PERSON"], roles: ["CUSTOMER", "ADDITIONAL_CUSTOMER"] },
      { code: "identity_address", label: "Identity/address evidence", subjects: ["PERSON"], roles: ["CUSTOMER", "ADDITIONAL_CUSTOMER"] },
    ],
  }
}
