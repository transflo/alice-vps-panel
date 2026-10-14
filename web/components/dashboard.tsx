"use client"

// 面板主界面：顶栏（账户、语言、主题、刷新、设置、退出）+ 实例卡片列表 + 弹窗栈。
import * as React from "react"
import { useTheme } from "next-themes"
import { CheckIcon, LanguagesIcon, LogOutIcon, MoonIcon, PlusIcon, RefreshCwIcon, ServerIcon, SettingsIcon, SunIcon, UserIcon } from "lucide-react"

import { AccountDialog } from "@/components/dialogs/account-dialog"
import { AutoRenewDialog } from "@/components/dialogs/auto-renew-dialog"
import { CommandOutputDialog } from "@/components/dialogs/command-output-dialog"
import { ConfirmDialog } from "@/components/dialogs/confirm-dialog"
import { DeployDialog } from "@/components/dialogs/deploy-dialog"
import { DestroyDialog } from "@/components/dialogs/destroy-dialog"
import { DetailsDialog } from "@/components/dialogs/details-dialog"
import { ExecDialog } from "@/components/dialogs/exec-dialog"
import { RebuildDialog } from "@/components/dialogs/rebuild-dialog"
import { ResultDialog } from "@/components/dialogs/result-dialog"
import { SettingsDialog } from "@/components/dialogs/settings-dialog"
import { InstanceCard, type InstanceAction } from "@/components/instance-card"
import { useLang } from "@/components/lang-provider"
import { Logo } from "@/components/logo"
import { Notice } from "@/components/notice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { effectiveAutoRenew, useDashboardData } from "@/hooks/use-dashboard-data"
import { api, enc } from "@/lib/api"
import { fmtCredit, fmtDate, pick, type Instance } from "@/lib/alice"
import type { DictKey } from "@/lib/i18n"
import { LOCALES } from "@/lib/i18n/lang"
import { notify } from "@/lib/notify"
import { errText } from "@/lib/utils"

type PowerAction = "boot" | "shutdown" | "restart" | "poweroff"

const POWER_TEXT: Record<PowerAction, DictKey> = {
  boot: "power.boot",
  shutdown: "power.shutdown",
  restart: "power.restart",
  poweroff: "power.poweroff",
}

type DialogSpec =
  | { type: "confirm"; title: string; message: string; confirmText: string; danger?: boolean; onConfirm: () => void }
  | { type: "account" }
  | { type: "settings" }
  | { type: "deploy" }
  | { type: "rebuild" | "autorenew" | "destroy" | "exec" | "details"; inst: Instance }
  | { type: "result"; title: string; data: unknown; note: string; bootScript: { instId: string; uid: string } | null }
  | { type: "output"; instId: string; uid: string; title: string }

interface DialogEntry {
  key: number
  open: boolean
  spec: DialogSpec
}

// 只有真返回了内容才弹结果框（{ok:true} 或空字符串都不算）。
function hasResult(data: unknown): boolean {
  return data !== null && data !== undefined && data !== true && data !== ""
}

// 主题只有挂载后才能知道（next-themes 读的是 localStorage），用 useSyncExternalStore
// 拿到「已挂载」这个稳定快照，避免首屏水合不一致。
const subscribeNoop = () => () => {}
const getMounted = () => true
const getMountedOnServer = () => false

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = React.useSyncExternalStore(subscribeNoop, getMounted, getMountedOnServer)

  const dark = mounted && resolvedTheme === "dark"
  return (
    <Button variant="ghost" size="icon-sm" aria-label="theme" onClick={() => setTheme(dark ? "light" : "dark")}>
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  )
}

