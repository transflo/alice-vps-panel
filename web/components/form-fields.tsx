"use client"

import * as React from "react"

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { durationLabel, durationOptions } from "@/lib/alice"

export interface Option {
  id: string
  label?: string
  name?: string
  disabled?: boolean
  group?: string | null
}

// "不使用"之类的空选项在 Select 里用这个占位值表示，对外仍然是空字符串。
const NONE = "__none__"

const labelOf = (o: Option) => o.label ?? o.name ?? o.id

function Required() {
  return (
    <span aria-hidden className="text-destructive">
      *
    </span>
  )
}

// options 可以带 group（分组标题）；emptyLabel 不为空时多一个值为 "" 的选项。
// 必填校验由各弹窗的提交函数负责（Base UI 的 Select 不依赖浏览器原生的 required 校验）。
export function SelectField({
  label,
  value,
  onChange,
  options,
  loading = false,
  emptyLabel,
  required = false,
  description,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Option[]
  loading?: boolean
  emptyLabel?: string
  required?: boolean
  description?: React.ReactNode
  disabled?: boolean
}) {
  const id = React.useId()
  const known = value !== "" && options.some((o) => o.id === value)
  const current = known ? value : emptyLabel ? NONE : null
  const items = [
    ...(emptyLabel ? [{ value: NONE, label: emptyLabel }] : []),
    ...options.map((o) => ({ value: o.id, label: labelOf(o) })),
  ]

  // 相邻的、分组相同的选项放进同一个 SelectGroup。
  const groups: { group: string | null; items: Option[] }[] = []
  for (const o of options) {
    const g = o.group ?? null
    const last = groups[groups.length - 1]
    if (last && last.group === g) last.items.push(o)
    else groups.push({ group: g, items: [o] })
  }

  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {label}
        {required && <Required />}
      </FieldLabel>
      <Select
        value={current}
        items={items}
        disabled={disabled || loading}
        onValueChange={(v) => onChange(v === null || v === NONE ? "" : String(v))}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={loading ? "加载中…" : "请选择"} />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          {emptyLabel && <SelectItem value={NONE}>{emptyLabel}</SelectItem>}
          {!options.length && !emptyLabel && <div className="px-3 py-2 text-sm text-muted-foreground">没有可选项</div>}
          {groups.map(({ group, items: list }) => (
            <SelectGroup key={group ?? "__ungrouped"}>
              {group && <SelectLabel>{group}</SelectLabel>}
              {list.map((o) => (
                <SelectItem key={o.id} value={o.id} disabled={o.disabled}>
                  {labelOf(o)}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  )
}

export function DurationField({
  label = "使用时长",
  value,
  onChange,
  max,
}: {
  label?: string
  value: string
  onChange: (value: string) => void
  max: number | null
}) {
  const options = durationOptions(max).map((n) => ({ id: String(n), label: durationLabel(n) }))
  return (
    <SelectField
      label={label}
      value={value}
      onChange={onChange}
      options={options}
      required
      description={max ? `你的账户单次最长 ${max} 小时` : undefined}
    />
  )
}

export function BootScriptField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = React.useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>启动脚本（可选）</FieldLabel>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder={"#!/bin/bash\napt-get update -y"}
        spellCheck={false}
        className="min-h-24 font-mono text-[13px] leading-relaxed"
      />
      <FieldDescription>实例启动后执行，面板会自动做 Base64 编码。</FieldDescription>
    </Field>
  )
}
