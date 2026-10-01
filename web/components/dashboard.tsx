"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Add01Icon, Logout01Icon, RefreshIcon, ServerStack01Icon, UserCircleIcon } from "@hugeicons/core-free-icons"

import { AccountDialog } from "@/components/dialogs/account-dialog"
import { AutoRenewDialog } from "@/components/dialogs/auto-renew-dialog"
import { CommandOutputDialog, ExecDialog } from "@/components/dialogs/command-dialogs"
import { ConfirmDialog } from "@/components/dialogs/confirm-dialog"
import { DeployDialog } from "@/components/dialogs/deploy-dialog"
import { DestroyDialog } from "@/components/dialogs/destroy-dialog"
import { DetailsDialog } from "@/components/dialogs/details-dialog"
import { RebuildDialog } from "@/components/dialogs/rebuild-dialog"
import { RenewDialog } from "@/components/dialogs/renew-dialog"
import { ResultDialog } from "@/components/dialogs/result-dialog"
import { InstanceCard, type InstanceAction } from "@/components/instance-card"
import { Logo } from "@/components/logo"
import { Notice } from "@/components/notice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { fmtCredit, fmtDate, pick, type Instance } from "@/lib/alice"
import { api, enc } from "@/lib/api"
import { notify } from "@/lib/notify"
import { useDashboardData } from "@/hooks/use-dashboard-data"

const POWER_TEXT: Record<string, string> = { boot: "开机", shutdown: "关机", restart: "重启", poweroff: "强制关机" }

// 部署 / 重装接口有返回内容时（比如 root 密码）才弹出结果窗口。
const hasResult = (data: unknown) => data !== null && data !== undefined && data !== true && data !== ""

// 弹窗栈：每个弹窗是一条记录。关闭时先把 open 设为 false，等退场动画结束（onExited）再移除。
type DialogSpec =
  | { type: "confirm"; title: string; message: string; confirmText: string; danger: boolean; onConfirm: () => void }
  | { type: "account" }
  | { type: "deploy" }
  | { type: "rebuild" | "renew" | "autorenew" | "destroy" | "exec" | "details"; inst: Instance }
  | { type: "result"; title: string; data: unknown; note: string; bootScript: { instId: string; uid: string } | null }
  | { type: "output"; instId: string; uid: string; title: string }

interface DialogEntry {
  key: number
  open: boolean
  spec: DialogSpec
}

