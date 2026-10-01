"use client"

import * as React from "react"

import { BootScriptField, SelectField, type Option } from "@/components/form-fields"
import { FormDialog, type DialogBase } from "@/components/dialogs/shell"
import { Notice } from "@/components/notice"
import type { Instance } from "@/lib/alice"
import { api, enc } from "@/lib/api"
import { getPlans } from "@/lib/data"
import { notify } from "@/lib/notify"
import type { WithBusy } from "@/hooks/use-dashboard-data"
import { useImageOptions, useSshKeyOptions } from "@/hooks/use-dialog-data"

export function RebuildDialog({
  inst,
  withBusy,
  onRebuilt,
  ...base
}: DialogBase & { inst: Instance; withBusy: WithBusy; onRebuilt: (data: unknown, hadScript: boolean) => void }) {
  const [loadError, setLoadError] = React.useState("")
  // 系统镜像按套餐获取；实例数据里没有套餐 ID 时让用户自己选。
  const knownPlan = inst.planId !== undefined ? String(inst.planId) : ""
  const [plans, setPlans] = React.useState<Option[] | null>(null)
  const [planId, setPlanId] = React.useState(knownPlan)
  const [osId, setOsId] = React.useState("")
  const [keyId, setKeyId] = React.useState("")
  const [script, setScript] = React.useState("")
  const keys = useSshKeyOptions()
  const images = useImageOptions(planId, setLoadError)

  React.useEffect(() => {
    if (knownPlan) return undefined
    let alive = true
    getPlans()
      .then((list) => alive && setPlans(list.map((p) => ({ id: p.id, label: p.name }))))
      .catch((e: unknown) => {
        if (!alive) return
        setPlans([])
        setLoadError(`套餐加载失败：${e instanceof Error ? e.message : String(e)}`)
      })
    return () => {
      alive = false
    }
  }, [knownPlan])

  const changePlan = (id: string) => {
    setPlanId(id)
    setOsId("")
  }

  const submit = async () => {
    if (!osId) throw new Error("请选择系统")
    const r = await withBusy(inst, () =>
      api("POST", `/api/instances/${enc(inst.id)}/rebuild`, {
        os_id: osId,
        ssh_key_id: keyId || null,
        boot_script: script || undefined,
      })
    )
    notify("重装请求已提交", "success")
    onRebuilt(r.data, Boolean(script))
  }

  return (
    <FormDialog
      {...base}
      title={`重装系统 · ${inst.name || `#${inst.id}`}`}
      submitText="确认重装"
      danger
      onSubmit={submit}
      notice={<Notice tone="warning">重装会清空这台实例上的全部数据，且无法恢复。</Notice>}
    >
      {loadError && <Notice tone="warning">{loadError}</Notice>}
      {!knownPlan && (
        <SelectField
          label="套餐"
          value={planId}
          onChange={changePlan}
          options={plans || []}
          loading={plans === null}
          description="用于加载该套餐可用的系统镜像"
          required
        />
      )}
      <SelectField label="系统" value={osId} onChange={setOsId} options={images.options} loading={images.loading} disabled={!planId} required />
      <SelectField
        label="SSH 密钥"
        value={keyId}
        onChange={setKeyId}
        options={keys.keys || []}
        loading={keys.keys === null}
        emptyLabel="不使用（使用密码登录）"
        description={keys.note}
      />
      <BootScriptField value={script} onChange={setScript} />
    </FormDialog>
  )
}
