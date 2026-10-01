"use client"

import { KvTable } from "@/components/data-display"
import { SimpleDialog, type DialogBase } from "@/components/dialogs/shell"
import { Notice } from "@/components/notice"
import { Button } from "@/components/ui/button"
import { copyText } from "@/lib/alice"
import { notify } from "@/lib/notify"

// 常用字段排在前面，方便一眼看到登录信息。
const RESULT_FIRST = ["hostname", "ipv4", "ipv6", "password", "sshkey", "id", "expiration_at"]

// 新建 / 重装接口返回的信息（比如 root 密码），关闭后面板不会再次显示。
export function ResultDialog({
  title,
  note,
  data,
  onShowBootScript,
  ...base
}: DialogBase & { title: string; note?: string; data: unknown; onShowBootScript?: () => void }) {
  let shown = data
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const src = data as Record<string, unknown>
    const ordered: Record<string, unknown> = {}
    for (const k of RESULT_FIRST) if (k in src) ordered[k] = src[k]
    shown = Object.assign(ordered, src)
  }

  const copyAll = async () => {
    const ok = await copyText(typeof data === "string" ? data : JSON.stringify(data, null, 2))
    notify(ok ? "已复制" : "复制失败，请手动复制", ok ? "success" : "error")
  }

  return (
    <SimpleDialog
      {...base}
      title={title}
      size="md"
      actions={
        <>
          {onShowBootScript && (
            <Button variant="outline" onClick={onShowBootScript}>
              查看启动脚本输出
            </Button>
          )}
          <Button variant="outline" onClick={copyAll}>
            复制全部
          </Button>
          <Button onClick={base.onClose}>完成</Button>
        </>
      }
    >
      {note && <Notice tone="info">{note}</Notice>}
      <KvTable data={shown} />
    </SimpleDialog>
  )
}
