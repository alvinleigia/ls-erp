"use client"
import * as React from "react"
import type { RecordAccess } from "./record-actions"
export const RecordAccessContext = React.createContext<RecordAccess | undefined>(undefined)
