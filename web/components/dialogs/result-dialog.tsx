"use client"

import { CopyIcon, ScrollTextIcon } from "lucide-react"

import { KvTable } from "@/components/data-display"
import { Notice } from "@/components/notice"
import { SimpleDialog, type DialogBase } from "@/components/dialogs/shell"
import { useLang } from "@/components/lang-provider"
import { Button } from "@/components/ui/button"
import { copyText } from "@/lib/alice"
import { notify } from "@/lib/notify"

// 新建 / 重装返回的信息里，这几项最要紧，排在最前面。
const RESULT_FIRST = ["hostname", "ipv4", "ipv6", "password", "sshkey", "id", "expiration_at"]

function orderResult(data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data
  const src = data as Record<string, unknown>
  const ordered: Record<string, unknown> = {}
  for (const key of RESULT_FIRST) if (key in src) ordered[key] = src[key]
  return Object.assign(ordered, src)
}

export function ResultDialog({
  open,
  onClose,
  onExited,
  title,
  data,
  note,
  onShowBootScript,
}: DialogBase & {
  title: string
  data: unknown
  note: string
  onShowBootScript?: () => void
}) {
  const { t } = useLang()

  async function copyAll() {
    const text = typeof data === "string" ? data : JSON.stringify(data, null, 2)
    const ok = await copyText(text)
    notify(ok ? t("common.copied") : t("common.copyFailed"), ok ? "success" : "error")
  }

  return (
    <SimpleDialog
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={title}
      footer={
        <>
          {onShowBootScript ? (
            <Button variant="outline" onClick={onShowBootScript}>
              <ScrollTextIcon data-icon="inline-start" />
              {t("result.showBoot")}
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => void copyAll()}>
            <CopyIcon data-icon="inline-start" />
            {t("common.copyAll")}
          </Button>
          <Button onClick={onClose}>{t("common.done")}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {note ? <Notice tone="info">{note}</Notice> : null}
        <KvTable data={orderResult(data)} />
      </div>
    </SimpleDialog>
  )
}
