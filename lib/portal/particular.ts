/**
 * El deudor "Particular" de cada clínica (27/10/2026).
 *
 * ── Para qué ───────────────────────────────────────────────────────────────
 *
 * Un profesional puede tener agenda y no atender la obra social del paciente.
 * Hasta hoy el portal mostraba eso como "Sin turnos disponibles por ahora",
 * igual que un profesional que no tiene agenda ninguna: dos situaciones
 * distintas con la misma respuesta, y en una de las dos el paciente sí podía
 * atenderse —pagando la consulta—.
 *
 * Para ofrecerle esa alternativa hace falta saber con qué `Deudor_Id` se
 * reserva un turno particular en ESA clínica. Eso es lo que resuelve este
 * módulo.
 *
 * ── Coincidencia exacta, y si no hay, no se hace nada ──────────────────────
 *
 * El catálogo se consulta con `get_obras_sociales`, que es una búsqueda por
 * texto. Tomar el primer resultado es exactamente el error que está
 * documentado en lib/conversation-state/shared/obra-social.ts: con "PAMI" se
 * terminaba evaluando "PAMI HAEDO" y una paciente recorrió todo el flujo para
 * nada. Acá el riesgo sería peor —reservar un turno con el deudor equivocado,
 * que del lado de la clínica es un turno mal facturado—, así que se exige que
 * el nombre sea exactamente "PARTICULAR".
 *
 * Si ninguna obra social se llama así, la función devuelve `null` y la
 * alternativa particular no se ofrece: esa clínica sigue viendo exactamente lo
 * que veía antes. Nunca se reserva con un id adivinado.
 *
 * ── Quién decide, en realidad ──────────────────────────────────────────────
 *
 * Nosotros no habilitamos nada. Que un profesional tenga o no horarios
 * disponibles bajo Particular lo define la clínica en su propia agenda: si no
 * los abrió, la consulta vuelve vacía y el profesional se sigue mostrando sin
 * turnos. Lo único que agregamos es dejar de esconder los que sí están.
 */

import { getRedisClient } from "../redis"
import { validarObraSocial } from "../api-tools/api-functions"
import { diagnosticoActual, muestra } from "./diagnostico"

export interface DeudorParticular {
  id: string
  nombre: string
}

const CLAVE = "portal:deudor_particular:"
/** Un día. El catálogo de convenios no cambia seguido. */
const TTL = 24 * 60 * 60

/** Lo que tiene que decir el nombre, ya normalizado. */
const NOMBRE = "PARTICULAR"

/** Sin tildes, sin espacios de más, en mayúsculas. */
function normalizar(texto: string): string {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase()
}

/**
 * El deudor Particular de esta clínica, o `null` si no lo tiene.
 *
 * El resultado se cachea en los dos sentidos: también el "no hay". Sin eso,
 * cada paso de cada paciente de una clínica sin Particular dispararía una
 * búsqueda al proxy que ya sabemos que no va a encontrar nada.
 */
export async function deudorParticular(clienteId: string): Promise<DeudorParticular | null> {
  if (!clienteId) return null

  // El recolector del pedido, si el portal está en modo diagnóstico. No viene
  // por parámetro: así esta función no cambia de forma para los seis
  // llamadores que no saben nada de diagnósticos.
  const diagnostico = diagnosticoActual()

  const redis = getRedisClient()
  const clave = `${CLAVE}${clienteId}`

  if (redis) {
    try {
      const guardado = await redis.get(clave)
      if (guardado !== null && guardado !== undefined) {
        diagnostico?.anotar({
          titulo: "deudor Particular (desde la caché)",
          resumen: guardado === "" ? "esta clínica NO tiene un deudor Particular" : "encontrado",
          crudo: guardado === "" ? null : guardado,
        })
        // "" es la marca de "esta clínica no tiene Particular".
        if (guardado === "") return null
        const datos = typeof guardado === "string" ? JSON.parse(guardado) : (guardado as DeudorParticular)
        return datos?.id ? (datos as DeudorParticular) : null
      }
    } catch (error) {
      console.error("[PARTICULAR] No se pudo leer la caché:", error)
    }
  }

  let encontrado: DeudorParticular | null = null
  try {
    const respuesta = await validarObraSocial(clienteId, "particular")
    const lista = respuesta?.exito ? respuesta?.datos?.obras_sociales : null

    if (Array.isArray(lista)) {
      diagnostico?.anotar({
        titulo: "get_obras_sociales · busqueda=\"particular\"",
        resumen: `${lista.length} coincidencias`,
        crudo: muestra(lista.map((os: any) => ({ id: os?.id, nombre: os?.nombre })), 10),
      })
      const exacta = lista.find((os: any) => os?.id && normalizar(os?.nombre) === NOMBRE)
      // El nombre se guarda como lo escribe la clínica, pero sin los espacios
      // de más: va a aparecer en el repaso del paciente ("Obra social: …").
      if (exacta) encontrado = { id: String(exacta.id), nombre: String(exacta.nombre).trim() }
      else if (lista.length > 0) {
        // Hay coincidencias pero ninguna se llama exactamente así. Queda
        // registrado: es el dato que hace falta para decidir si conviene
        // aceptar otros nombres, y con cuáles.
        console.log(
          `[PARTICULAR] ${clienteId} no tiene un deudor "PARTICULAR" exacto. Candidatos: ` +
            lista.map((os: any) => os?.nombre).filter(Boolean).join(" · "),
        )
      }
    }
  } catch (error) {
    console.error("[PARTICULAR] No se pudo consultar el catálogo:", error)
    // No se cachea el fallo: un problema de red no tiene que dejar la clínica
    // sin la alternativa por un día entero.
    return null
  }

  if (redis) {
    try {
      await redis.set(clave, encontrado ? JSON.stringify(encontrado) : "", { ex: TTL })
    } catch (error) {
      console.error("[PARTICULAR] No se pudo cachear:", error)
    }
  }

  return encontrado
}

/**
 * ¿Esta clínica ofrece turnos particulares por el portal?
 *
 * `undefined` es `true`: la función ya está desplegada y andando, y que
 * aparezca el campo no tiene que apagársela a nadie. Ver `ofrecerTurnosParticulares`
 * en lib/types.ts.
 *
 * Existe para que la pantalla y la reserva contesten lo mismo. Si la pantalla
 * lo ofreciera y la reserva lo ignorara, el paciente confirmaría un turno
 * particular y le quedaría con su obra social: un turno que la clínica no
 * puede cobrar y que el paciente cree que sí tiene cubierto.
 */
export function ofreceTurnosParticulares(
  config?: { ofrecerTurnosParticulares?: boolean } | null,
): boolean {
  return config?.ofrecerTurnosParticulares !== false
}

/**
 * ¿Tiene sentido ofrecerle turnos particulares a este paciente?
 *
 * No, si ya viene como particular: su obra social ES la de particular, o no
 * tiene ninguna. En esos casos lo que ve ya son todos sus horarios, y un
 * cartel diciéndole que su obra social no es aceptada sería falso.
 */
export function correspondeOfrecerParticular(
  obraSocialDelPaciente: string | undefined,
  particular: DeudorParticular | null,
): boolean {
  if (!particular) return false
  if (!obraSocialDelPaciente) return false
  return String(obraSocialDelPaciente) !== particular.id
}
