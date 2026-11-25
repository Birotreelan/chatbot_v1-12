/**
 * Las etiquetas del corpus de conversaciones (25/11/2026).
 *
 * GET  → todas las etiquetas y el resumen.
 * POST → guarda una. DELETE → borra una, para corregir.
 *
 * Exige super_admin, igual que el export de conversaciones del que sale el
 * corpus: la etiqueta no trae datos del paciente —el id es el hash del
 * teléfono— pero la pantalla que la usa muestra las conversaciones enteras, y
 * las dos puertas tienen que pedir lo mismo. Una cerradura más débil en la
 * segunda puerta de la misma habitación no sirve de nada.
 */

import { type NextRequest, NextResponse } from "next/server"
import { requireAuthFromRequest } from "@/lib/auth"
import {
  guardarEtiqueta,
  leerEtiquetas,
  borrarEtiqueta,
  resumirCorpus,
  type EtiquetaDeConversacion,
  type QueQueria,
  type Resultado,
} from "@/lib/evaluacion/corpus-de-conversaciones"

export const runtime = "nodejs"

const QUE_QUERIA: QueQueria[] = [
  "turno_nuevo",
  "reagendar",
  "cancelar",
  "confirmar",
  "consulta_practica",
  "consulta_clinica",
  "hablar_con_humano",
  "otra",
  "no_se_entiende",
]

const RESULTADOS: Resultado[] = [
  "resuelto",
  "resuelto_con_friccion",
  "no_resuelto",
  "derivado_bien",
  "derivado_mal",
  "error_tecnico",
]

async function sesionDeSuperAdmin(request: NextRequest) {
  const { session, error } = await requireAuthFromRequest(request as Request)
  if (!session) return { error: NextResponse.json({ error: error || "No autenticado" }, { status: 401 }) }
  if (session.role !== "super_admin") {
    return { error: NextResponse.json({ error: "No autorizado — se requiere super_admin" }, { status: 403 }) }
  }
  return { session }
}

export async function GET(request: NextRequest) {
  const { error, session } = await sesionDeSuperAdmin(request)
  if (error) return error

  const etiquetas = await leerEtiquetas()
  return NextResponse.json({
    ok: true,
    etiquetas,
    resumen: resumirCorpus(etiquetas),
    etiquetadoPor: session!.username,
  })
}

export async function POST(request: NextRequest) {
  const { error, session } = await sesionDeSuperAdmin(request)
  if (error) return error

  let cuerpo: any
  try {
    cuerpo = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 })
  }

  const id = String(cuerpo.id || "").trim()
  const configId = String(cuerpo.configId || "").trim()
  if (!id || !configId) {
    return NextResponse.json({ ok: false, error: "Faltan id y configId" }, { status: 400 })
  }

  /**
   * Los dos valores se validan contra la lista en vez de aceptarse como
   * string. Una etiqueta con un valor que no existe no rompe nada al
   * guardarse: rompe el resumen, semanas después, cuando ya nadie se acuerda
   * de dónde salió y hay cien etiquetas que no se pueden volver a hacer.
   */
  if (!QUE_QUERIA.includes(cuerpo.queQueria)) {
    return NextResponse.json(
      { ok: false, error: `queQueria inválido. Esperado uno de: ${QUE_QUERIA.join(", ")}` },
      { status: 400 },
    )
  }
  if (!RESULTADOS.includes(cuerpo.resultado)) {
    return NextResponse.json(
      { ok: false, error: `resultado inválido. Esperado uno de: ${RESULTADOS.join(", ")}` },
      { status: 400 },
    )
  }

  const etiqueta: EtiquetaDeConversacion = {
    id,
    configId,
    clinica: cuerpo.clinica ? String(cuerpo.clinica) : undefined,
    queQueria: cuerpo.queQueria,
    resultado: cuerpo.resultado,
    nota: cuerpo.nota ? String(cuerpo.nota).slice(0, 2000) : undefined,
    mensajesDelBot: typeof cuerpo.mensajesDelBot === "number" ? cuerpo.mensajesDelBot : undefined,
    etiquetadoPor: session!.username,
    etiquetadoEn: new Date().toISOString(),
  }

  const guardada = await guardarEtiqueta(etiqueta)
  if (!guardada) {
    return NextResponse.json({ ok: false, error: "No se pudo guardar" }, { status: 500 })
  }
  return NextResponse.json({ ok: true, etiqueta })
}

export async function DELETE(request: NextRequest) {
  const { error } = await sesionDeSuperAdmin(request)
  if (error) return error

  const url = new URL(request.url)
  const id = url.searchParams.get("id") || ""
  const configId = url.searchParams.get("configId") || ""
  if (!id || !configId) {
    return NextResponse.json({ ok: false, error: "Faltan id y configId" }, { status: 400 })
  }

  const borrada = await borrarEtiqueta(configId, id)
  return NextResponse.json({ ok: borrada })
}
