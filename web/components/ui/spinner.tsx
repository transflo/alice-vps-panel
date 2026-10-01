import { cn } from "cn"
import { HugeiconsIcon } from "@hugeicons/react"
import { Loading03Icon } from "@hugeicons/core-free-icons"

// strokeWidth 收窄成 number：HugeiconsIcon 不接受 string（模板原样会让 tsc 报错）。
function Spinner({ className, ...props }: Omit<React.ComponentProps<"svg">, "strokeWidth"> & { strokeWidth?: number }) {
  return (
    <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} data-slot="spinner" role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
