import { LoginForm } from "@/components/auth/login-form"
import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string }
}) {
  // Si ya hay una sesión activa, redirigir al dashboard
  const session = await getSession()
  if (session) {
    redirect("/dashboard")
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-gray-50">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold mb-2">WhatsApp AI Assistant</h1>
        <p className="text-gray-600">Panel de administración para gestionar tus asistentes de WhatsApp</p>
      </div>

      <LoginForm error={searchParams.error} />
    </main>
  )
}
