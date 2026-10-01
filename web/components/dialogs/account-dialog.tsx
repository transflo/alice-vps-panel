"use client"

import * as React from "react"

import { KvTable, Loading, SectionTitle } from "@/components/data-display"
import { SimpleDialog, type DialogBase } from "@/components/dialogs/shell"
import { Notice } from "@/components/notice"
import { fmtCredit } from "@/lib/alice"
import { getOverview, type Overview } from "@/lib/data"

type Part = NonNullable<Overview["profile"]>

export function AccountDialog(base: DialogBase) {
  const [state, setState] = React.useState<{ loading: boolean; data: Overview | null; error: string }>({ loading: true, data: null, error: "" })

  React.useEffect(() => {
    let alive = true
    getOverview({ force: true })
      .then((data) => alive && setState({ loading: false, data, error: "" }))
      .catch((e: unknown) => alive && setState({ loading: false, data: null, error: e instanceof Error ? e.message : String(e) }))
    return () => {
      alive = false
    }
  }, [])

  const part = (title: string, s: Part | undefined) => (
    <div>
      <SectionTitle>{title}</SectionTitle>
      {s && s.ok ? <KvTable data={s.data} /> : <Notice tone="error">获取失败：{s ? s.error : "无数据"}</Notice>}
    </div>
  )

  // 余额按美元显示，括号里保留 Alice 返回的原始值。
  const profile = state.data?.profile
  const profileData = profile && profile.ok && profile.data && typeof profile.data === "object" ? (profile.data as Record<string, unknown>) : null
  const shownProfile: Part | undefined =
    profile && profileData && profileData.credit !== undefined
      ? { ...profile, data: { ...profileData, credit: `${fmtCredit(profileData.credit)}（${String(profileData.credit)}）` } }
      : profile

  return (
    <SimpleDialog {...base} title="账户信息" size="md">
      {state.loading && <Loading />}
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {state.data && part("账户", shownProfile)}
      {state.data && part("EVO 权限", state.data.permissions)}
    </SimpleDialog>
  )
}
