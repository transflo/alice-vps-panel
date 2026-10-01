import * as React from "react"

import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

// 终端风格的输出框（命令输出、不是表格的数据）。
export function Terminal({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <pre
      className={cn(
        "max-h-96 overflow-auto rounded-xl bg-zinc-950 p-3 font-mono text-[13px] leading-relaxed break-all whitespace-pre-wrap text-zinc-200",
        className
      )}
    >
      {children}
    </pre>
  )
}

const Empty = () => <p className="text-sm text-muted-foreground">无数据</p>

export function KvTable({ data }: { data: unknown }) {
  if (data === null || data === undefined) return <Empty />
  if (typeof data !== "object" || Array.isArray(data)) {
    return <Terminal>{typeof data === "string" ? data : JSON.stringify(data, null, 2)}</Terminal>
  }
  const entries = Object.entries(data as Record<string, unknown>)
  if (!entries.length) return <Empty />
  return (
    <Table>
      <TableBody>
        {entries.map(([k, v]) => (
          <TableRow key={k} className="align-top hover:bg-transparent">
            <TableCell className="w-[32%] pl-0 align-top whitespace-normal text-muted-foreground">{k}</TableCell>
            <TableCell className="pr-0 align-top break-all whitespace-normal">
              {v !== null && typeof v === "object" ? (
                <pre className="font-mono text-xs whitespace-pre-wrap">{JSON.stringify(v, null, 2)}</pre>
              ) : v === null || v === "" ? (
                "—"
              ) : (
                String(v)
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{children}</h3>
}

export function Loading() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner />
      加载中…
    </div>
  )
}
