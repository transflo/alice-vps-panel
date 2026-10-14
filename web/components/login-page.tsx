"use client"

import * as React from "react"

import { useLang } from "@/components/lang-provider"
import { Logo } from "@/components/logo"
import { Notice } from "@/components/notice"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/lib/api"
import { errText } from "@/lib/utils"

export function LoginPage({ message, onLogin }: { message: string; onLogin: () => void }) {
  const { t } = useLang()
  const [password, setPassword] = React.useState("")
  // 进来时可能带着「登录已失效」之类的提示。
  const [error, setError] = React.useState(message)
  const [submitting, setSubmitting] = React.useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setSubmitting(true)
    try {
      await api("POST", "/api/login", { password })
      onLogin()
    } catch (err) {
      setError(errText(err))
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-9 items-center justify-center rounded-md bg-muted">
            <Logo className="size-5" />
          </div>
          <CardTitle>{t("login.title")}</CardTitle>
          <CardDescription>{t("login.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="panel-password">{t("login.password")}</FieldLabel>
                <Input
                  id="panel-password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              {error ? <Notice tone="error">{error}</Notice> : null}
              <Button type="submit" disabled={submitting}>
                {submitting ? <Spinner data-icon="inline-start" /> : null}
                {t("login.submit")}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
