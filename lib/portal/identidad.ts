/**
 * Quién es el paciente que abrió el portal (23/9/2026).
 *
 * ── Por qué el portal tiene que averiguarlo ────────────────────────────────
 *
 * Cuando el paciente escribe desde un número que la clínica ya tiene fichado,
 * el bot lo reconoce solo y el token llega con DNI, nombre y obra social: estos
 * pasos no se ven nunca. Cuando NO lo reconoce —paciente nuevo, o uno viejo
 * escribiendo desde otro teléfono— hasta ahora arrancaba una conversación de
 * nueve mensajes por WhatsApp. Eso es lo que se reemplaza acá.
 *
 * ── El DNI no dice "paciente nuevo" ────────────────────────────────────────
 *
 * Que el bot no lo haya reconocido por teléfono no significa que sea nuevo:
 * significa que ese teléfono no estaba en su ficha. Por eso el primer paso
 * después del DNI es BUSCAR, no dar de alta. Asumir que es nuevo crearía fichas
 * duplicadas para pacientes que ya existen, que es un desastre silencioso: la
 * clínica termina con dos historias clínicas de la misma persona.
 */

import { buscarPaciente, validarObraSocial } from "../api-tools/api-functions"
import { resolverTurnosOnline } from "../conversation-state/shared/obra-social"
import type { IdentidadDelPaciente } from "./pasos"

// ── Validaciones, puras ─────────────────────────────────────────────────────

/**
 * Un DNI argentino, normalizado a dígitos.
 *
 * Se aceptan 7 y 8 dígitos. El piso de 7 deja entrar documentos viejos, que los
 * pacientes mayores tienen — y los pacientes mayores son una parte grande de
 * quienes sacan turnos médicos. Un validador de 8 estrictos los dejaría afuera.
 *
 * Devuelve `null` cuando no es un DNI, para que el llamador no tenga que
 * distinguir entre "vacío" y "mal formado".
 */
export function normalizarDNI(valor: unknown): string | null {
  const digitos = String(valor ?? "").replace(/\D/g, "")
  if (digitos.length < 7 || digitos.length > 8) return null
  // Un DNI de ceros no existe y suele ser un placeholder mal copiado.
  if (/^0+$/.test(digitos)) return null
  return digitos
}

/**
 * Un email que se pueda usar.
 *
 * Deliberadamente laxo: algo@algo.algo. Los validadores estrictos de email
 * rechazan direcciones válidas raras y no atrapan las inválidas comunes, que
 * son los errores de tipeo — y esos no los detecta ninguna expresión regular.
 */
export function normalizarEmail(valor: unknown): string | null {
  const texto = String(valor ?? "").trim().toLowerCase()
  if (!texto || texto.length > 254) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(texto)) return null
  return texto
}

/** Nombre o apellido: se recorta y se limita, no se "corrige". */
export function normalizarNombre(valor: unknown): string | null {
  const texto = String(valor ?? "").trim().replace(/\s+/g, " ")
  if (texto.length < 2 || texto.length > 60) return null
  // Al menos una letra. Evita "123" o "--" sin ponerse a legislar sobre qué
  // caracteres puede tener el apellido de alguien.
  if (!/\p{L}/u.test(texto)) return null
  return texto
}

export interface ErroresDelAlta {
  dni?: string
  nombre?: string
  apellido?: string
  email?: string
}

export interface AltaValidada {
  dni: string
  nombre: string
  apellido: string
  email: string
}

/**
 * Valida el formulario de alta entero y devuelve TODOS los errores juntos.
 *
 * No corta en el primero: que el paciente corrija el apellido, mande, y recién
 * ahí se entere de que el email también estaba mal es la forma más rápida de
 * que abandone.
 */
export function validarAlta(datos: {
  dni?: unknown
  nombre?: unknown
  apellido?: unknown
  email?: unknown
}): { ok: true; datos: AltaValidada } | { ok: false; errores: ErroresDelAlta } {
  const dni = normalizarDNI(datos.dni)
  const nombre = normalizarNombre(datos.nombre)
  const apellido = normalizarNombre(datos.apellido)
  const email = normalizarEmail(datos.email)

  const errores: ErroresDelAlta = {}
  if (!dni) errores.dni = "Revisá el DNI: van sólo los números, sin puntos."
  if (!nombre) errores.nombre = "Escribí tu nombre."
  if (!apellido) errores.apellido = "Escribí tu apellido."
  if (!email) errores.email = "Revisá el email: parece que falta algo."

  if (Object.keys(errores).length > 0) return { ok: false, errores }

  return { ok: true, datos: { dni: dni!, nombre: nombre!, apellido: apellido!, email: email! } }
}

