"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"

/**
 * Página de embed para autenticar con JWT y redirigir al panel
 * URL: /support/embed?token=eyJ...
 */
export default function EmbedAuthPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const authenticateAndRedirect = async () => {
      try {
        const token = searchParams.get("token")

        if (!token) {
          setError("Token no proporcionado en la URL")
          setLoading(false)
          return
        }

        console.log("[EMBED_PAGE] Autenticando con token...")

        // Enviar token al endpoint de autenticación
        const response = await fetch("/api/support/embed/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          credentials: "include", // Importante para que las cookies funcionen
        })

        const data = await response.json()

        if (!data.success) {
          setError(data.error || "Error de autenticación")
          setLoading(false)
          return
        }

        console.log("[EMBED_PAGE] ✅ Autenticado correctamente, redirigiendo...")

        // Redirigir al panel principal
        router.replace("/support")
      } catch (err) {
        console.error("[EMBED_PAGE] Error:", err)
        setError("Error durante la autenticación")
        setLoading(false)
      }
    }

    authenticateAndRedirect()
  }, [searchParams, router])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Autenticando...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4 max-w-md p-6 border border-red-200 rounded-lg bg-red-50">
          <h1 className="text-2xl font-bold text-red-900">Error de Autenticación</h1>
          <p className="text-red-700">{error}</p>
          <p className="text-sm text-red-600">
            Contacta al administrador si el problema persiste.
          </p>
        </div>
      </div>
    )
  }

  return null
}
