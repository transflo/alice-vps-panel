"use client"

import { DurationField } from "@/components/form-fields"
import { FormDialog, type DialogBase } from "@/components/dialogs/shell"
import { fmtDate, pick, toDate, type Instance } from "@/lib/alice"
import { api, enc } from "@/lib/api"
import { notify } from "@/lib/notify"
import type { WithBusy } from "@/hooks/use-dashboard-data"
import { useClampedHours, useMaxHours } from "@/hooks/use-dialog-data"

export function RenewDialog({
  inst,
  withBusy,
  onRenewed,
  ...base
}: DialogBase & { inst: Instance; withBusy: WithBusy; onRenewed: () => void }) {
  const max = useMaxHours()
  const [time, setTime] = useClampedHours("24", max)

  const submit = async () => {
    const r = await withBusy(inst, () => api("POST", `/api/instances/${enc(inst.id)}/renewals`, { time: Number(time) }))
    const next = toDate(pick(r.data, "expiration_at_utc", "expiration_at"))
    notify(next ? `续期成功，新的到期时间 ${fmtDate(next)}` : "续期成功", "success")
    onRenewed()
  }

  return (
    <FormDialog {...base} title={`续期 · ${inst.name || `#${inst.id}`}`} submitText="续期" size="xs" onSubmit={submit}>
      <p className="text-sm text-muted-foreground">当前到期时间：{fmtDate(inst.expires)}</p>
      <DurationField label="续期时长" value={time} onChange={setTime} max={max} />
    </FormDialog>
  )
}
