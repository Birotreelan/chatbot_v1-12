/**
 * Los datos del paciente que muestran los paneles (27/10/2026).
 *
 * Lo usan las dos pantallas que consultan la ficha a mano: el Monitor de
 * Conversaciones (/api/dashboard/patient) y el panel de atención
 * (/api/support/patient).
 *
 * ── Por qué un módulo y no dos rutas ───────────────────────────────────────
 *
 * Las dos hacían exactamente lo mismo: normalizar el teléfono, preguntarle al
 * proxy, y mapear la respuesta campo por campo —treinta líneas idénticas,
 * `Nrodoc || dni || documento` incluido—. Lo único distinto era de dónde sacan
 * el cliente y dónde guardan el snapshot.
 *
 * Y se notó: el 15/9 se arregló en la ruta de soporte que la URL del proxy
 * estuviera escrita a mano, y la del dashboard se quedó con el literal
 * `https://proxy.santiagovulliez.com/proxy_service/` hasta hoy. O sea que el
 * Monitor le preguntaba por TODOS los pacientes a un solo proxy, el de una
 * clínica: para las demás mostraba "paciente no encontrado" sin explicar nada.
 * Un arreglo que se aplica en una copia y no en la otra es el costo real de
 * tener dos.
 *
 * ── Una sola acción: get_paciente ──────────────────────────────────────────
 *
 * Antes la ruta de soporte pedía primero `get_paciente_interfaz` —una variante
 * que iba a traer los enlaces al sistema de la clínica— y, si no venía nada,
 * reintentaba con `get_paciente`.
 *
 * Esa acción nunca existió del lado del backend de las clínicas: era nuestra.
 * Así que cada consulta de un agente eran dos pedidos, el primero condenado a
 * fallar, y del otro lado quedaban registrados como intentos de usar una acción
 * desconocida. Se sacó el 27/10/2026 a pedido de Nicolás, que es quien ve esos
 * logs.
 *
 * `url_paciente` y `url_agenda` se siguen leyendo de la respuesta: si algún día
 * el backend los agrega a `get_paciente`, los botones del panel aparecen solos.
 * Mientras no vengan, el panel ya los oculta.
 */

import { resolveProxyUrl } from "./proxy-url-resolver"

export interface PacienteDelPanel {
  id?: string
  nombre?: string
  apellido?: string
  nombre_completo?: string
  dni?: string
  telefono?: string
  email?: string
  fecha_nacimiento?: string
  obra_social?: string
  plan?: string
  nro_afiliado?: string
  hc?: string | null
  /** Enlace a la ficha en el sistema de la clínica, si el backend lo manda. */
  url_paciente?: string | null
}

export interface TurnoDelPanel {
  id?: string
  fecha?: string
  hora?: string
  profesional?: string
  sede?: string
  motivo?: string
  estado?: string
  url_agenda?: string | null
}

export type ResultadoDeLaConsulta =
  /** El proxy contestó y hay ficha. */
  | { estado: "encontrado"; paciente: PacienteDelPanel; turnos: TurnoDelPanel[]; esPrimeraVez: boolean | null }
  /** El proxy contestó bien, pero ese teléfono no tiene ficha. */
  | { estado: "sin-ficha" }
  /** No pudimos preguntar o no entendimos la respuesta. Distinto de "no tiene ficha". */
  | { estado: "sin-datos"; motivo: string }

/**
 * El teléfono como lo espera el sistema de la clínica.
 *
 * WhatsApp manda "5493413121395"; las fichas tienen "3413121395". Se saca el
 * 54 y el 9 de más. No usa `normalizePhoneNumber` (lib/utils) a propósito: esa
 * es la forma con la que guardamos nosotros las conversaciones, y acá lo que
 * importa es la forma que entiende la clínica.
 */
export function telefonoParaLaClinica(phoneNumber: string): string {
  let t = (phoneNumber || "").replace(/\D/g, "")
  if (t.startsWith("549")) t = t.substring(3)
  else if (t.startsWith("54")) t = t.substring(2)
  return t
}

/** ¿La respuesta trae algo que se parezca a una ficha? */
function tieneDatosDePaciente(p: any): boolean {
  return Boolean(
    p &&
      (p.nombre ||
        p.Nombres ||
        p.nombre_completo ||
        p.Nombre_Completo ||
        p.dni ||
        p.Nrodoc ||
        p.documento ||
        p.id ||
        p.Id),
  )
}

