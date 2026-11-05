"use client"

import type { ComponentProps } from "react"
import { RecordTabs } from "./record-detail"
import { useListState } from "./list-navigation"

// Reuse the record tab interaction and URL state for grouped settings, reports
// and read-only sheets. Editable groups retain their mounted controls/drafts.
export function SectionTabs({ scope, ...props }: Omit<ComponentProps<typeof RecordTabs>, "value" | "onChange"> & { scope: string }) {
  const [value, setValue] = useListState(scope, "tab", props.tabs[0]?.value || "overview")
  return <RecordTabs {...props} value={value} onChange={setValue} />
}
