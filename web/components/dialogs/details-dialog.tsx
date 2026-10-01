"use client"

import * as React from "react"

import { KvTable, Loading, SectionTitle } from "@/components/data-display"
import { SimpleDialog, type DialogBase } from "@/components/dialogs/shell"
import { Notice } from "@/components/notice"
import { stateSummary, type Instance } from "@/lib/alice"
import { api, enc } from "@/lib/api"

export function DetailsDialog({ inst, ...base }: DialogBase & { inst: Instance }) {
  const [state, setState] = React.useState<{ loading: boolean; data: unknown; error: string }>({ loading: true, data: null, error: "" })

  React.useEffect(() => {
    let alive = true
    api("GET", `/api/instances/${enc(inst.id)}/state`)
      .then((r) => alive && setState({ loading: false, data: r.data, error: "" }))
      .catch((e: unknown) => alive && setState({ loading: false, data: null, error: e instanceof Error ? e.message : String(e) }))
    return () => {
      alive = false
    }
  }, [inst.id])

  const summary = stateSummary(state.data)

  return (
    <SimpleDialog {...base} title={`实例详情 · ${inst.name || `#${inst.id}`}`} size="md">
      {summary && (
        <div>
          <SectionTitle>运行情况</SectionTitle>
          <KvTable data={summary} />
        </div>
      )}
      <div>
        <SectionTitle>实时状态</SectionTitle>
        {state.loading ? <Loading /> : state.error ? <Notice tone="error">获取失败：{state.error}</Notice> : <KvTable data={state.data} />}
      </div>
      <div>
        <SectionTitle>实例数据</SectionTitle>
        <KvTable data={inst.raw} />
      </div>
    </SimpleDialog>
  )
}
