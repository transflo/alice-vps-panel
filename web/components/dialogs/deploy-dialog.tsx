"use client"

import * as React from "react"

import { BootScriptField, DurationField, SelectField, type Option } from "@/components/form-fields"
import { FormDialog, type DialogBase } from "@/components/dialogs/shell"
import { Notice } from "@/components/notice"
import { planOptions } from "@/lib/alice"
import { api } from "@/lib/api"
import { getPermissions, getPlans } from "@/lib/data"
import { notify } from "@/lib/notify"
import { useClampedHours, useImageOptions, useMaxHours, useSshKeyOptions } from "@/hooks/use-dialog-data"

export function DeployDialog({
  onDeployed,
  ...base
}: DialogBase & { onDeployed: (data: unknown, hadScript: boolean) => void }) {
  const [loadError, setLoadError] = React.useState("")
  const [plans, setPlans] = React.useState<Option[] | null>(null)
  const [planId, setPlanId] = React.useState("")
  const [osId, setOsId] = React.useState("")
  const [keyId, setKeyId] = React.useState("")
  const [script, setScript] = React.useState("")
  const max = useMaxHours()
  const [time, setTime] = useClampedHours("24", max)
  const keys = useSshKeyOptions()
  const images = useImageOptions(planId, setLoadError)

  React.useEffect(() => {
    let alive = true
    Promise.all([getPlans(), getPermissions()])
      .then(([list, perm]) => {
        if (!alive) return
        const options = planOptions(list, perm)
        setPlans(options)
        const usable = options.filter((o) => !o.disabled)
        if (usable.length === 1) setPlanId(usable[0].id)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setPlans([])
        setLoadError(`套餐加载失败：${e instanceof Error ? e.message : String(e)}`)
      })
    return () => {
      alive = false
    }
  }, [])

  // 换套餐后系统镜像列表不同，已选的系统作废。
  const changePlan = (id: string) => {
    setPlanId(id)
    setOsId("")
  }

  const submit = async () => {
    if (!planId) throw new Error("请选择套餐")
    if (!osId) throw new Error("请选择系统")
    const r = await api("POST", "/api/instances", {
      plan_id: planId,
      os_id: osId,
      time: Number(time),
      ssh_key_id: keyId || null,
      boot_script: script || undefined,
    })
    notify("实例创建请求已提交", "success")
    onDeployed(r.data, Boolean(script))
  }

  return (
    <FormDialog {...base} title="新建实例" submitText="创建实例" onSubmit={submit}>
      {loadError && <Notice tone="warning">{loadError}</Notice>}
      <SelectField label="套餐" value={planId} onChange={changePlan} options={plans || []} loading={plans === null} required />
      <SelectField
        label="系统"
        value={osId}
        onChange={setOsId}
        options={images.options}
        loading={images.loading}
        disabled={!planId}
        description={planId ? undefined : "请先选择套餐"}
        required
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <DurationField value={time} onChange={setTime} max={max} />
        <SelectField
          label="SSH 密钥"
          value={keyId}
          onChange={setKeyId}
          options={keys.keys || []}
          loading={keys.keys === null}
          emptyLabel="不使用（使用密码登录）"
          description={keys.note}
        />
      </div>
      <BootScriptField value={script} onChange={setScript} />
    </FormDialog>
  )
}
