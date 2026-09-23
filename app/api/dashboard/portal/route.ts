/**
 * Emitir enlaces del portal sin pasar por WhatsApp (23/9/2026).
 *
 * Nace de una necesidad concreta: probar el portal completo mientras las
 * plantillas de WhatsApp todavía están en revisión de Meta. Pero sirve después
 * igual, porque el portal no depende de WhatsApp para nada — sólo necesita un
 * token válido en Redis.
 *
 * ── Restringida a super_admin ──────────────────────────────────────────────
 *
 * Un enlace del portal es la credencial para gestionar el turno de un paciente.
 * Emitir uno a pedido, para cualquier teléfono, es una capacidad que no puede
 * quedar abierta — ni siquiera a los agentes de soporte.
 */

import { NextResponse } from "next/server"
import { requireAuthFromRequest } from "@/lib/auth"
import { getWhatsAppConfigById } from "@/lib/db"
import { emitirEnlace } from "@/lib/portal/token"
import { buscarPacientePorDNI, obtenerTurnosPaciente } from "@/lib/api-tools/api-functions"
import { normalizePhoneNumber } from "@/lib/utils"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const { session, error } = await requireAuthFromRequest(request)
  if (!session) return NextResponse.json({ error: error || "No autenticado" }, { status: 401 })
  if (session.role !== "super_admin") {
    return NextResponse.json({ error: "Se requiere rol de super admin" }, { status: 403 })
  }

  let cuerpo: any
  try {
    cuerpo = await request.json()
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 })
  }

  const configId = String(cuerpo.configId || "")
  if (!configId) return NextResponse.json({ error: "Falta configId" }, { status: 400 })

  const config = await getWhatsAppConfigById(configId)
  if (!config) return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })

  const intencion = cuerpo.intencion === "nuevo_turno" ? "nuevo_turno" : "reagendar"
  const demo = cuerpo.demo !== false
  const dni = String(cuerpo.dni || "").replace(/\D/g, "")
  const telefono = normalizePhoneNumber(String(cuerpo.telefono || "5490000000000"))

  // ── Con DNI: se traen los datos reales del paciente ─────────────────────
  //
  // Es lo que hace que la prueba valga: el portal muestra la agenda que le
  // correspondería a ese paciente, con su obra social y su sede. Sin DNI se usa
  // un paciente inventado, que sirve para revisar la interfaz y poco más.
  let pacienteNombre: string | undefined
  let obraSocialId: string | undefined
  let sedeId: string | undefined
  let turno: any
  const diagnostico: string[] = []

  if (dni && config.cliente_id) {
    try {
      const encontrado = await buscarPacientePorDNI(dni, config.cliente_id)
      const p: any = encontrado?.datos
      if (p) {
        pacienteNombre = [p.Nombres || p.nombres, p.Apellido || p.apellido].filter(Boolean).join(" ").trim()
        obraSocialId = p.Obra_Social_Id || p.obra_social_id || undefined
        diagnostico.push(`Paciente encontrado: ${pacienteNombre || dni}`)
      } else {
        diagnostico.push(`No se encontró ningún paciente con el DNI ${dni}`)
      }

      if (intencion === "reagendar") {
        const turnos = await obtenerTurnosPaciente(config.cliente_id, undefined, dni)
        const lista: any[] = Array.isArray(turnos?.datos) ? turnos.datos : (turnos?.datos as any)?.turnos || []
        const primero = lista[0]
        if (primero) {
          turno = {
            agendaId: primero.Agenda_Id || primero.agenda_id,
            fecha: primero.Fecha || primero.fecha,
            fechaFormateada: primero.Fecha_Formateada || primero.fecha_formateada || primero.Fecha || primero.fecha,
            hora: primero.Hora || primero.hora,
            horaFormateada: primero.Hora || primero.hora,
            profesional: primero.Profesional || primero.profesional || primero.Profesional_Nombre,
            profesionalId: primero.Profesional_Id || primero.profesional_id,
            sede: primero.Sede || primero.sede || primero.Sede_Nombre,
            direccion: primero.Direccion || primero.direccion,
          }
          sedeId = primero.Sede_Id || primero.sede_id
          diagnostico.push(`Turno encontrado: ${turno.fechaFormateada} ${turno.horaFormateada}`)
        } else {
          diagnostico.push("Ese paciente no tiene turnos agendados; se usa uno de ejemplo")
        }
      }
    } catch (e: any) {
      diagnostico.push(`Error consultando al proxy: ${e?.message || e}`)
    }
  }

  // Un turno inventado, sólo para que la pantalla de reprogramación tenga algo
  // que mostrar arriba. Se marca como tal.
  if (intencion === "reagendar" && !turno) {
    const enUnaSemana = new Date(Date.now() + 7 * 86_400_000)
    const iso = enUnaSemana.toISOString().slice(0, 10)
    turno = {
      fecha: iso,
      fechaFormateada: iso.split("-").reverse().join("/"),
      hora: "08:00",
      horaFormateada: "08:00",
      profesional: "Profesional de ejemplo",
      sede: "Sede de ejemplo",
    }
  }

  const enlace = await emitirEnlace({
    configId,
    clienteId: config.cliente_id,
    phone: telefono,
    intencion,
    // "conversacion" da 30 minutos. Para probar alcanza y sobra, y evita dejar
    // enlaces de prueba vivos por dos días.
    origen: "conversacion",
    pacienteNombre: pacienteNombre || (demo ? "Paciente de Prueba" : undefined),
    pacienteDNI: dni || undefined,
    obraSocialId,
    sedeId,
    turno,
    demo,
  })

  if (!enlace) {
    return NextResponse.json({ error: "No se pudo emitir el enlace (¿Redis disponible?)" }, { status: 500 })
  }

  const urlAbsoluta = /^https?:\/\//i.test(enlace.url)

  return NextResponse.json({
    ok: true,
    url: enlace.url,
    token: enlace.token,
    demo,
    diagnostico,
    // Sin APP_URL la ruta queda relativa. Acá no molesta —se abre desde el
    // mismo dominio— pero en WhatsApp sería un botón roto, así que se avisa.
    ...(urlAbsoluta
      ? {}
      : {
          aviso:
            "Falta APP_URL en las variables de entorno. Acá el enlace funciona igual, pero el bot no va a poder mandarlo por WhatsApp.",
        }),
    vence: enlace.contexto.venceAccion,
  })
}
