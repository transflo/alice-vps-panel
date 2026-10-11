"use client"

import * as React from "react"

import { FormDialog, type DialogBase } from "@/components/dialogs/shell"
import { Notice } from "@/components/notice"
import { useLang } from "@/components/lang-provider"
import { Badge } from "@/components/ui/badge"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { api } from "@/lib/api"
import { notify } from "@/lib/notify"
import { errText } from "@/lib/utils"

const DEFAULT_API_BASE = "https://api.telegram.org"

interface TelegramConfig {
  source: "env" | "file" | null
  managedByEnv: boolean
  enabled: boolean
  running: boolean
  allowedIds: string[]
  apiBase: string
  hasToken: boolean
  tokenHint: string
  error?: string
}

// 设置弹窗：Telegram bot 的网页端配置。.env 里配了就以 .env 为准，这里只读。
export function SettingsDialog({ open, onClose, onExited }: DialogBase) {
  const { t } = useLang()
  const [cfg, setCfg] = React.useState<TelegramConfig | null>(null)
  const [loadError, setLoadError] = React.useState("")
  const [enabled, setEnabled] = React.useState(false)
  const [token, setToken] = React.useState("")
  const [ids, setIds] = React.useState("")
  const [apiBase, setApiBase] = React.useState("")

  React.useEffect(() => {
    if (!open) return
    let alive = true
    api<TelegramConfig>("GET", "/api/telegram-config")
      .then((r) => {
        if (!alive) return
        const data = r.data as TelegramConfig
        setCfg(data)
        setEnabled(data.enabled)
        setIds(data.allowedIds.join(", "))
        // 默认地址就留空显示，避免用户以为必须填。
        setApiBase(data.apiBase && data.apiBase !== DEFAULT_API_BASE ? data.apiBase : "")
      })
      .catch((e) => {
        if (alive) setLoadError(errText(e))
      })
    return () => {
      alive = false
    }
  }, [open])

  const readonly = cfg !== null && cfg.managedByEnv

  async function onSubmit() {
    const r = await api<TelegramConfig>("POST", "/api/telegram-config", {
      enabled,
      token: token || undefined,
      allowedIds: ids,
      apiBase: apiBase || undefined,
    })
    const data = r.data as TelegramConfig | undefined
    notify(data?.enabled ? t("settings.savedOn") : t("settings.savedOff"), "success")
    onClose()
  }

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={t("settings.title")}
      submitText={t("common.save")}
      onSubmit={onSubmit}
    >
      <FieldGroup>
        {loadError ? <Notice tone="error">{t("settings.loadFailed", { error: loadError })}</Notice> : null}

        {cfg ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("settings.status")}</span>
            {cfg.enabled && cfg.running ? (
              <Badge variant="success">{cfg.source === "env" ? t("settings.runningEnv") : t("settings.running")}</Badge>
            ) : cfg.enabled ? (
              <Badge variant="warning">{t("settings.starting")}</Badge>
            ) : (
              <Badge variant="outline">{t("settings.disabled")}</Badge>
            )}
            {cfg.hasToken ? <span className="font-mono text-xs text-muted-foreground">{cfg.tokenHint}</span> : null}
          </div>
        ) : null}

        {cfg?.error ? <Notice tone="warning">{cfg.error}</Notice> : null}
        {readonly ? <Notice tone="warning">{t("settings.envReadonly")}</Notice> : null}

        <Field orientation="horizontal">
          <FieldLabel htmlFor="telegram-enabled">{t("settings.enable")}</FieldLabel>
          <Switch id="telegram-enabled" checked={enabled} disabled={readonly} onCheckedChange={setEnabled} />
        </Field>

        {enabled && !readonly ? (
          <>
            <Field>
              <FieldLabel htmlFor="telegram-token">{t("settings.token")}</FieldLabel>
              <Input
                id="telegram-token"
                type="password"
                autoComplete="off"
                placeholder={cfg?.hasToken ? t("settings.tokenKeep") : t("settings.tokenPh")}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <FieldDescription>{t("settings.tokenHint")}</FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="telegram-ids">{t("settings.ids")}</FieldLabel>
              <Input
                id="telegram-ids"
                inputMode="numeric"
                autoComplete="off"
                value={ids}
                onChange={(e) => setIds(e.target.value)}
              />
              <FieldDescription>{t("settings.idsHint")}</FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="telegram-api">{t("settings.apiBase")}</FieldLabel>
              <Input
                id="telegram-api"
                inputMode="url"
                autoComplete="off"
                placeholder={DEFAULT_API_BASE}
                value={apiBase}
                onChange={(e) => setApiBase(e.target.value)}
              />
              <FieldDescription>{t("settings.apiHint")}</FieldDescription>
            </Field>

            <Field>
              <FieldDescription>{t("settings.security")}</FieldDescription>
            </Field>
          </>
        ) : null}
      </FieldGroup>
    </FormDialog>
  )
}
