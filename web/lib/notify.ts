// 全局提示。底层是 shadcn 的 toast（Base UI），错误停留久一点，方便看清原因。
import { toast } from "@/components/ui/toast"

export type Severity = "success" | "info" | "warning" | "error"

export function notify(title: string, severity: Severity = "info") {
  toast.add({ title, type: severity, timeout: severity === "error" ? 6000 : 3500 })
}
