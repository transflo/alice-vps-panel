"use client"

import * as React from "react"

import { KvTable, Section } from "@/components/data-display"
import { Notice } from "@/components/notice"
import { SimpleDialog, type DialogBase } from "@/components/dialogs/shell"
import { useLang } from "@/components/lang-provider"
import { Spinner } from "@/components/ui/spinner"
import { api, enc } from "@/lib/api"
import { stateSummary, type Instance } from "@/lib/alice"
import { errText } from "@/lib/utils"

// 实例详情：实时状态（CPU / 内存 / 流量）+ 原始数据，方便排查 Alice 返回的字段。
export function DetailsDialog({ open, onClose, onExited, inst }: DialogBase & { inst: Instance }) {
  const { t, lang } = useLang()
  const [state, setState] = React.useState<{ loading: boolean; data: unknown; error: string }>({
    loading: true,
    data: null,
    error: "",
  })

  React.useEffect(() => {
    if (!open) return
    let alive = true
    api("GET", `/api/instances/${enc(inst.id)}/state`)
      .then((r) => {
        if (alive) setState({ loading: false, data: r.data, error: "" })
      })
      .catch((e) => {
        if (alive) setState({ loading: false, data: null, error: errText(e) })
      })
    return () => {
      alive = false
    }
  }, [open, inst.id])

  const summary = stateSummary(lang, state.data)
  const name = inst.name ? String(inst.name) : inst.id

  return (
    <SimpleDialog open={open} onClose={onClose} onExited={onExited} title={t("details.title", { name })} size="md">
      <div className="flex flex-col gap-4">
        <Section title={t("details.live")}>
          {state.loading ? (
            <Spinner className="size-4" />
          ) : state.error ? (
            <Notice tone="error">{t("details.failed", { error: state.error })}</Notice>
          ) : summary ? (
            <KvTable data={summary} />
          ) : (
            <KvTable data={state.data} />
          )}
        </Section>
        <Section title={t("details.raw")}>
          <KvTable data={inst.raw} />
        </Section>
      </div>
    </SimpleDialog>
  )
}
