"use client"

// 表单里复用的下拉与启动脚本输入。
import * as React from "react"

import { useLang } from "@/components/lang-provider"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

export interface SelectOption {
  id: string
  label: string
  disabled?: boolean
}

export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  loading = false,
  description,
  emptyText,
}: {
  id?: string
  label: string
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  description?: React.ReactNode
  emptyText?: string
}) {
  const { t } = useLang()
  // Base UI 的 Select 用 items 描述可选项，占位符就是 value 为 null 的那一项。
  const items = React.useMemo(
    () => [
      { label: loading ? t("fields.loading") : (placeholder ?? t("fields.select")), value: null as string | null, disabled: false },
      ...options.map((o) => ({ label: o.label, value: o.id as string | null, disabled: o.disabled })),
    ],
    [loading, options, placeholder, t]
  )

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={items}
        value={value || null}
        onValueChange={(next) => onChange(next ?? "")}
        disabled={disabled || loading}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value ?? "__none__"} value={item.value} disabled={item.disabled}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {!loading && !options.length && emptyText ? <FieldDescription>{emptyText}</FieldDescription> : null}
    </Field>
  )
}

export function BootScriptField({
  id = "boot-script",
  value,
  onChange,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useLang()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("deploy.script")}</FieldLabel>
      <Textarea
        id={id}
        rows={4}
        spellCheck={false}
        className="font-mono"
        placeholder={"#!/bin/bash\napt-get update -y"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <FieldDescription>{t("deploy.scriptHint")}</FieldDescription>
    </Field>
  )
}
