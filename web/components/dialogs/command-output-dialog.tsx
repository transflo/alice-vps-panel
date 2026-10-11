"use client"

import * as React from "react"
import { RefreshCwIcon } from "lucide-react"

import { CommandResult } from "@/components/dialogs/command-result"
import { SimpleDialog, type DialogBase } from "@/components/dialogs/shell"
import { useLang } from "@/components/lang-provider"
import { Button } from "@/components/ui/button"
import { useCommandWatcher } from "@/hooks/use-command-watcher"

// 查看某次命令（或启动脚本）的输出，可以手动重新查询。
export function CommandOutputDialog({
  open,
  onClose,
  onExited,
  instId,
  uid,
  title,
}: DialogBase & {
  instId: string
  uid: string
  title: string
}) {
  const { t } = useLang()
  const { state, watch } = useCommandWatcher({
    phase: "running",
    status: t("exec.submitted"),
    output: "",
    error: "",
  })

  React.useEffect(() => {
    if (open) watch(instId, uid, { resetState: false })
  }, [open, instId, uid, watch])

  return (
    <SimpleDialog
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={title}
      size="md"
      footer={
        <Button variant="outline" disabled={state.phase === "running"} onClick={() => watch(instId, uid)}>
          <RefreshCwIcon data-icon="inline-start" />
          {t("exec.requery")}
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="font-mono text-xs text-muted-foreground">{t("exec.idUid", { id: instId, uid })}</p>
        <CommandResult state={state} />
      </div>
    </SimpleDialog>
  )
}
