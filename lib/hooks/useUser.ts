"use client"

import { useState, useEffect } from "react"

interface User {
  username: string
  isAuthenticated: boolean
}

// Hook personalizado para manejar el estado del usuario
export function useUser() {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    checkAuthStatus()
  }, [])

  const checkAuthStatus = async () => {
    try {
      setIsLoading(true)
      setError(null)

      // Verificar si hay una sesión activa
      const response = await fetch("/api/auth/session", {
        method: "GET",
        credentials: "include",
      })

      if (response.ok) {
        const data = await response.json()
        setUser({
          username: data.username || "admin",
          isAuthenticated: true,
        })
      } else {
        setUser(null)
      }
    } catch (err) {
      console.error("Error checking auth status:", err)
      setError("Error al verificar la autenticación")
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }

  const login = async (username: string, password: string) => {
    try {
      setError(null)

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      })

      if (response.ok) {
        const data = await response.json()
        setUser({
          username: data.username || username,
          isAuthenticated: true,
        })
        return { success: true }
      } else {
        const errorData = await response.json()
        setError(errorData.message || "Error al iniciar sesión")
        return { success: false, error: errorData.message || "Error al iniciar sesión" }
      }
    } catch (err) {
      console.error("Login error:", err)
      const errorMessage = "Error de conexión"
      setError(errorMessage)
      return { success: false, error: errorMessage }
    }
  }

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      })
    } catch (err) {
      console.error("Logout error:", err)
    } finally {
      setUser(null)
    }
  }

  return {
    user,
    isLoading,
    error,
    login,
    logout,
    checkAuthStatus,
  }
}

// Hook simplificado para solo verificar si está autenticado
export function useAuth() {
  const { user, isLoading } = useUser()

  return {
    isAuthenticated: !!user?.isAuthenticated,
    isLoading,
    user,
  }
}
