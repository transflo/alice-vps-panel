"use client"

import { useLang } from "@/components/lang-provider"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { DialogBase } from "@/components/dialogs/shell"

// 电源操作的二次确认。确认后先关闭弹窗再执行，结果用 toast 反馈。
export function ConfirmDialog({
  open,
  onClose,
  onExited,
  title,
  message,
  confirmText,
  danger = false,
  onConfirm,
}: DialogBase & {
  title: string
  message: string
  confirmText: string
  danger?: boolean
  onConfirm: () => void
}) {
  const { t } = useLang()
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      onOpenChangeComplete={(next) => {
        if (!next) onExited()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant={danger ? "destructive" : "default"}
            onClick={() => {
              onClose()
              onConfirm()
            }}
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
