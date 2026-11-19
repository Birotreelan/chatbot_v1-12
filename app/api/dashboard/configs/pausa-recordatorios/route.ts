/**
 * Pausar y reanudar los RECORDATORIOS de un cliente desde el dashboard.
 *
 * Distinta de `toggle-pause`, que corta TODOS los envíos: ésta ignora sólo los
 * recordatorios de turno y deja al bot contestando. Ver
 * lib/pausa-de-recordatorios.ts, que explica qué se pausa y qué no.
 *
 *   GET  ?configId=…  → estado actual
 *   POST { configId } → alterna
 */

import { NextResponse } from "next/server"

import { requireAuthForApi } from "@/lib/auth"
import {
  estadoDeRecordatorios,
  pausarRecordatorios,
  reanudarRecordatorios,
} from "@/lib/pausa-de-recordatorios"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const { session, error } = await requireAuthForApi()
  if (!session) {
    return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })
  }

  const configId = new URL(request.url).searchParams.get("configId") || ""
  if (!configId) {
    return NextResponse.json({ error: "Falta configId" }, { status: 400 })
  }

  return NextResponse.json({ success: true, ...(await estadoDeRecordatorios(configId)) })
}

export async function POST(request: Request) {
  const { session, error } = await requireAuthForApi()
  if (!session) {
    return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })
  }

  const cuerpo = await request.json().catch(() => null)
  const configId = String(cuerpo?.configId || "")
  if (!configId) {
    return NextResponse.json({ error: "Falta configId" }, { status: 400 })
  }

  const { pausado } = await estadoDeRecordatorios(configId)
  const nuevoEstado = !pausado
  const quien = session.username || "dashboard"

  const ok = nuevoEstado
    ? await pausarRecordatorios(configId, { por: quien, motivo: String(cuerpo?.motivo || "") || undefined })
    : await reanudarRecordatorios(configId, quien)

  if (!ok) {
    return NextResponse.json({ error: "No se pudo cambiar el estado" }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    paused: nuevoEstado,
    message: nuevoEstado
      ? "Recordatorios pausados: los avisos de turno aprobado, cancelado o reagendado siguen saliendo"
      : "Recordatorios reanudados",
  })
}