// ── Resolución contra el sistema de la clínica ──────────────────────────────

/**
 * Busca la ficha del paciente por DNI.
 *
 * Devuelve siempre una identidad con `fichaConsultada: true`, incluso cuando no
 * encontró nada: es lo que distingue "no tiene ficha" de "todavía no busqué", y
 * esa distinción es la que hace que `decidirPaso` sepa si mostrar el alta.
 *
 * Si la búsqueda FALLA (el proxy no contesta) se devuelve `null`. No es lo
 * mismo que no encontrar: dar de alta a alguien porque el proxy estaba caído
 * crearía una ficha duplicada. Ante la duda, no se escribe nada.
 */
export async function resolverPorDNI(
  clienteId: string,
  dni: string,
): Promise<IdentidadDelPaciente | null> {
  let respuesta: Awaited<ReturnType<typeof buscarPaciente>>
  try {
    // ── Sin caché, a propósito (24/9/2026) ────────────────────────────────
    //
    // `buscarPacientePorDNI` cachea la respuesta cinco minutos. Para el bot
    // está bien: consulta el mismo DNI varias veces dentro de una conversación.
    //
    // Acá no, porque esta respuesta decide si se CREA una ficha. El caso que
    // lo rompe: alguien se da de alta por el portal, reserva —y con eso su
    // ficha queda creada en el sistema de la clínica—, y vuelve a entrar a los
    // dos minutos. El "no encontrado" cacheado lo manda al alta otra vez, y la
    // clínica termina con dos historias clínicas de la misma persona.
    //
    // Es el mismo duplicado silencioso que se evita buscando antes de dar de
    // alta; buscar contra una respuesta vieja lo reintroduce por la ventana.
    respuesta = await buscarPaciente(clienteId, { dni }, false)
  } catch (error) {
    console.error("[PORTAL] Error buscando al paciente por DNI:", error)
    return null
  }

  if (respuesta.exito === false) {
    // ── "No lo encontré" NO es "no pude preguntar" (24/9/2026) ────────────
    //
    // Reportado: al ingresar un DNI que no está en el sistema, el portal
    // mostraba "No pudimos consultar tus datos en este momento. Probá de nuevo
    // en un minuto". O sea que el paciente nuevo —el caso principal de esta
    // pantalla— no podía pasar de acá.
    //
    // La causa: yo trataba cualquier `exito: false` como una falla de
    // consulta. Pero el proxy usa ese mismo campo para dos cosas distintas, y
    // el `codigo` las separa:
    //
    //   API_ERROR       → el proxy contestó y dijo que no hay paciente.
    //                     Eso es un HECHO: no tiene ficha, va al alta.
    //   HTTP_*, y el
    //   resto           → no llegamos a preguntar. Ahí sí conviene reintentar,
    //                     porque dar de alta a ciegas crearía un duplicado de
    //                     alguien que quizás ya existe.
    //
    // Es el mismo error de siempre, en su versión espejo: antes tomaba la
    // ausencia de información como un hecho; acá tomaba un hecho como ausencia
    // de información.
    const codigo = respuesta.error?.codigo

    if (codigo === "API_ERROR") {
      console.log(
        `[PORTAL] El proxy no encontró al paciente con ese DNI: ${respuesta.error?.mensaje || "(sin mensaje)"}`,
      )
      return { dni, fichaConsultada: true, tieneFicha: false }
    }

    console.error("[PORTAL] No se pudo consultar el DNI:", respuesta.error)
    return null
  }

  const p: any = respuesta.datos

  if (!p) {
    // El proxy contestó bien y no trajo paciente. También es un hecho.
    return { dni, fichaConsultada: true, tieneFicha: false }
  }

  const nombre = p.Nombres || p.nombres || p.Nombre || p.nombre || undefined
  const apellido = p.Apellido || p.apellido || undefined
  const obraSocialId = p.Obra_Social_Id || p.obra_social_id || p.Deudor_Id || p.deudor_id || undefined
  const obraSocialNombre = p.Obra_Social_Nombre || p.obra_social_nombre || p.Deudor_Nombre || undefined

  const identidad: IdentidadDelPaciente = {
    dni,
    fichaConsultada: true,
    tieneFicha: true,
    nombre: nombre ? String(nombre).trim() : undefined,
    apellido: apellido ? String(apellido).trim() : undefined,
    email: p.Mail || p.mail || p.Email || p.email || undefined,
    obraSocialId: obraSocialId ? String(obraSocialId) : undefined,
    obraSocialNombre: obraSocialNombre ? String(obraSocialNombre).trim() : undefined,
  }

  identidad.obraSocialBloqueada = await estaBloqueadaLaObraSocial(
    clienteId,
    obraSocialNombre,
    identidad.obraSocialId,
  )

  return identidad
}

