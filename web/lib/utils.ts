export { cn } from "cn"

// 统一的异常文案：Error 取 message，其他类型直接字符串化。
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
