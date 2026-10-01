"use client"

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

// 开机以外的电源操作的确认。点确认时先关闭弹窗再执行，操作结果用 Sonner 提示。
export function ConfirmDialog({
  open,
  onClose,
  onExited,
  title,
  message,
  confirmText = "确定",
  danger = false,
  onConfirm,
}: DialogBase & {
  title: string
  message: string
  confirmText?: string
  danger?: boolean
  onConfirm: () => void
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      onOpenChangeComplete={(o) => {
        if (!o) onExited()
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
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
