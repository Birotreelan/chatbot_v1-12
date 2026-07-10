import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "../globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Widget de Turnos - Treelan",
  description: "Widget de agendamiento por formulario para sitios web",
}

/**
 * Layout del widget de formulario (tercer tipo de widget, 9/7/2026) — hermano
 * de app/widget/layout.tsx. No se duplica el bloque grande de CSS manual que
 * tiene ese layout (parece scaffolding defensivo de los inicios del widget de
 * chat): components/widget-form.tsx usa clases de Tailwind que igual no
 * estaban cubiertas ahí (grid-cols-3, border-sky-400, etc.), así que esa lista
 * manual no alcanzaría de todos modos. globals.css ya resuelve esto en el
 * resto del proyecto, incluido /widget.
 */
export default function WidgetFormLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" className={inter.className}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style
          dangerouslySetInnerHTML={{
            __html: `
            * { box-sizing: border-box; }
            html, body {
              margin: 0;
              padding: 0;
              height: 100%;
              font-family: system-ui, -apple-system, sans-serif;
            }
          `,
          }}
        />
      </head>
      <body className="h-full">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
