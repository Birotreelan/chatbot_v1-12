/**
 * La línea de base del motor conversacional (24/11/2026).
 *
 * Devuelve las cuatro métricas del plan para una ventana de fechas. Ver
 * lib/metricas/linea-de-base.ts, que explica cada una y por qué se cuenta así.
 *
 * ── Por qué exige sesión ───────────────────────────────────────────────────
 *
 * Las estadísticas agregadas del dashboard quedaron abiertas a propósito
 * —no identifican a nadie— pero esto no es lo mismo: devuelve el nombre de
 * cada clínica con su volumen de turnos y su gasto en mensajes. Es información
 * comercial de 25 clientes en una sola respuesta.
 *
 * ── Y por qué es una ruta y no un script ──────────────────────────────────
 *
 * Porque la medición hay que repetirla: la de hoy sirve recién cuando exista
 * la de dentro de dos meses, y las dos tienen que salir de la misma cuenta. Un
 * script que alguien corre a mano se va a correr distinto la segunda vez.
 */

import { type NextRequest, NextResponse } from "next/server"
import { requireAuthFromRequest } from "@/lib/auth"
import {
  medirLineaDeBase,
  guardarMedicion,
  medicionesGuardadas,
  leerMedicion,
} from "@/lib/metricas/linea-de-base"

export const runtime = "nodejs"
/** Leer el historial de cientos de conversaciones no entra en el default. */
export const maxDuration = 300

/** `YYYY-MM-DD`, que es el formato de los contadores por día. */
function fecha(valor: string | null, porDefecto: Date): string {
  if (valor && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor
  return porDefecto.toISOString().slice(0, 10)
}

export async function GET(request: NextRequest) {
  const { session: sesion, error: errorDeSesion } = await requireAuthFromRequest(request as Request)
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }

  const url = new URL(request.url)
  const ahora = new Date()
  const haceSieteDias = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000)

  const desde = fecha(url.searchParams.get("desde"), haceSieteDias)
  const hasta = fecha(url.searchParams.get("hasta"), ahora)
  const configIds = (url.searchParams.get("configIds") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  try {
    // `?guardadas=1` lista las ventanas ya medidas, sin medir nada.
    if (url.searchParams.get("guardadas") === "1") {
      return NextResponse.json({ ok: true, ventanas: await medicionesGuardadas() })
    }

    /**
     * `?leer=1` devuelve la medición guardada de esa ventana.
     *
     * No es un caché: es el único camino para una ventana vieja. Las
     * conversaciones vencen con el TTL del historial, así que recalcular la
     * línea de base de hace dos meses daría un número distinto y más bajo, sin
     * que nada avise. Ver la nota de `guardarMedicion`.
     */
    if (url.searchParams.get("leer") === "1") {
      const guardada = await leerMedicion(desde, hasta)
      if (!guardada) {
        return NextResponse.json(
          { ok: false, error: `No hay una medición guardada de ${desde} a ${hasta}` },
          { status: 404 },
        )
      }
      return NextResponse.json({ ok: true, guardada: true, ...guardada })
    }

    const medicion = await medirLineaDeBase({
      desde,
      hasta,
      configIds: configIds.length ? configIds : undefined,
      // `?rapido=1` saltea la clasificación de finales, que es lo que tarda.
      sinFinales: url.searchParams.get("rapido") === "1",
    })

    // Se guarda sólo si se pidió: una medición parcial —una clínica sola, o sin
    // los finales— no es la línea de base y guardarla la pisaría.
    let guardada = false
    if (url.searchParams.get("guardar") === "1" && !configIds.length) {
      guardada = await guardarMedicion(medicion)
    }

    return NextResponse.json({ ok: true, guardada, ...medicion })
  } catch (error) {
    console.error("[METRICAS] No se pudo medir la línea de base:", error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 500 },
    )
  }
}