export function Dashboard({ configured, onLogout }: { configured: boolean; onLogout: () => void }) {
  const data = useDashboardData()
  const { instances, setInstances, loaded, loading, error, updatedAt, busy, powerStates, autoRenew, account, load, loadAccount, refreshSoon, withBusy } = data
  const [dialogs, setDialogs] = React.useState<DialogEntry[]>([])
  const dialogSeq = React.useRef(0)

  // ---------- 弹窗栈 ----------

  const openDialog = React.useCallback((spec: DialogSpec) => {
    dialogSeq.current += 1
    const key = dialogSeq.current
    setDialogs((list) => [...list, { key, open: true, spec }])
  }, [])

  const closeDialog = (key: number) => setDialogs((list) => list.map((d) => (d.key === key ? { ...d, open: false } : d)))
  const removeDialog = (key: number) => setDialogs((list) => list.filter((d) => d.key !== key))

  const showResult = (title: string, result: unknown, note: string, instId: unknown, hadScript: boolean) => {
    const uid = pick(result, "boot_script_uid")
    openDialog({
      type: "result",
      title,
      data: result,
      note,
      bootScript: hadScript && instId !== undefined && uid !== undefined ? { instId: String(instId), uid: String(uid) } : null,
    })
  }

  // ---------- 操作 ----------

  const power = async (inst: Instance, action: string) => {
    try {
      await withBusy(inst, () => api("POST", `/api/instances/${enc(inst.id)}/power`, { action }))
      notify(`已发送${POWER_TEXT[action]}指令`, "success")
      refreshSoon()
    } catch (e) {
      notify(`${POWER_TEXT[action]}失败：${e instanceof Error ? e.message : String(e)}`, "error")
    }
  }

  const onAction = (action: InstanceAction, inst: Instance) => {
    const label = inst.name || inst.id
    switch (action) {
      case "boot":
        void power(inst, action)
        break
      case "shutdown":
      case "restart":
      case "poweroff":
        openDialog({
          type: "confirm",
          title: `${POWER_TEXT[action]}实例`,
          message:
            action === "poweroff"
              ? `确定强制关闭「${label}」吗？相当于直接断电，未保存的数据可能丢失。`
              : `确定${POWER_TEXT[action]}「${label}」吗？`,
          confirmText: POWER_TEXT[action],
          danger: action === "poweroff",
          onConfirm: () => void power(inst, action),
        })
        break
      default:
        openDialog({ type: action, inst })
    }
  }

  const logout = async () => {
    try {
      await api("POST", "/api/logout")
    } catch {
      /* 忽略 */
    }
    onLogout()
  }

  const renderDialog = (d: DialogEntry) => {
    const common = { open: d.open, onClose: () => closeDialog(d.key), onExited: () => removeDialog(d.key) }
    const { spec } = d
    switch (spec.type) {
      case "confirm":
        return <ConfirmDialog key={d.key} {...common} title={spec.title} message={spec.message} confirmText={spec.confirmText} danger={spec.danger} onConfirm={spec.onConfirm} />
      case "account":
        return <AccountDialog key={d.key} {...common} />
      case "deploy":
        return (
          <DeployDialog
            key={d.key}
            {...common}
            onDeployed={(result, hadScript) => {
              closeDialog(d.key)
              void load()
              refreshSoon()
              loadAccount(true)
              if (hasResult(result)) {
                showResult("实例已创建", result, "请保存好下面的信息（如 root 密码），关闭后面板不会再次显示。", pick(result, "id", "instance_id", "server_id"), hadScript)
              }
            }}
          />
        )
      case "rebuild":
        return (
          <RebuildDialog
            key={d.key}
            {...common}
            inst={spec.inst}
            withBusy={withBusy}
            onRebuilt={(result, hadScript) => {
              closeDialog(d.key)
              refreshSoon()
              if (hasResult(result)) showResult("重装已提交", result, "请保存好下面的信息（如新的 root 密码）。", spec.inst.id, hadScript)
            }}
          />
        )
      case "renew":
        return (
          <RenewDialog
            key={d.key}
            {...common}
            inst={spec.inst}
            withBusy={withBusy}
            onRenewed={() => {
              closeDialog(d.key)
              void load()
              loadAccount(true)
            }}
          />
        )
      case "autorenew":
        return (
          <AutoRenewDialog
            key={d.key}
            {...common}
            inst={spec.inst}
            state={autoRenew}
            withBusy={withBusy}
            onChanged={() => {
              closeDialog(d.key)
              void load()
            }}
          />
        )
      case "destroy":
        return (
          <DestroyDialog
            key={d.key}
            {...common}
            inst={spec.inst}
            withBusy={withBusy}
            onDestroyed={() => {
              closeDialog(d.key)
              setInstances((list) => list.filter((i) => i.id !== spec.inst.id))
              refreshSoon()
              loadAccount(true)
            }}
          />
        )
      case "exec":
        return <ExecDialog key={d.key} {...common} inst={spec.inst} />
      case "details":
        return <DetailsDialog key={d.key} {...common} inst={spec.inst} />
      case "result": {
        const { bootScript } = spec
        return (
          <ResultDialog
            key={d.key}
            {...common}
            title={spec.title}
            data={spec.data}
            note={spec.note}
            onShowBootScript={bootScript ? () => openDialog({ type: "output", ...bootScript, title: "启动脚本输出" }) : undefined}
          />
        )
      }
      case "output":
        return <CommandOutputDialog key={d.key} {...common} instId={spec.instId} uid={spec.uid} title={spec.title} />
    }
  }

  // ---------- 页面 ----------

  const openDeploy = () => openDialog({ type: "deploy" })
  const grid = "grid grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))] gap-4"

  let content: React.ReactNode = null
  if (!loaded) {
    content = (
      <div className={grid}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-64 rounded-2xl" />
        ))}
      </div>
    )
  } else if (instances.length) {
    content = (
      <div className={grid}>
        {instances.map((inst, i) => (
          <InstanceCard
            key={inst.id || `idx-${i}`}
            inst={inst}
            power={powerStates[inst.id]}
            autoRenew={autoRenew.items[inst.id]}
            busy={Boolean(busy[inst.id])}
            onAction={onAction}
          />
        ))}
      </div>
    )
  } else if (!error) {
    content = (
      <Empty className="rounded-2xl border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={ServerStack01Icon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>还没有实例</EmptyTitle>
          <EmptyDescription>创建第一个 EVO 实例后，会显示在这里。</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={openDeploy}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} data-icon="inline-start" />
            创建第一个实例
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <Logo size={28} />
          <span className="ml-0.5 hidden text-[17px] font-bold sm:block">Alice 面板</span>
          <div className="flex-1" />
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" className="max-w-45 min-w-0 sm:max-w-sm" onClick={() => openDialog({ type: "account" })} />}>
              <HugeiconsIcon icon={UserCircleIcon} strokeWidth={2} data-icon="inline-start" />
              {/* 手机上只显示余额，宽屏显示邮箱和余额 */}
              <span className="truncate">
                <span className={account.balance !== undefined ? "hidden sm:inline" : "inline"}>
                  {account.name || "账户"}
                  {account.balance !== undefined && " · "}
                </span>
                {account.balance !== undefined && `余额 ${fmtCredit(account.balance)}`}
              </span>
            </TooltipTrigger>
            <TooltipContent>账户信息</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label="刷新" disabled={loading} onClick={() => void load()} />}>
              {loading ? <Spinner /> : <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />}
            </TooltipTrigger>
            <TooltipContent>刷新</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label="退出登录" onClick={() => void logout()} />}>
              <HugeiconsIcon icon={Logout01Icon} strokeWidth={2} />
            </TooltipTrigger>
            <TooltipContent>退出登录</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:py-8">
        {!configured && (
          <Notice tone="warning">服务器未配置 ALICE_CLIENT_ID / ALICE_SECRET，面板暂时无法调用 Alice API。请在 .env 中填写后重启容器。</Notice>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">实例</h1>
              {loaded && !error && (
                <Badge variant="secondary" aria-label={`共 ${instances.length} 台`}>
                  {instances.length}
                </Badge>
              )}
            </div>
            <p className="min-h-4 text-xs text-muted-foreground">{updatedAt ? `更新于 ${fmtDate(updatedAt, true)}` : " "}</p>
          </div>
          <Button onClick={openDeploy}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} data-icon="inline-start" />
            新建实例
          </Button>
        </div>

        {error && (
          <Notice
            tone="error"
            action={
              <Button variant="outline" size="xs" onClick={() => void load()}>
                重试
              </Button>
            }
          >
            加载实例失败：{error}
          </Notice>
        )}

        {content}
      </main>

      {dialogs.map(renderDialog)}
    </div>
  )
}
