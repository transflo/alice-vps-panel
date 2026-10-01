"use client"

import * as React from "react"

import { Logo } from "@/components/logo"
import { Notice } from "@/components/notice"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/lib/api"

export function LoginPage({ message, onLogin }: { message: string; onLogin: () => void }) {
  const id = React.useId()
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState(message)
  const [submitting, setSubmitting] = React.useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSubmitting(true)
    try {
      await api("POST", "/api/login", { password })
      onLogin()
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex))
      setSubmitting(false)
    }
  }

  return (
    <main className="grid min-h-svh place-items-center p-4">
      <Card className="w-full max-w-sm">
        <CardContent>
          <form onSubmit={submit} className="flex flex-col items-center gap-6 py-2">
            <Logo size={48} />
            <div className="text-center">
              <h1 className="text-xl font-bold">Alice 面板</h1>
              <p className="text-sm text-muted-foreground">EVO 实例管理</p>
            </div>
            <Field>
              <FieldLabel htmlFor={id}>管理密码</FieldLabel>
              <Input
                id={id}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
                required
              />
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" size="lg" className="w-full" disabled={submitting}>
              {submitting && <Spinner data-icon="inline-start" />}
              登录
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
