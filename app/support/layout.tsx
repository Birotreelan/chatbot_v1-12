import type React from "react"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { SupportNav } from "@/components/support/support-nav"
import { requireSupportAgent, SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function SupportLayout({
  children,
  searchParams,
}: {
  children: React.ReactNode
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const sid = typeof params._sid === "string" ? params._sid : undefined

  // SSO workaround para Safari en iframe:
  // El API /api/auth/sso no puede establecer la cookie en el redirect porque Safari
  // la bloquea (third-party cookie). En su lugar, pasa el sessionId por URL (_sid).
  // Aquí lo leemos server-side, establecemos la cookie directamente y redirigimos
  // a /support limpio para que la cookie ya esté disponible.
  if (sid) {
    console.log("[SUPPORT LAYOUT] _sid recibido, estableciendo cookie server-side:", sid)
    const cookieStore = await cookies()
    cookieStore.set(SESSION_COOKIE_NAME, sid, SESSION_COOKIE_OPTIONS)
    redirect("/support")
  }

  // Verificar autenticación de agente de soporte
  await requireSupportAgent()

  return (
    <div className="flex min-h-screen flex-col">
      <SupportNav />
      <main className="flex-1">{children}</main>
    </div>
  )
}
