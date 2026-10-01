// 操作提示：用 shadcn 的 Sonner（<Toaster /> 在 app/layout.tsx 里）。
import { toast } from "sonner"

export type Severity = "success" | "info" | "warning" | "error"

export function notify(text: string, severity: Severity = "info") {
  toast[severity](text, { duration: severity === "error" ? 6000 : 3500 })
}
