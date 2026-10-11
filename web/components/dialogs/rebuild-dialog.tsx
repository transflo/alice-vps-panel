"use client"

import * as React from "react"

import { FormDialog, type DialogBase } from "@/components/dialogs/shell"
import { BootScriptField, SelectField } from "@/components/form-fields"
import { Notice } from "@/components/notice"
import { useLang } from "@/components/lang-provider"
import { FieldGroup } from "@/components/ui/field"
import { useImageOptions, usePlanOptions, useSshKeyOptions } from "@/hooks/use-dialog-data"
import type { WithBusy } from "@/hooks/use-dashboard-data"
import { api, enc } from "@/lib/api"
import type { Instance } from "@/lib/alice"
import { notify } from "@/lib/notify"

// 重装系统：会清空数据，套餐通常沿用实例当前的套餐（只用来查可用系统）。
export function RebuildDialog({
  open,
  onClose,
  onExited,
  inst,
  withBusy,
  onRebuilt,
}: DialogBase & {
  inst: Instance
  withBusy: WithBusy
  onRebuilt: (result: unknown, hadScript: boolean) => void
}) {
  const { t } = useLang()
  const knownPlan = inst.planId !== undefined && inst.planId !== "" ? String(inst.planId) : ""
  const { options: plans, loading: plansLoading, error: plansError } = usePlanOptions(knownPlan === "")
  const [planId, setPlanId] = React.useState(knownPlan)
  const [osId, setOsId] = React.useState("")
  const [keyId, setKeyId] = React.useState("")
  const [script, setScript] = React.useState("")
  const [loadError, setLoadError] = React.useState("")

  const { options: images, loading: imagesLoading } = useImageOptions(planId, setLoadError)
  const { keys, note: keyNote } = useSshKeyOptions()

  const warning = plansError || loadError

  async function onSubmit() {
    if (!osId) throw new Error(t("deploy.needOs"))
    const r = await withBusy(inst, () =>
      api("POST", `/api/instances/${enc(inst.id)}/rebuild`, {
        os_id: osId,
        ssh_key_id: keyId || null,
        boot_script: script || undefined,
      })
    )
    notify(t("rebuild.submitted"), "success")
    onRebuilt(r.data, Boolean(script))
  }

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={t("rebuild.title", { name: inst.name ? String(inst.name) : inst.id })}
      submitText={t("rebuild.submit")}
      size="md"
      danger
      onSubmit={onSubmit}
    >
      <FieldGroup>
        <Notice tone="error">{t("rebuild.warn")}</Notice>
        {warning ? <Notice tone="warning">{warning}</Notice> : null}

        {knownPlan === "" ? (
          <SelectField
            id="rebuild-plan"
            label={t("deploy.plan")}
            value={planId}
            onChange={(next) => {
              setPlanId(next)
              setOsId("")
            }}
            options={plans}
            loading={plansLoading}
            description={t("rebuild.planForImages")}
          />
        ) : null}

        <SelectField
          id="rebuild-os"
          label={t("deploy.os")}
          value={osId}
          onChange={setOsId}
          options={images.map((image) => ({
            id: image.id,
            label: image.group ? `${image.group} · ${image.name}` : image.name,
          }))}
          loading={imagesLoading}
          disabled={!planId}
          placeholder={planId ? undefined : t("deploy.selectFirst")}
        />

        <SelectField
          id="rebuild-key"
          label={t("deploy.sshKey")}
          value={keyId}
          onChange={setKeyId}
          options={keys.map((key) => ({ id: key.id, label: key.name }))}
          placeholder={t("deploy.noKey")}
          description={keyNote || undefined}
        />

        <BootScriptField id="rebuild-script" value={script} onChange={setScript} />
      </FieldGroup>
    </FormDialog>
  )
}
