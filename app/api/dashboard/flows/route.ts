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
  diagnosticoDeLaCuenta,
  numerosDelWaba,
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
  | "diagnostico_cuenta"

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

      case "diagnostico_cuenta": {
        const { waba, numero } = await diagnosticoDeLaCuenta(wabaId, config.phoneNumberId, accessToken)
        const numerosDelWabaResp = await numerosDelWaba(wabaId, accessToken)

        // ── Lo que NO se pudo leer se dice, no se asume ────────────────────
        //
        // La primera versión listaba los bloqueos encontrados y, si la lista
        // quedaba vacía, la interfaz decía "ningún requisito bloqueado". Pero
        // la consulta al WABA puede fallar entera —pasa cuando el negocio dueño
        // de la app no es Business Solution Provider— y entonces la lista queda
        // vacía porque no se miró nada, no porque esté todo bien.
        //
        // Es el mismo error que venimos corrigiendo en el bot: la ausencia de
        // un dato tratada como un dato positivo. Acá lo caro es que manda a
        // reclamarle al soporte de Meta por algo que probablemente sea un
        // trámite pendiente.
        const verificacion = waba.datos?.business_verification_status
        const revision = waba.datos?.account_review_status
        const calidad = numero.datos?.quality_rating
        const tier = waba.datos?.messaging_limit_tier ?? numero.datos?.messaging_limit_tier
        const verificacionDelCodigo = numero.datos?.code_verification_status

        const bloqueos: string[] = []
        const sinDatos: string[] = []

        if (!waba.ok) {
          sinDatos.push(
            "No se pudo leer el estado del WABA: " +
              (waba.datos?.error?.message || `HTTP ${waba.status}`) +
              ". La verificación del negocio y la revisión de la cuenta hay que mirarlas a mano en el Business Manager.",
          )
        } else {
          if (!verificacion) sinDatos.push("Meta no devolvió business_verification_status.")
          else if (verificacion !== "verified") {
            bloqueos.push(
              `El negocio no está verificado (${verificacion}). Los Flows exigen verificación de negocio.`,
            )
          }
          if (!revision) sinDatos.push("Meta no devolvió account_review_status.")
          else if (revision !== "APPROVED") {
            bloqueos.push(`La cuenta de WhatsApp está en estado ${revision}, no APPROVED.`)
          }
        }

        if (!calidad) sinDatos.push("Meta no devolvió la calidad del número.")
        else if (calidad !== "GREEN" && calidad !== "UNKNOWN") {
          bloqueos.push(`La calidad del número está en ${calidad}, y los Flows piden buena calidad.`)
        }

        if (verificacionDelCodigo && verificacionDelCodigo !== "VERIFIED") {
          bloqueos.push(
            `El número tiene code_verification_status: ${verificacionDelCodigo}. Conviene re-verificarlo antes de seguir.`,
          )
        }

        // TIER_250 es el escalón más bajo. No es un bloqueo por sí mismo, pero
        // es la marca de un número que todavía no pasó por verificación de
        // negocio — que es justamente el requisito de Flows.
        if (tier === "TIER_250") {
          sinDatos.push(
            "El número está en TIER_250, el escalón más bajo. Suele indicar que el negocio todavía no está verificado.",
          )
        }

        // La coherencia entre WABA y número: si no coinciden, los Flows nunca
        // van a poder enviarse aunque todo lo demás esté impecable.
        if (numerosDelWabaResp.ok && Array.isArray(numerosDelWabaResp.datos?.data)) {
          const lista = numerosDelWabaResp.datos.data
          const pertenece = lista.some((n: any) => String(n?.id) === String(config.phoneNumberId))
          if (!pertenece) {
            bloqueos.push(
              `El Phone Number ID de la configuración (${config.phoneNumberId}) no está entre los números de este WABA. ` +
                "Los Flows se envían desde un número del mismo WABA donde viven, así que con esta combinación nunca va a funcionar.",
            )
          }
        } else {
          sinDatos.push("No se pudo listar los números del WABA para verificar que el que envía le pertenezca.")
        }

        return NextResponse.json({
          ok: waba.ok && numero.ok,
          status: 200,
          bloqueos,
          sinDatos,
          // Sólo se afirma que está todo bien cuando de verdad se pudo mirar todo.
          concluyente: waba.ok && numero.ok && sinDatos.length === 0,
          resumen: {
            verificacionDelNegocio: verificacion ?? "no se pudo leer",
            revisionDeLaCuenta: revision ?? "no se pudo leer",
            calidadDelNumero: calidad ?? "no se pudo leer",
            verificacionDelCodigo: verificacionDelCodigo ?? "no se pudo leer",
            limiteDeMensajeria: tier ?? "no se pudo leer",
            wabaDeLaConfig: wabaId,
            numeroDeLaConfig: config.phoneNumberId,
          },
          datos: { waba: waba.datos, numero: numero.datos, numerosDelWaba: numerosDelWabaResp.datos },
        })
      }

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

        // ── Chequeo previo (22/9/2026) ────────────────────────────────────
        //
        // Meta rechaza el envío con un "Parameter flow_id is invalid" que sirve
        // para tres situaciones muy distintas: el Flow no existe, no tiene
        // pantallas, o está en borrador y el destinatario no es tester. Cada
        // una se arregla de una manera diferente y el error no distingue.
        //
        // Dos consultas de lectura antes de mandar convierten eso en una frase
        // accionable. Cuestan menos que un intento a ciegas.
        const estado = await estadoDelFlow(flowId, accessToken)
        if (!estado.ok) {
          return NextResponse.json(
            {
              ok: false,
              status: 400,
              error: "Ese Flow no existe o no pertenece al WABA de este cliente.",
              flowIdConsultado: flowId,
              datos: estado.datos,
            },
            { status: 400 },
          )
        }

        const assets = await assetsDelFlow(flowId, accessToken)
        const tieneJson = Array.isArray(assets.datos?.data)
          ? assets.datos.data.some((a: any) => a?.asset_type === "FLOW_JSON")
          : false

        if (!tieneJson) {
          return NextResponse.json(
            {
              ok: false,
              status: 400,
              error: "Este Flow todavía no tiene pantallas cargadas. Falta el paso 3.",
              flowIdConsultado: flowId,
            },
            { status: 400 },
          )
        }

        // ¿El número desde el que mandamos pertenece al WABA donde vive el Flow?
        //
        // Un Flow es un objeto del WABA. Si la configuración mezcla el wabaId de
        // una cuenta con el phoneNumberId de otra, todo lo anterior funciona
        // —listar, subir, publicar— y sólo falla el envío, con un error que
        // habla del flow_id y manda a revisar el Flow, que está impecable.
        const numeros = await numerosDelWaba(wabaId, accessToken)
        if (numeros.ok && Array.isArray(numeros.datos?.data)) {
          const pertenece = numeros.datos.data.some((n: any) => String(n?.id) === String(config.phoneNumberId))
          if (!pertenece) {
            return NextResponse.json(
              {
                ok: false,
                status: 400,
                error:
                  `El número que envía (${config.phoneNumberId}) NO pertenece al WABA ${wabaId}, ` +
                  "que es donde está el Flow. Por eso Meta dice que el flow_id no es válido: para ese número, ese Flow no existe.",
                sugerencia:
                  "Revisá el WABA ID y el Phone Number ID en la configuración de este cliente: tienen que ser de la misma cuenta.",
                numerosDelWaba: numeros.datos.data,
                phoneNumberIdDeLaConfig: config.phoneNumberId,
              },
              { status: 400 },
            )
          }
        }

        const estadoDelFlowActual = String(estado.datos?.status || "").toUpperCase()

        // El modo tiene que coincidir con el estado del Flow, o Meta devuelve
        // "Invalid Flow Mode". Se deduce solo y el llamador puede forzarlo.
        const modo: "draft" | "published" =
          cuerpo.modo === "draft" || cuerpo.modo === "published"
            ? cuerpo.modo
            : estadoDelFlowActual === "PUBLISHED"
              ? "published"
              : "draft"

        if (modo === "draft") {
          // No se frena el envío —puede que el número SÍ sea tester— pero queda
          // dicho de antemano para que el error, si llega, ya tenga explicación.
          console.log(
            `[FLOWS] Envío en modo draft a ${cuerpo.telefono}: sólo funciona si ese número está registrado como tester en la app de Meta.`,
          )
        }

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
          // El texto por defecto dice que es una prueba, y no es cosmético.
          // Esto se manda a un número escrito a mano, en el WABA de una clínica
          // real. Un dígito de más y el mensaje le llega a un paciente: que ese
          // mensaje diga "elegí un nuevo horario para tu turno" lo haría creer
          // que su turno se movió. Que diga que es una prueba no le hace nada.
          cuerpo: String(
            cuerpo.cuerpo ||
              "*Prueba del sistema.* Estamos probando el reagendamiento por WhatsApp. " +
                "Este mensaje no corresponde a ningún turno real; podés ignorarlo.",
          ),
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

          // El chequeo previo ya descartó que el Flow no exista o no tenga
          // pantallas. Si igual falla el flow_id estando en borrador, la causa
          // que queda es la del destinatario.
          const pistas: string[] = []
          if (modo === "draft" && /flow_id/i.test(detalle || e?.message || "")) {
            pistas.push(
              "El Flow está en borrador y en ese modo WhatsApp sólo se lo muestra a números registrados como tester en la app de Meta. " +
                "O agregás ese teléfono como tester, o publicás el Flow (paso 4) y lo mandás en modo published.",
            )
          }
          if (/131047|24 hour|re-?engagement/i.test(e?.message || "")) {
            pistas.push("La ventana de 24 h está cerrada: ese número tiene que escribirle al bot primero.")
          }

          return NextResponse.json(
            {
              ok: false,
              status: 502,
              error: e?.message || "No se pudo enviar",
              ...(detalle ? { loQueDiceMeta: detalle } : {}),
              ...(pistas.length ? { pistas } : {}),
              estadoDelFlow: estadoDelFlowActual,
              modoUsado: modo,
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
