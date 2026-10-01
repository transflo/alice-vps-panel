"use client"

import * as React from "react"

import { Notice } from "@/components/notice"
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
import { cn } from "@/lib/utils"

// 每个弹窗的公共属性。Dashboard 的弹窗栈传入：关闭时先 onClose（open 变 false），退场动画结束后 onExited 再把它从栈里移除。
export interface DialogBase {
  open: boolean
  onClose: () => void
  onExited: () => void
}

const SIZE = { xs: "sm:max-w-sm", sm: "sm:max-w-md", md: "sm:max-w-2xl" } as const
type Size = keyof typeof SIZE

function useDialogHandlers({ onClose, onExited }: Pick<DialogBase, "onClose" | "onExited">, locked = false) {
  return {
    onOpenChange: (open: boolean) => {
      if (!open && !locked) onClose()
    },
    onOpenChangeComplete: (open: boolean) => {
      if (!open) onExited()
    },
  }
}

// 普通弹窗：标题 + 内容区（过长时滚动）+ 可选的底部按钮。
export function SimpleDialog({
  open,
  onClose,
  onExited,
  title,
  description,
  size = "sm",
  actions,
  children,
}: DialogBase & {
  title: React.ReactNode
  description?: React.ReactNode
  size?: Size
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <Dialog open={open} {...useDialogHandlers({ onClose, onExited })}>
      <DialogContent className={cn("max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)]", actions && "grid-rows-[auto_minmax(0,1fr)_auto]", SIZE[size])}>
        <DialogHeader className="pr-8">
          <DialogTitle className="truncate">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="-mx-1 flex min-h-0 flex-col gap-4 overflow-y-auto px-1">{children}</div>
        {actions && <DialogFooter>{actions}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}

// 表单弹窗：onSubmit 抛错时把错误显示在弹窗里，成功后由调用方关闭；提交期间不能关闭。
export function FormDialog({
  open,
  onClose,
  onExited,
  title,
  submitText,
  danger = false,
  onSubmit,
  size = "sm",
  notice,
  children,
}: DialogBase & {
  title: React.ReactNode
  submitText: string
  danger?: boolean
  onSubmit: () => Promise<void>
  size?: Size
  notice?: React.ReactNode
  children: React.ReactNode
}) {
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSubmitting(true)
    try {
      await onSubmit()
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} {...useDialogHandlers({ onClose, onExited }, submitting)}>
      <DialogContent showCloseButton={!submitting} className={SIZE[size]}>
        <form onSubmit={handleSubmit} className="flex max-h-[calc(100dvh-5rem)] min-h-0 flex-col gap-6">
          <DialogHeader className="pr-8">
            <DialogTitle className="truncate">{title}</DialogTitle>
          </DialogHeader>
          <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 py-1">
            {notice}
            {children}
            {error && <Notice tone="error">{error}</Notice>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" variant={danger ? "destructive" : "default"} disabled={submitting}>
              {submitting && <Spinner data-icon="inline-start" />}
              {submitText}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
