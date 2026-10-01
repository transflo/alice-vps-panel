"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ComputerTerminal01Icon,
  Clock01Icon,
  Copy01Icon,
  Delete02Icon,
  InformationCircleIcon,
  MoreVerticalIcon,
  PlayIcon,
  PowerSocket01Icon,
  ReloadIcon,
  RepeatIcon,
  RotateClockwiseIcon,
  ShutDownIcon,
} from "@hugeicons/core-free-icons"

import { StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cardStatus, copyText, fmtDate, fmtRemaining, type Instance } from "@/lib/alice"
import { notify } from "@/lib/notify"
import { cn } from "@/lib/utils"

export type InstanceAction =
  | "boot"
  | "shutdown"
  | "restart"
  | "poweroff"
  | "renew"
  | "autorenew"
  | "rebuild"
  | "exec"
  | "details"
  | "destroy"

function Countdown({ to }: { to: Date }) {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const left = to.getTime() - now
  return (
    <Badge
      variant="outline"
      className={cn(
        left <= 0 && "border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20",
        left > 0 && left < 3600 * 1000 && "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400"
      )}
    >
      {fmtRemaining(left)}
    </Badge>
  )
}

function IpRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-9 flex-none text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-mono text-[13px]">{value}</span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`复制 ${label}`}
              onClick={async () => {
                const ok = await copyText(value)
                notify(ok ? `已复制 ${label}` : "复制失败，请手动复制", ok ? "success" : "error")
              }}
            />
          }
        >
          <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
        </TooltipTrigger>
        <TooltipContent>复制 {label}</TooltipContent>
      </Tooltip>
    </div>
  )
}

const MENU: { action: InstanceAction; label: string; icon: typeof PlayIcon }[] = [
  { action: "poweroff", label: "强制关机", icon: PowerSocket01Icon },
  { action: "renew", label: "续期", icon: Clock01Icon },
  { action: "autorenew", label: "自动续期", icon: RepeatIcon },
  { action: "rebuild", label: "重装系统", icon: ReloadIcon },
  { action: "exec", label: "执行命令", icon: ComputerTerminal01Icon },
  { action: "details", label: "详细信息", icon: InformationCircleIcon },
]

export function InstanceCard({
  inst,
  power,
  autoRenew,
  busy,
  onAction,
}: {
  inst: Instance
  power?: string
  autoRenew?: { enabled: boolean; hours: number }
  busy: boolean
  onAction: (action: InstanceAction, inst: Instance) => void
}) {
  const disabled = busy || !inst.id
  const chips = [inst.plan, inst.os, inst.specs, inst.cpuName].filter((x) => x !== undefined && x !== "")

  return (
    <Card data-instance={inst.id}>
      <CardHeader>
        <CardTitle className="truncate text-base font-bold">{inst.name || `实例 #${inst.id}`}</CardTitle>
        <CardDescription>{[`#${inst.id}`, inst.region].filter(Boolean).join(" · ")}</CardDescription>
        <CardAction className="flex items-center gap-2">
          {busy && <Spinner />}
          <StatusBadge status={cardStatus(inst, power)} />
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <Badge key={String(c)} variant="outline" className="max-w-full text-muted-foreground">
                {String(c)}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-0.5">
          <IpRow label="IPv4" value={inst.ipv4} />
          <IpRow label="IPv6" value={inst.ipv6} />
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">到期</span>
            {fmtDate(inst.expires)}
            {inst.expires && <Countdown to={inst.expires} />}
            {autoRenew && autoRenew.enabled && (
              <Badge variant="secondary">
                <HugeiconsIcon icon={RepeatIcon} strokeWidth={2} data-icon="inline-start" />
                自动续期 {autoRenew.hours}h
              </Badge>
            )}
          </div>
          {inst.created && (
            <div>
              <span className="mr-2 text-muted-foreground">创建</span>
              {fmtDate(inst.created)}
            </div>
          )}
        </div>
      </CardContent>

      <CardFooter className="flex-wrap gap-1 border-t">
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onAction("boot", inst)}>
          <HugeiconsIcon icon={PlayIcon} strokeWidth={2} data-icon="inline-start" />
          开机
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onAction("shutdown", inst)}>
          <HugeiconsIcon icon={ShutDownIcon} strokeWidth={2} data-icon="inline-start" />
          关机
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onAction("restart", inst)}>
          <HugeiconsIcon icon={RotateClockwiseIcon} strokeWidth={2} data-icon="inline-start" />
          重启
        </Button>
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="destructive" size="icon-sm" aria-label="删除实例" disabled={disabled} onClick={() => onAction("destroy", inst)} />}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
          </TooltipTrigger>
          <TooltipContent>删除实例</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="更多操作" disabled={disabled} />}>
            <HugeiconsIcon icon={MoreVerticalIcon} strokeWidth={2} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {MENU.map((m) => (
              <DropdownMenuItem key={m.action} onClick={() => onAction(m.action, inst)}>
                <HugeiconsIcon icon={m.icon} strokeWidth={2} />
                {m.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardFooter>
    </Card>
  )
}
