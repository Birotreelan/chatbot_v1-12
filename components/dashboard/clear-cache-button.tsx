"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"

interface ClearCacheButtonProps {
  configId?: string
  variant?: "default" | "outline" | "ghost"
  size?: "default" | "sm" | "lg" | "icon"
}

export function ClearCacheButton({ configId, variant = "outline", size = "sm" }: ClearCacheButtonProps) {
  const [isClearing, setIsClearing] = useState(false)

  const handleClearCache = async () => {
    setIsClearing(true)
    try {
      const response = await fetch("/api/dashboard/cache/clear", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ configId }),
      })

      const data = await response.json()

      if (response.ok) {
        toast.success(data.message || "Caché limpiado exitosamente")
        // Reload the page to reflect changes
        window.location.reload()
      } else {
        toast.error(data.error || "Error al limpiar caché")
      }
    } catch (error) {
      console.error("Error clearing cache:", error)
      toast.error("Error al limpiar caché")
    } finally {
      setIsClearing(false)
    }
  }

  return (
    <Button variant={variant} size={size} onClick={handleClearCache} disabled={isClearing}>
      <RefreshCw className={`h-4 w-4 ${isClearing ? "animate-spin" : ""}`} />
      {size !== "icon" && <span className="ml-2">{isClearing ? "Limpiando..." : "Limpiar Caché"}</span>}
    </Button>
  )
}
