"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { InfoHelp } from "@/components/erp/info-help"

type FormFieldProps = {
  id: string
  label: string
  error?: string
  help?: React.ReactNode
  className?: string
  children: React.ReactNode
}

export function FormField({
  id,
  label,
  error,
  help,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex min-h-5 items-center gap-2"><Label htmlFor={id}>{label}</Label>{help && <InfoHelp title={label}>{help}</InfoHelp>}</div>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
