"use server"

import { verifyCredentials, createSession, logout as logoutSession } from "@/lib/auth"
import { revalidatePath } from "next/cache"

export async function login(username: string, password: string) {
  try {
    const isValid = await verifyCredentials(username, password)

    if (isValid) {
      await createSession(username)
      revalidatePath("/dashboard")
      return { success: true }
    } else {
      return { success: false, error: "Usuario o contraseña incorrectos" }
    }
  } catch (error) {
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