export function Dashboard({ configured, onLogout }: { configured: boolean; onLogout: () => void }) {
  const { t, lang, setLang } = useLang()
  const data = useDashboardData()
  const [dialogs, setDialogs] = React.useState<DialogEntry[]>([])
  const seq = React.useRef(0)

  const openDialog = React.useCallback((spec: DialogSpec) => {
    seq.current += 1
    setDialogs((list) => [...list, { key: seq.current, open: true, spec }])
  }, [])
  const closeDialog = React.useCallback((key: number) => {
    setDialogs((list) => list.map((d) => (d.key === key ? { ...d, open: false } : d)))
  }, [])
  const removeDialog = React.useCallback((key: number) => {
    setDialogs((list) => list.filter((d) => d.key !== key))
  }, [])

  const { load, loadAccount, refreshSoon, withBusy, setInstances } = data

  const power = React.useCallback(
    async (inst: Instance, action: PowerAction) => {
      const label = t(POWER_TEXT[action])
      try {
        await withBusy(inst, () => api("POST", `/api/instances/${enc(inst.id)}/power`, { action }))
        notify(t("power.sent", { action: label }), "success")
        refreshSoon()
      } catch (e) {
        notify(t("power.failed", { action: label, error: errText(e) }), "error")
      }
    },
    [refreshSoon, t, withBusy]
  )

  // 部署 / 重装返回的信息（root 密码等）弹一个结果框，带启动脚本时再给个查看输出的入口。
  const showResult = React.useCallback(
    (title: string, result: unknown, note: string, instId: unknown, hadScript: boolean) => {
      const uid = pick(result, "boot_script_uid")
      openDialog({
        type: "result",
        title,
        data: result,
        note,
        bootScript: hadScript && instId !== undefined && uid !== undefined ? { instId: String(instId), uid: String(uid) } : null,
      })
    },
    [openDialog]
  )

  const onAction = React.useCallback(
    (action: InstanceAction, inst: Instance) => {
      if (action === "boot") {
        void power(inst, "boot")
        return
      }
      if (action === "shutdown" || action === "restart" || action === "poweroff") {
        const label = inst.name ? String(inst.name) : t("card.instanceId", { id: inst.id })
        openDialog({
          type: "confirm",
          title: t("power.confirmTitle", { action: t(POWER_TEXT[action]) }),
          message:
            action === "poweroff"
              ? t("power.confirmPoweroff", { label })
              : t("power.confirmMessage", { action: t(POWER_TEXT[action]), label }),
          confirmText: t(POWER_TEXT[action]),
          danger: action === "poweroff",
          onConfirm: () => void power(inst, action),
        })
        return
      }
      openDialog({ type: action, inst } as DialogSpec)
    },
    [openDialog, power, t]
  )

  const balanceText = data.account.balance !== undefined ? t("header.balance", { x: fmtCredit(data.account.balance) }) : ""

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Logo className="size-5 shrink-0" />
            <span className="truncate font-heading text-sm font-medium">{t("app.name")}</span>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => openDialog({ type: "account" })}>
              <UserIcon data-icon="inline-start" />
              <span className="hidden max-w-40 truncate sm:inline">
                {data.account.name || t("common.account")}
              </span>
              {balanceText ? <span className="hidden text-muted-foreground md:inline">· {balanceText}</span> : null}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="language" />}>
                <LanguagesIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  {LOCALES.map((locale) => (
                    <DropdownMenuItem key={locale.id} onClick={() => setLang(locale.id)}>
                      <span className="flex-1">{locale.label}</span>
                      {lang === locale.id ? <CheckIcon /> : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <ThemeToggle />

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={data.loading}
                    aria-label={t("common.refresh")}
                    onClick={() => void load()}
                  />
                }
              >
                {data.loading ? <Spinner /> : <RefreshCwIcon />}
              </TooltipTrigger>
              <TooltipContent>{t("common.refresh")}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("common.settings")}
                    onClick={() => openDialog({ type: "settings" })}
                  />
                }
              >
                <SettingsIcon />
              </TooltipTrigger>
              <TooltipContent>{t("common.settings")}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label={t("common.logout")} onClick={() => void onLogout()} />
                }
              >
                <LogOutIcon />
              </TooltipTrigger>
              <TooltipContent>{t("common.logout")}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-4 sm:px-6">
        {!configured ? <Notice tone="warning">{t("header.unconfigured")}</Notice> : null}

        {data.error ? (
          <Notice
            tone="error"
            action={
              <Button variant="outline" size="xs" onClick={() => void load()}>
                {t("common.retry")}
              </Button>
            }
          >
            {t("header.loadFailed", { error: data.error })}
          </Notice>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-sm font-medium">{t("header.instances")}</h1>
          {data.loaded && !data.error ? (
            <Badge variant="secondary">{t("header.count", { n: data.instances.length })}</Badge>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {data.updatedAt ? t("header.updatedAt", { time: fmtDate(data.updatedAt, true) }) : ""}
          </span>
          <Button className="ml-auto" size="sm" onClick={() => openDialog({ type: "deploy" })}>
            <PlusIcon data-icon="inline-start" />
            {t("header.newInstance")}
          </Button>
        </div>

        {!data.loaded ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-64 rounded-xl" />
            ))}
          </div>
        ) : data.instances.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.instances.map((inst) => (
              <InstanceCard
                key={inst.id || JSON.stringify(inst.raw).slice(0, 32)}
                inst={inst}
                power={data.powerStates[inst.id]}
                autoRenew={effectiveAutoRenew(data.autoRenew, inst.id)}
                busy={Boolean(data.busy[inst.id])}
                onAction={onAction}
              />
            ))}
          </div>
        ) : !data.error ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ServerIcon />
              </EmptyMedia>
              <EmptyTitle>{t("header.emptyTitle")}</EmptyTitle>
              <EmptyDescription>{t("header.emptyDesc")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" onClick={() => openDialog({ type: "deploy" })}>
                <PlusIcon data-icon="inline-start" />
                {t("header.createFirst")}
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}
      </main>

      {dialogs.map((entry) => {
        const base = {
          key: entry.key,
          open: entry.open,
          onClose: () => closeDialog(entry.key),
          onExited: () => removeDialog(entry.key),
        }
        const spec = entry.spec

        switch (spec.type) {
          case "confirm":
            return <ConfirmDialog {...base} title={spec.title} message={spec.message} confirmText={spec.confirmText} danger={spec.danger} onConfirm={spec.onConfirm} />
          case "account":
            return <AccountDialog {...base} />
          case "settings":
            return <SettingsDialog {...base} />
          case "deploy":
            return (
              <DeployDialog
                {...base}
                onDeployed={(result, hadScript) => {
                  closeDialog(entry.key)
                  void load()
                  refreshSoon()
                  void loadAccount(true)
                  if (hasResult(result)) {
                    showResult(t("result.created"), result, t("result.noteDeploy"), pick(result, "id", "instance_id", "server_id"), hadScript)
                  }
                }}
              />
            )
          case "rebuild":
            return (
              <RebuildDialog
                {...base}
                inst={spec.inst}
                withBusy={withBusy}
                onRebuilt={(result, hadScript) => {
                  closeDialog(entry.key)
                  refreshSoon()
                  if (hasResult(result)) {
                    showResult(t("result.rebuilt"), result, t("result.noteRebuild"), spec.inst.id, hadScript)
                  }
                }}
              />
            )
          case "autorenew":
            return (
              <AutoRenewDialog
                {...base}
                inst={spec.inst}
                state={data.autoRenew}
                withBusy={withBusy}
                onChanged={() => {
                  closeDialog(entry.key)
                  void load()
                }}
              />
            )
          case "destroy":
            return (
              <DestroyDialog
                {...base}
                inst={spec.inst}
                withBusy={withBusy}
                onDestroyed={() => {
                  closeDialog(entry.key)
                  setInstances((list) => list.filter((i) => i.id !== spec.inst.id))
                  refreshSoon()
                  void loadAccount(true)
                }}
              />
            )
          case "exec":
            return <ExecDialog {...base} inst={spec.inst} withBusy={withBusy} />
          case "details":
            return <DetailsDialog {...base} inst={spec.inst} />
          case "result":
            // 先取出 bootScript 再进闭包：属性访问的收窄在回调里会失效。
            return (
              <ResultDialog
                {...base}
                title={spec.title}
                data={spec.data}
                note={spec.note}
                onShowBootScript={
                  spec.bootScript
                    ? () => {
                        const boot = spec.bootScript
                        if (boot) openDialog({ type: "output", ...boot, title: t("result.bootTitle") })
                      }
                    : undefined
                }
              />
            )
          case "output":
            return <CommandOutputDialog {...base} instId={spec.instId} uid={spec.uid} title={spec.title} />
        }
      })}
    </div>
  )
}
