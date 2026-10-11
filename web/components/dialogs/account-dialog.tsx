"use client"

import * as React from "react"

import { KvTable, Section } from "@/components/data-display"
import { Notice } from "@/components/notice"
import { SimpleDialog, type DialogBase } from "@/components/dialogs/shell"
import { useLang } from "@/components/lang-provider"
import { Spinner } from "@/components/ui/spinner"
import { fmtCredit, maxHours } from "@/lib/alice"
import { getOverview, type Overview } from "@/lib/data"
import { errText } from "@/lib/utils"

// 余额 credit 的单位是百万分之一美元，两个都显示出来方便对账。
function decorateProfile(data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data
  const src = { ...(data as Record<string, unknown>) }
  if (src.credit !== undefined) src.credit = `${fmtCredit(src.credit)}（${String(src.credit)}）`
  return src
}

function Part({
  data,
  transform,
}: {
  data?: { ok: boolean; data?: unknown; error?: string }
  transform?: (data: unknown) => unknown
}) {
  const { t } = useLang()
  if (!data) return <p className="text-xs text-muted-foreground">{t("common.noData")}</p>
  if (!data.ok) return <Notice tone="error">{t("account.failed", { error: data.error ?? t("common.noData") })}</Notice>
  return <KvTable data={transform ? transform(data.data) : data.data} />
}

export function AccountDialog({ open, onClose, onExited }: DialogBase) {
  const { t } = useLang()
  const [state, setState] = React.useState<{ loading: boolean; data: Overview | null; error: string }>({
    loading: true,
    data: null,
    error: "",
  })

  React.useEffect(() => {
    if (!open) return
    let alive = true
    // 每次打开都重新取一次，余额会变。
    getOverview({ force: true })
      .then((data) => {
        if (alive) setState({ loading: false, data, error: "" })
      })
      .catch((e) => {
        if (alive) setState({ loading: false, data: null, error: errText(e) })
      })
    return () => {
      alive = false
    }
  }, [open])

  const permMax = maxHours(state.data?.permissions?.data)

  return (
    <SimpleDialog open={open} onClose={onClose} onExited={onExited} title={t("account.title")}>
      {state.loading ? (
        <div className="flex justify-center py-6">
          <Spinner className="size-5" />
        </div>
      ) : state.error ? (
        <Notice tone="error">{t("account.failed", { error: state.error })}</Notice>
      ) : (
        <div className="flex flex-col gap-4">
          <Section title={t("account.section")}>
            <Part data={state.data?.profile} transform={decorateProfile} />
          </Section>
          <Section title={t("account.perm")}>
            {permMax !== null ? (
              <p className="text-xs text-muted-foreground">{t("account.maxTime", { hours: permMax })}</p>
            ) : null}
            <Part data={state.data?.permissions} />
          </Section>
        </div>
      )}
    </SimpleDialog>
  )
}
