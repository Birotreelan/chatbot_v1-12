/**
 * Alta de Flows y templates desde el dashboard (21/9/2026).
 *
 * ── Sobre la autenticación ─────────────────────────────────────────────────
 *
 * El resto de /api/dashboard no valida sesión: el middleware no cubre esa rama
 * y los handlers tampoco chequean. Esta ruta no sigue esa costumbre, y no es
 * purismo: crea y publica objetos en la cuenta de Meta del cliente usando su
 * access token. Un POST anónimo acá podría llenarle el WABA de templates o
 * publicar Flows a su nombre.
 *
 * Queda restringida a super_admin. Los agentes de soporte no tienen nada que
 * hacer acá.
 */

import { NextResponse } from "next/server"
import { requireAuthFromRequest } from "@/lib/auth"
import { getWhatsAppConfigById, updateWhatsAppConfig } from "@/lib/db"
import {
  listarFlows,
  crearFlow,
  subirFlowJson,
  publicarFlow,
  estadoDelFlow,
  crearTemplate,
  buscarTemplate,
} from "@/lib/flows/meta-flows-api"
import { construirFlowJson, VERSION_FLOW_JSON } from "@/lib/flows/flow-reagendar"
import {
  definicionDeTemplate,
  CUERPO_CON_REAGENDAR,
  EJEMPLOS_VIGENTES,
} from "@/lib/flows/recordatorio-con-botones"

export const runtime = "nodejs"

type Accion =
  | "listar_flows"
  | "crear_flow"
  | "subir_json"
  | "publicar_flow"
  | "estado_flow"
  | "crear_template"
  | "estado_template"

export async function POST(request: Request) {
  const { session, error } = await requireAuthFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: error || "No autenticado" }, { status: 401 })
  }
  if (session.role !== "super_admin") {
    return NextResponse.json({ error: "Se requiere rol de super admin" }, { status: 403 })
  }

  let cuerpo: any
  try {
    cuerpo = await request.json()
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 })
  }

  const { configId, accion } = cuerpo as { configId?: string; accion?: Accion }

  if (!configId || !accion) {
    return NextResponse.json({ error: "Faltan 'configId' y/o 'accion'" }, { status: 400 })
  }

  const config = await getWhatsAppConfigById(configId)
  if (!config) {
    return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
  }
  if (!config.wabaId || !config.accessToken) {
    return NextResponse.json(
      { error: "La configuración no tiene wabaId o accessToken cargados" },
      { status: 400 },
    )
  }

  const { wabaId, accessToken } = config

  try {
    switch (accion) {
      case "listar_flows":
        return NextResponse.json(await listarFlows(wabaId, accessToken))

      case "crear_flow": {
        const nombre = String(cuerpo.nombre || "").trim() || "reagendar_turno"
        const respuesta = await crearFlow(wabaId, accessToken, nombre)

        // Se guarda apenas Meta devuelve el id. Si el usuario cierra la pantalla
        // entre crear y publicar, el Flow ya existe y sin esto quedaría
        // huérfano: invisible para nosotros y ocupando lugar en el WABA.
        const flowId = respuesta.datos?.id
        if (respuesta.ok && flowId) {
          await updateWhatsAppConfig(configId, { flowIdReagendar: String(flowId) })
        }
        return NextResponse.json(respuesta)
      }

      case "subir_json": {
        const flowId = String(cuerpo.flowId || config.flowIdReagendar || "")
        if (!flowId) return NextResponse.json({ error: "No hay flowId" }, { status: 400 })

        const version = String(cuerpo.version || VERSION_FLOW_JSON)
        const respuesta = await subirFlowJson(flowId, accessToken, construirFlowJson(version))

        // Un 200 con validation_errors NO es un éxito: el Flow quedó subido
        // pero inválido. Se marca aparte para que la interfaz no lo pinte de
        // verde.
        const erroresDeValidacion = respuesta.datos?.validation_errors
        return NextResponse.json({
          ...respuesta,
          versionUsada: version,
          valido: respuesta.ok && (!erroresDeValidacion || erroresDeValidacion.length === 0),
        })
      }

      case "publicar_flow": {
        const flowId = String(cuerpo.flowId || config.flowIdReagendar || "")
        if (!flowId) return NextResponse.json({ error: "No hay flowId" }, { status: 400 })
        return NextResponse.json(await publicarFlow(flowId, accessToken))
      }

      case "estado_flow": {
        const flowId = String(cuerpo.flowId || config.flowIdReagendar || "")
        if (!flowId) return NextResponse.json({ error: "No hay flowId" }, { status: 400 })
        return NextResponse.json(await estadoDelFlow(flowId, accessToken))
      }

      case "crear_template": {
        const flowId = String(cuerpo.flowId || config.flowIdReagendar || "")
        if (!flowId) {
          return NextResponse.json(
            { error: "Primero hay que crear y publicar el Flow: el template necesita su id" },
            { status: 400 },
          )
        }

        const nombre = String(cuerpo.nombre || "").trim() || "confirmacion_1_turno_flows"
        const definicion = definicionDeTemplate({
          nombre,
          idioma: String(cuerpo.idioma || "es_AR"),
          // Se puede pisar desde la interfaz: cada clínica puede tener su
          // propio texto aprobado, y el template nuevo tiene que aceptar los
          // mismos parámetros en el mismo orden.
          cuerpo: String(cuerpo.cuerpo || CUERPO_CON_REAGENDAR),
          ejemplos: Array.isArray(cuerpo.ejemplos) && cuerpo.ejemplos.length > 0 ? cuerpo.ejemplos : EJEMPLOS_VIGENTES,
          flowId,
        })

        const respuesta = await crearTemplate(wabaId, accessToken, definicion)

        if (respuesta.ok && respuesta.datos?.id) {
          await updateWhatsAppConfig(configId, { templateRecordatorioFlows: nombre })
        }

        return NextResponse.json({
          ...respuesta,
          definicionEnviada: definicion,
          // El dato que fuimos a buscar: si Meta lo dejó en utility o lo
          // reclasificó al ver el botón de Flow.
          categoriaAsignada: respuesta.datos?.category ?? null,
        })
      }

      case "estado_template": {
        const nombre = String(cuerpo.nombre || config.templateRecordatorioFlows || "")
        if (!nombre) return NextResponse.json({ error: "No hay nombre de template" }, { status: 400 })
        return NextResponse.json(await buscarTemplate(wabaId, accessToken, nombre))
      }

      default:
        return NextResponse.json({ error: `Acción desconocida: ${accion}` }, { status: 400 })
    }
  } catch (e: any) {
    console.error("[DASHBOARD_FLOWS] Error:", e)
    return NextResponse.json({ error: e?.message || "Error inesperado" }, { status: 500 })
  }
}
