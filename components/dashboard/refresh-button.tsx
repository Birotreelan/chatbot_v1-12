"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"

export function RefreshButton() {
  const router = useRouter()
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleRefresh = async () => {
    setIsRefreshing(true)

    try {
      // Refrescar la página actual
      router.refresh()

      // Simular un pequeño delay para mostrar el estado de carga
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } catch (error) {
      console.error("Error al refrescar:", error)
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRefresh}
      disabled={isRefreshing}
      className="flex items-center space-x-2"
    >
      <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
      <span>{isRefreshing ? "Actualizando..." : "Actualizar"}</span>
    </Button>
  )
}