export interface ObraSocialDelPortal {
  id: string
  nombre: string
  /** `false` = explícitamente no permite turnos online. */
  permiteOnline: boolean
}

/**
 * Busca obras sociales por texto, para el selector del alta.
 *
 * ── Por qué buscar y no listar ─────────────────────────────────────────────
 *
 * `get_obras_sociales` toma un término de búsqueda. Una clínica puede tener
 * cientos de convenios, así que un desplegable con todos sería inusable en un
 * teléfono, que es donde el paciente va a estar.
 *
 * Las que no permiten turnos online SE MUESTRAN igual, marcadas. Ocultarlas
 * dejaría al paciente buscando la suya sin encontrarla y sin entender por qué
 * — y terminaría eligiendo una parecida que no es la de él, que es peor que
 * derivarlo al teléfono.
 */
export async function buscarObrasSociales(
  clienteId: string,
  busqueda: string,
): Promise<ObraSocialDelPortal[]> {
  const termino = String(busqueda || "").trim()
  if (termino.length < 2) return []

  try {
    const respuesta = await validarObraSocial(clienteId, termino)
    const lista = respuesta?.datos?.obras_sociales
    if (!respuesta?.exito || !Array.isArray(lista)) return []

    return lista
      .filter((os) => os?.id && os?.nombre)
      .map((os) => ({
        id: String(os.id),
        nombre: String(os.nombre),
        // El mapeo de la API ya hace `?? true`: si el campo no viene, se asume
        // permitida. Es fail-open y está documentado en obra-social.ts; no se
        // invierte acá para no tener dos criterios distintos.
        permiteOnline: os.permite_turnos_online !== false,
      }))
      .slice(0, 25)
  } catch (error) {
    console.error("[PORTAL] Error buscando obras sociales:", error)
    return []
  }
}

/**
 * ¿La obra social del paciente permite sacar turnos online?
 *
 * Se delega en `resolverTurnosOnline`, que ya existe y está escrito a partir de
 * un caso real (Zelmira, Salud Ocular, PAMI HAEDO). Reimplementar el chequeo
 * acá sería tener dos respuestas para la misma pregunta, y la de este archivo
 * —recién escrita, sin ese caso en la cabeza— sería la peor de las dos.
 *
 * `undefined` cuando no se pudo determinar, y eso NO bloquea. El módulo
 * original explica por qué: si la API dejara de mandar el campo, invertir el
 * default frenaría a todos los pacientes, que es un daño mucho mayor que el
 * que se quiere evitar.
 */
export async function estaBloqueadaLaObraSocial(
  clienteId: string,
  obraSocialNombre?: string,
  obraSocialId?: string,
): Promise<boolean | undefined> {
  // `resolverTurnosOnline` busca por NOMBRE y usa el id sólo para desambiguar
  // entre los resultados. Sin nombre devuelve 'indeterminado' sin consultar
  // nada, así que llamarlo sería un viaje al proxy para nada.
  if (!obraSocialNombre || !obraSocialNombre.trim()) return undefined

  try {
    const resultado = await resolverTurnosOnline(clienteId, obraSocialNombre, obraSocialId)
    if (resultado.estado === "bloqueada") return true
    if (resultado.estado === "permitida") return false
    return undefined
  } catch (error) {
    console.error("[PORTAL] Error resolviendo la obra social:", error)
    return undefined
  }
}
