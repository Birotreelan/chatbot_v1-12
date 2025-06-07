import { NextResponse } from "next/server"
import { clearAllUserQueues } from "@/lib/user-queue"

export async function POST() {
  try {
    await clearAllUserQueues()
    return NextResponse.json({ success: true, message: "Colas limpiadas exitosamente" })
  } catch (error) {
    console.error("Error al limpiar colas:", error)
    return NextResponse.json({ success: false, error: "Error al limpiar colas" }, { status: 500 })
  }
}
