/**
 * Búsqueda de obras sociales para el selector del alta (23/9/2026).
 *
 * Es de sólo lectura y sobre un catálogo que la clínica publica igual, pero
 * igual exige un token vigente: sin eso sería un endpoint abierto que permite
 * enumerar los convenios de cualquier cliente pasando su `clienteId`. El
 * `clienteId` sale del token, nunca del query string.
 */

import { NextResponse } from "next/server"
import { leerEnlace } from "@/lib/portal/token"
import { permiteGestionar } from "@/lib/portal/vigencia"
import { buscarObrasSociales } from "@/lib/portal/identidad"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get("token") || ""
  const busqueda = url.searchParams.get("q") || ""

  if (!token) return NextResponse.json({ ok: false, opciones: [] }, { status: 400 })

  const lectura = await leerEnlace(token)
  if (!lectura || !lectura.contexto.clienteId || !permiteGestionar(lectura.estado)) {
    return NextResponse.json({ ok: false, opciones: [] }, { status: 404 })
  }

  const opciones = await buscarObrasSociales(lectura.contexto.clienteId, busqueda)

  return NextResponse.json({ ok: true, opciones })
}
