import type { Metadata } from "next"
import { Geist_Mono, Inter } from "next/font/google"

import "./globals.css"
import { LangProvider } from "@/components/lang-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "cn"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })
const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

export const metadata: Metadata = {
  title: "Alice 面板",
  description: "Alice EVO 实例管理面板",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={cn("antialiased", inter.variable, fontMono.variable, "font-sans")}
    >
      <body>
        <ThemeProvider>
          <LangProvider>
            <TooltipProvider>
              <Toaster>{children}</Toaster>
            </TooltipProvider>
          </LangProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
