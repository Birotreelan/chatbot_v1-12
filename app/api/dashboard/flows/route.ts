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
  assetsDelFlow,
  descargarFlowJson,
  borrarFlow,
} from "@/lib/flows/meta-flows-api"
import { construirFlowJson, construirDatosDeLaPantalla, VERSION_FLOW_JSON } from "@/lib/flows/flow-reagendar"
import { construirMensajeFlow, enviarMensajeFlow } from "@/lib/flows/mensaje-flow"
import {
  definicionDeTemplate,
  CUERPO_CON_REAGENDAR,
  ENCABEZADO_CON_REAGENDAR,
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
  | "enviar_prueba"
  | "ver_json"
  | "fijar_flow"
  | "borrar_flow"

/**
 * El `error_data.details` que Meta mete adentro del mensaje de error.
 *
 * Suele ser la frase más útil de toda la respuesta —"Specified screen X is not
 * allowed as first screen of this flow"— y queda sepultada en un JSON escapado
 * dentro de un string. Sacarla afuera es la diferencia entre un diagnóstico y
 * una adivinanza.
 */
function detalleDelErrorDeMeta(mensaje?: string): string | null {
  if (!mensaje) return null
  const inicio = mensaje.indexOf("{")
  if (inicio === -1) return null
  try {
    const parseado = JSON.parse(mensaje.slice(inicio))
    return parseado?.error?.error_data?.details || parseado?.error?.message || null
  } catch {
    return null
  }
}

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

      case "fijar_flow": {
        // Apuntar la configuración a un Flow que ya existe, sin crear otro.
        // Hizo falta cuando quedaron tres Flows dando vueltas y el id guardado
        // no era ninguno de los buenos.
        const flowId = String(cuerpo.flowId || "").trim()
        if (!flowId) return NextResponse.json({ error: "Falta el flowId a fijar" }, { status: 400 })

        const estado = await estadoDelFlow(flowId, accessToken)
        if (!estado.ok) {
          return NextResponse.json(
            { ...estado, error: "Ese Flow no existe o no es de este WABA. No se guardó nada." },
            { status: 400 },
          )
        }

        await updateWhatsAppConfig(configId, { flowIdReagendar: flowId })
        return NextResponse.json({ ...estado, flowIdConsultado: flowId, guardado: true })
      }

      case "borrar_flow": {
        const flowId = String(cuerpo.flowId || "").trim()
        if (!flowId) return NextResponse.json({ error: "Falta el flowId a borrar" }, { status: 400 })

        const respuesta = await borrarFlow(flowId, accessToken)

        // Si borramos justo el que estaba guardado, se limpia la referencia:
        // dejarla apuntando a algo que ya no existe es cómo se llega al error
        // que nos costó media hora.
        if (respuesta.ok && config.flowIdReagendar === flowId) {
          await updateWhatsAppConfig(configId, { flowIdReagendar: "" })
        }

        return NextResponse.json({ ...respuesta, flowIdConsultado: flowId })
      }

      case "crear_flow": {
        // Crear pisa el id guardado. Si ya hay uno, se frena: ejecutar este
        // paso dos veces fue exactamente lo que dejó la configuración apuntando
        // a un Flow que no era ninguno de los que existían.
        if (config.flowIdReagendar && !cuerpo.forzar) {
          return NextResponse.json(
            {
              error: `Esta configuración ya tiene el Flow ${config.flowIdReagendar}. Crear otro pisaría esa referencia.`,
              sugerencia:
                "Si querés usar uno que ya existe, cargá su id en el campo Flow ID y usá 'Fijar este Flow'. Si de verdad querés crear otro, volvé a ejecutar con forzar.",
              flowIdActual: config.flowIdReagendar,
            },
            { status: 409 },
          )
        }

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
        return NextResponse.json({ ...(await estadoDelFlow(flowId, accessToken)), flowIdConsultado: flowId })
      }

      case "ver_json": {
        // Qué pantallas tiene REALMENTE este Flow. Es la pregunta que no se
        // podía contestar cuando Meta rechazó un envío diciendo que
        // "ELEGIR_TURNO no está permitida como primera pantalla".
        const flowId = String(cuerpo.flowId || config.flowIdReagendar || "")
        if (!flowId) return NextResponse.json({ error: "No hay flowId" }, { status: 400 })

        const assets = await assetsDelFlow(flowId, accessToken)
        const url = assets.datos?.data?.find((a: any) => a?.asset_type === "FLOW_JSON")?.download_url

        if (!url) {
          return NextResponse.json({
            ...assets,
            flowIdConsultado: flowId,
            diagnostico: "Este Flow no tiene ningún FLOW_JSON cargado. Falta el paso 3.",
          })
        }

        const json = await descargarFlowJson(url)
        const pantallas = Array.isArray(json.datos?.screens)
          ? json.datos.screens.map((s: any) => s?.id)
          : []

        return NextResponse.json({
          ok: json.ok,
          status: json.status,
          flowIdConsultado: flowId,
          // Lo primero que hay que mirar: si acá dice WELCOME_SCREEN, el Flow
          // sigue con la plantilla por defecto de Meta y nuestro JSON se subió
          // a otro lado.
          pantallas,
          datos: json.datos,
        })
      }

      case "crear_template": {
        // Ya no necesita el flowId: la plantilla aprobada tiene tres quick
        // reply y ningún botón de Flow. El Flow se manda después, como mensaje
        // aparte, sólo a quien toca "Reprogramar turno".
        const nombre = String(cuerpo.nombre || "").trim() || "confirmacion_1_flows"
        const definicion = definicionDeTemplate({
          nombre,
          idioma: String(cuerpo.idioma || "es_AR"),
          // Se puede pisar desde la interfaz: cada clínica puede tener su
          // propio texto aprobado, y el template nuevo tiene que aceptar los
          // mismos parámetros en el mismo orden.
          cuerpo: String(cuerpo.cuerpo || CUERPO_CON_REAGENDAR),
          ejemplos: Array.isArray(cuerpo.ejemplos) && cuerpo.ejemplos.length > 0 ? cuerpo.ejemplos : EJEMPLOS_VIGENTES,
          encabezado: String(cuerpo.encabezado ?? ENCABEZADO_CON_REAGENDAR) || undefined,
        })

        const respuesta = await crearTemplate(wabaId, accessToken, definicion)

        if (respuesta.ok && respuesta.datos?.id) {
          await updateWhatsAppConfig(configId, { templateRecordatorioFlows: nombre })
        }

        return NextResponse.json({
          ...respuesta,
          definicionEnviada: definicion,
          categoriaAsignada: respuesta.datos?.category ?? null,
        })
      }

      case "estado_template": {
        const nombre = String(cuerpo.nombre || config.templateRecordatorioFlows || "")
        if (!nombre) return NextResponse.json({ error: "No hay nombre de template" }, { status: 400 })
        return NextResponse.json(await buscarTemplate(wabaId, accessToken, nombre))
      }

      case "enviar_prueba": {
        const flowId = String(cuerpo.flowId || config.flowIdReagendar || "")
        if (!flowId) return NextResponse.json({ error: "No hay flowId" }, { status: 400 })

        const destino = String(cuerpo.telefono || "").replace(/\D/g, "")
        if (destino.length < 8) {
          return NextResponse.json(
            { error: "Hace falta un número de teléfono válido para la prueba" },
            { status: 400 },
          )
        }

        // `draft` permite probar el Flow antes de publicarlo. En un Flow ya
        // publicado también funciona, y manda la última versión subida.
        const modo = cuerpo.modo === "published" ? "published" : "draft"

        // Turnos de ejemplo: la prueba es del Flow, no de la agenda. Cuando esto
        // corra de verdad, los arma el webhook con la disponibilidad real.
        const enDias = (dias: number) => {
          const d = new Date(Date.now() + dias * 86_400_000)
          return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`
        }
        const datos = construirDatosDeLaPantalla({
          turnoActual: String(cuerpo.turnoActual || "jueves 25/09 a las 08:25"),
          turnosDisponibles: [
            { id: `prueba|1`, title: `${enDias(3)} · 08:25`, description: "Turno de prueba" },
            { id: `prueba|2`, title: `${enDias(5)} · 10:00`, description: "Turno de prueba" },
            { id: `prueba|3`, title: `${enDias(7)} · 15:30`, description: "Turno de prueba" },
          ],
        })

        const mensaje = construirMensajeFlow({
          to: destino,
          flowId,
          // `prueba_` al principio para que el webhook lo reconozca y NO intente
          // reservar nada cuando vuelva el nfm_reply.
          flowToken: `prueba_${Date.now()}`,
          cuerpo: String(cuerpo.cuerpo || "Elegí un nuevo horario para tu turno."),
          datosDeLaPantalla: datos,
          modo,
        })

        try {
          const datosDeMeta = await enviarMensajeFlow(config.phoneNumberId, accessToken, mensaje)
          return NextResponse.json({ ok: true, status: 200, datos: datosDeMeta, mensajeEnviado: mensaje })
        } catch (e: any) {
          // 22/9/2026: acá había dos pistas fijas —la ventana de 24 h y las
          // pantallas sin subir— que se mostraban siempre. En la primera prueba
          // real Meta había dicho con total claridad que el problema era otro
          // ("Specified screen X is not allowed as first screen"), y las pistas
          // mandaron a mirar donde no era.
          //
          // Ahora lo que dice Meta va PRIMERO y las pistas genéricas sólo
          // aparecen si no dijo nada específico. Un consejo que contradice al
          // error es peor que ningún consejo.
          const detalle = detalleDelErrorDeMeta(e?.message)
          return NextResponse.json(
            {
              ok: false,
              status: 502,
              error: e?.message || "No se pudo enviar",
              ...(detalle ? { loQueDiceMeta: detalle } : {}),
              ...(detalle
                ? {}
                : {
                    pistas: [
                      "La ventana de 24 h tiene que estar abierta: ese número debe haberle escrito al bot hace menos de un día.",
                      "Con mode=draft el Flow no necesita estar publicado, pero sí tener las pantallas subidas (paso 3).",
                    ],
                  }),
              mensajeEnviado: mensaje,
            },
            { status: 502 },
          )
        }
      }

      default:
        return NextResponse.json({ error: `Acción desconocida: ${accion}` }, { status: 400 })
    }
  } catch (e: any) {
    console.error("[DASHBOARD_FLOWS] Error:", e)
    return NextResponse.json({ error: e?.message || "Error inesperado" }, { status: 500 })
  }
}
