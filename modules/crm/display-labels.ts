import { enumLabel } from "@/lib/enum-label"

// CLOSED is the persisted enquiry state for a lost enquiry.
export const enquiryStatusLabel = (value: string) => value === "CLOSED" ? "Lost" : enumLabel(value)
