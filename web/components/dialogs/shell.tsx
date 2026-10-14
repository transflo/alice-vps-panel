"use client"

// 弹窗骨架：统一的关闭/退场动画回调，表单弹窗带提交中锁定与错误提示。
import * as React from "react"
import { cn } from "cn"

import { Notice } from "@/components/notice"
import { useLang } from "@/components/lang-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { errText } from "@/lib/utils"

export interface DialogBase {
  open: boolean
  onClose: () => void
  onExited: () => void
}

const SIZES = {
  xs: "sm:max-w-sm",
  sm: "sm:max-w-md",
  md: "sm:max-w-2xl",
} as const

export type DialogSize = keyof typeof SIZES

// 关闭动画结束后再卸载，避免退场动画被打断；提交中不允许关闭。
function useDialogHandlers({ open, onClose, onExited }: DialogBase, locked = false) {
  return {
    open,
    onOpenChange: (next: boolean) => {
      if (!next && !locked) onClose()
    },
    onOpenChangeComplete: (next: boolean) => {
      if (!next) onExited()
    },
  }
}

export function SimpleDialog({
  open,
  onClose,
  onExited,
  title,
  description,
  size = "sm",
  footer,
  children,
}: DialogBase & {
  title: React.ReactNode
  description?: React.ReactNode
  size?: DialogSize
  footer?: React.ReactNode
  children?: React.ReactNode
}) {
  const handlers = useDialogHandlers({ open, onClose, onExited })
  return (
    <Dialog {...handlers}>
      <DialogContent className={cn(SIZES[size], "max-h-[calc(100svh-2rem)] overflow-y-auto")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  )
}

export function FormDialog({
  open,
  onClose,
  onExited,
  title,
  description,
  size = "sm",
  submitText,
  danger = false,
  submitDisabled = false,
  onSubmit,
  children,
}: DialogBase & {
  title: React.ReactNode
  description?: React.ReactNode
  size?: DialogSize
  submitText: string
  danger?: boolean
  submitDisabled?: boolean
  onSubmit: () => Promise<void>
  children?: React.ReactNode
}) {
  const { t } = useLang()
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState("")
  const handlers = useDialogHandlers({ open, onClose, onExited }, submitting)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setSubmitting(true)
    try {
      await onSubmit()
    } catch (err) {
      setError(errText(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog {...handlers}>
      <DialogContent
        className={cn(SIZES[size], "max-h-[calc(100svh-2rem)] overflow-y-auto")}
        showCloseButton={!submitting}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {children}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant={danger ? "destructive" : "default"} disabled={submitting || submitDisabled}>
              {submitting ? <Spinner data-icon="inline-start" /> : null}
              {submitText}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