export async function consultarPacienteDelPanel(params: {
  clienteId: string
  /** El teléfono tal como lo tenemos; acá se normaliza. */
  phoneNumber: string
  /** Para los logs: "DASHBOARD_PATIENT" o "SUPPORT_PATIENT". */
  origen: string
}): Promise<ResultadoDeLaConsulta> {
  const { clienteId, phoneNumber, origen } = params
  const telefono = telefonoParaLaClinica(phoneNumber)

  let proxyUrl: string
  try {
    // El proxy de ESTA clínica. Cada una tiene el suyo.
    proxyUrl = await resolveProxyUrl(clienteId)
  } catch (error) {
    console.error(`[${origen}] No se pudo resolver el proxy de ${clienteId}:`, error)
    return { estado: "sin-datos", motivo: "No está configurado el sistema de la clínica." }
  }

  console.log(`[${origen}] Buscando paciente ${telefono} (original: ${phoneNumber}) en ${proxyUrl}`)

  let crudo: string
  try {
    const respuesta = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Cliente_Id: clienteId, Action: "get_paciente", telefono }),
    })

    if (!respuesta.ok) {
      console.error(`[${origen}] get_paciente → HTTP ${respuesta.status} en ${proxyUrl}`)
      return {
        estado: "sin-datos",
        motivo: `El sistema de la clínica respondió con un error (${respuesta.status}).`,
      }
    }

    // Se lee como texto y se parsea con red: el proxy puede responder 200 con
    // el cuerpo vacío, y `.json()` ahí explota con "Unexpected end of JSON
    // input" — el error que veía el agente antes del 15/9.
    crudo = await respuesta.text()
  } catch (error) {
    console.error(`[${origen}] No se pudo consultar el proxy:`, error)
    return { estado: "sin-datos", motivo: "No pudimos consultar el sistema de la clínica." }
  }

  if (!crudo || !crudo.trim()) {
    console.error(`[${origen}] get_paciente → 200 con cuerpo vacío en ${proxyUrl}`)
    return { estado: "sin-datos", motivo: "El sistema de la clínica no devolvió datos." }
  }

  let respuesta: any
  try {
    respuesta = JSON.parse(crudo)
  } catch {
    console.error(`[${origen}] get_paciente → respuesta no es JSON:`, crudo.substring(0, 200))
    return {
      estado: "sin-datos",
      motivo: "El sistema de la clínica devolvió una respuesta que no pudimos interpretar.",
    }
  }

  // La forma de la respuesta varía entre proxies: unos envuelven en `paciente`,
  // otros en `datos`, otros devuelven la ficha pelada.
  const pacienteRaw = respuesta.paciente || respuesta.datos || respuesta.data || respuesta
  const turnosProximos = respuesta.turnos_proximos || respuesta.turnosProximos || respuesta.turnos || []
  const esPrimeraVez = respuesta.es_primera_vez ?? respuesta.esPrimeraVez ?? null

  if (!tieneDatosDePaciente(pacienteRaw)) {
    console.log(`[${origen}] Sin ficha para el teléfono ${telefono}`)
    return { estado: "sin-ficha" }
  }

  const paciente: PacienteDelPanel = {
    id: pacienteRaw.Id || pacienteRaw.id,
    nombre: pacienteRaw.Nombres || pacienteRaw.nombre,
    apellido: pacienteRaw.Apellido || pacienteRaw.apellido,
    nombre_completo:
      pacienteRaw.Nombre_Completo ||
      pacienteRaw.nombre_completo ||
      `${pacienteRaw.Nombres || pacienteRaw.nombre || ""} ${pacienteRaw.Apellido || pacienteRaw.apellido || ""}`.trim(),
    dni: pacienteRaw.Nrodoc || pacienteRaw.dni || pacienteRaw.documento,
    telefono: pacienteRaw.Celular || pacienteRaw.celular || pacienteRaw.telefono || phoneNumber,
    email: pacienteRaw.Mail || pacienteRaw.mail || pacienteRaw.email,
    fecha_nacimiento: pacienteRaw.Fecha_Nac || pacienteRaw.fecha_nacimiento,
    obra_social: pacienteRaw.Deudor_Nombre || pacienteRaw.obra_social,
    plan: pacienteRaw.Plan_Nombre || pacienteRaw.plan,
    nro_afiliado: pacienteRaw.Nro_Afiliado_Ppal || pacienteRaw.nro_afiliado,
    hc: pacienteRaw.HC || pacienteRaw.hc || null,
    url_paciente: pacienteRaw.url_paciente || null,
  }

  const turnos: TurnoDelPanel[] = (Array.isArray(turnosProximos) ? turnosProximos : []).map((turno: any) => ({
    id: turno.Id || turno.id,
    fecha: turno.Fecha || turno.fecha,
    hora: (turno.Hora || turno.hora || "").substring(0, 5), // "09:00:00" → "09:00"
    profesional: turno.Profesional_Nombre || turno.profesional || turno.profesional_nombre,
    sede: turno.Centro_Nombre || turno.sede || turno.centro_nombre,
    motivo: turno.Motivo_Nombre || turno.motivo || turno.motivo_nombre,
    estado: turno.Estado || turno.estado,
    url_agenda: turno.url_agenda || null,
  }))

  return { estado: "encontrado", paciente, turnos, esPrimeraVez }
}

/** Lo que se guarda para poder filtrar contactos en el panel. */
export function snapshotDelPaciente(paciente: PacienteDelPanel) {
  const limpio = (v: unknown) => (v ? String(v).trim() : undefined)
  return {
    hc: limpio(paciente.hc),
    nrodoc: limpio(paciente.dni),
    celular: limpio(paciente.telefono),
    apellido: limpio(paciente.apellido),
    nombre: limpio(paciente.nombre),
  }
}
