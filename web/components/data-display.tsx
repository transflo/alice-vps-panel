"use client"

// 只读数据的展示：键值表（对象）和等宽文本块（字符串 / 数组 / 命令输出）。
import type { ReactNode } from "react"
import { cn } from "cn"

import { useLang } from "@/components/lang-provider"
import { Separator } from "@/components/ui/separator"

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

export function Section({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-heading text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

export function Terminal({ text, className }: { text: string; className?: string }) {
  return (
    <pre
      className={cn(
        "max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-xs/relaxed break-all whitespace-pre-wrap",
        className
      )}
    >
      {text}
    </pre>
  )
}

export function KvTable({ data }: { data: unknown }) {
  const { t } = useLang()

  if (data === null || data === undefined || data === "") {
    return <p className="text-xs text-muted-foreground">{t("common.noData")}</p>
  }
  if (typeof data === "string") return <Terminal text={data} />
  if (Array.isArray(data)) return <Terminal text={JSON.stringify(data, null, 2)} />
  if (!isRec(data)) return <p className="text-xs break-all">{String(data)}</p>

  const entries = Object.entries(data)
  if (!entries.length) return <p className="text-xs text-muted-foreground">{t("common.noData")}</p>

  return (
    <div className="flex flex-col">
      {entries.map(([key, value], index) => (
        <div key={key}>
          {index > 0 ? <Separator /> : null}
          <div className="flex flex-col gap-1 py-1.5 sm:flex-row sm:items-start sm:gap-3">
            <span className="shrink-0 font-mono text-xs text-muted-foreground sm:w-44">{key}</span>
            <div className="min-w-0 flex-1 text-xs break-all">
              {isRec(value) || Array.isArray(value) ? (
                <Terminal text={JSON.stringify(value, null, 2)} />
              ) : value === null || value === undefined || value === "" ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <span>{String(value)}</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
