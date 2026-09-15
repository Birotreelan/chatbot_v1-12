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
      revalidatePath("/facturacion")

      // Redirigir según el rol
      if (result.user.role === "super_admin") {
        redirect("/dashboard")
      } else if (result.user.role === "billing_agent") {
        redirect("/facturacion")
      } else {
        // Clientes Proxmox van a su propio panel (15/9/2026). El layout lo
        // revalida igual; resolverlo acá evita un redirect extra al entrar.
        const { rutaPanelSoporte } = await import("@/lib/auth")
        redirect(await rutaPanelSoporte(result.user.tenantId))
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
