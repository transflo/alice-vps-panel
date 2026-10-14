"use client"

import { CopyIcon, EllipsisVerticalIcon, PlayIcon, RotateCwIcon, SquareIcon, Trash2Icon } from "lucide-react"

import { Countdown } from "@/components/countdown"
import { useLang } from "@/components/lang-provider"
import { StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { AutoRenewItem } from "@/hooks/use-dashboard-data"
import { cardStatus, copyText, fmtDate, type Instance } from "@/lib/alice"
import { notify } from "@/lib/notify"

export type InstanceAction =
  | "boot"
  | "shutdown"
  | "restart"
  | "poweroff"
  | "autorenew"
  | "rebuild"
  | "exec"
  | "details"
  | "destroy"

function IpRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  const { t } = useLang()
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-0.5">
        <span className="truncate font-mono">{value}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon-xs" aria-label={t("card.copyIp", { label })} onClick={onCopy} />
            }
          >
            <CopyIcon />
          </TooltipTrigger>
          <TooltipContent>{t("card.copyIp", { label })}</TooltipContent>
        </Tooltip>
      </span>
    </div>
  )
}

export function InstanceCard({
  inst,
  power,
  autoRenew,
  busy,
  onAction,
}: {
  inst: Instance
  power?: string
  autoRenew?: AutoRenewItem
  busy: boolean
  onAction: (action: InstanceAction, inst: Instance) => void
}) {
  const { t } = useLang()
  const disabled = busy || !inst.id
  const title = inst.name ? String(inst.name) : t("card.instanceId", { id: inst.id })
  const chips = [inst.plan, inst.os, inst.specs, inst.cpuName]
    .filter((v) => v !== undefined && v !== "")
    .map((v) => String(v))

  async function copyIp(label: string, value: string) {
    const ok = await copyText(value)
    notify(ok ? t("card.copiedIp", { label }) : t("common.copyFailed"), ok ? "success" : "error")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="truncate">{title}</CardTitle>
        <CardDescription>
          #{inst.id}
          {inst.region ? ` · ${inst.region}` : ""}
        </CardDescription>
        <CardAction>{busy ? <Spinner /> : <StatusBadge status={cardStatus(inst, power)} />}</CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {chips.length ? (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <Badge key={chip} variant="secondary">
                {chip}
              </Badge>
            ))}
          </div>
        ) : null}

        {inst.ipv4 || inst.ipv6 ? (
          <div className="flex flex-col gap-1.5">
            {inst.ipv4 ? <IpRow label={t("card.ipV4")} value={inst.ipv4} onCopy={() => void copyIp(t("card.ipV4"), inst.ipv4 as string)} /> : null}
            {inst.ipv6 ? <IpRow label={t("card.ipV6")} value={inst.ipv6} onCopy={() => void copyIp(t("card.ipV6"), inst.ipv6 as string)} /> : null}
          </div>
        ) : null}

        <Separator />

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="shrink-0 text-muted-foreground">{t("card.expires")}</span>
            <span className="flex min-w-0 items-center gap-1.5">
              {autoRenew?.enabled ? <Badge variant="outline">{t("card.autorenew", { hours: autoRenew.hours })}</Badge> : null}
              <span className="truncate tabular-nums">{fmtDate(inst.expires)}</span>
            </span>
          </div>
          {inst.expires ? (
            <div className="flex justify-end">
              <Countdown to={inst.expires} className="text-xs" />
            </div>
          ) : null}
          {inst.created ? (
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 text-muted-foreground">{t("card.created")}</span>
              <span className="truncate tabular-nums">{fmtDate(inst.created)}</span>
            </div>
          ) : null}
        </div>
      </CardContent>

      <CardFooter className="flex-wrap gap-1.5">
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => onAction("boot", inst)}>
          <PlayIcon data-icon="inline-start" />
          {t("card.boot")}
        </Button>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => onAction("shutdown", inst)}>
          <SquareIcon data-icon="inline-start" />
          {t("card.shutdown")}
        </Button>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => onAction("restart", inst)}>
          <RotateCwIcon data-icon="inline-start" />
          {t("card.restart")}
        </Button>

        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="destructive"
                  size="icon-sm"
                  disabled={disabled}
                  aria-label={t("card.delete")}
                  onClick={() => onAction("destroy", inst)}
                />
              }
            >
              <Trash2Icon />
            </TooltipTrigger>
            <TooltipContent>{t("card.delete")}</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={t("card.more")} />}
            >
              <EllipsisVerticalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => onAction("autorenew", inst)}>{t("card.menuAutorenew")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction("rebuild", inst)}>{t("card.menuRebuild")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction("exec", inst)}>{t("card.menuExec")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction("details", inst)}>{t("card.menuDetails")}</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem variant="destructive" onClick={() => onAction("poweroff", inst)}>
                  {t("card.menuPoweroff")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardFooter>
    </Card>
  )
}
