"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"

// 按 d 键在浅色 / 深色之间切换（输入框里打字不触发），方便快速看两种配色。
function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "d" && e.key !== "D") return
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      setTheme(resolvedTheme === "dark" ? "light" : "dark")
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [resolvedTheme, setTheme])

  return null
}

export function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange {...props}>
      <ThemeHotkey />
      {children}
    </NextThemesProvider>
  )
}
