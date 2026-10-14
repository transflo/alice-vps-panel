// 面板图标（public/logo.png）。静态导出下不走 next/image 优化，直接用 img。
export function Logo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/logo.png" alt="" width={24} height={24} className={className} />
  )
}
