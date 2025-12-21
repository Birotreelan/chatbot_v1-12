"use server"

import { verifyCredentials, createSession, logout as logoutSession } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

export async function login(username: string, password: string) {
  try {
    const result = await verifyCredentials(username, password)

    if (result.success && result.user) {
      await createSession(result.user)
      revalidatePath("/dashboard")
      revalidatePath("/support")

      // Redirigir según el rol
      if (result.user.role === "super_admin") {
        redirect("/dashboard")
      } else {
        redirect("/support")
      }
    } else {
      return { success: false, error: result.error || "Usuario o contraseña incorrectos" }
    }
  } catch (error) {
    // Si el error es un redirect, dejarlo pasar
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error
    }

    console.error("Error al iniciar sesión:", error)
    return { success: false, error: "Error al procesar la solicitud" }
  }
}

export async function logout() {
  try {
    await logoutSession()
    revalidatePath("/")
    return { success: true }
  } catch (error) {
    console.error("Error al cerrar sesión:", error)
    return { success: false, error: "Error al cerrar sesión" }
  }
}
