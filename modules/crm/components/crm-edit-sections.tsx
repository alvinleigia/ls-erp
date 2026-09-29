"use client"
import * as React from "react"

export const EditSectionContext = React.createContext<{ active: string; setActive: (title: string) => void } | null>(null)
export function EditSections({ initial, children }: { initial: string; children: React.ReactNode }) {
  const [active, setActive] = React.useState(initial)
  return <EditSectionContext.Provider value={{ active, setActive }}>{children}</EditSectionContext.Provider>
}
