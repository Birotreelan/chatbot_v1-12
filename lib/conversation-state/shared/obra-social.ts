/**
 * lib/conversation-state/shared/obra-social.ts
 *
 * Resolución de "¿esta obra social permite sacar turnos online?".
 *
 * POR QUÉ EXISTE (31/8/2026 — caso Zelmira, Salud Ocular, PAMI HAEDO)
 * Una paciente con una obra social NO habilitada para turnos online pudo
 * recorrer todo el flujo de reserva (sede → profesional → especialidad →
 * cualquier médico) hasta terminar derivada al teléfono. El chequeo existía,
 * pero fallaba por dos motivos que se combinaban:
 *
 *   1. Se buscaba la obra social por NOMBRE (get_obras_sociales con
 *      busqueda="PAMI HAEDO") y se tomaba `obras_sociales[0]` — el primer
 *      resultado de la búsqueda. Con varias coincidencias ("PAMI", "PAMI
 *      HAEDO", "PAMI SO"...) se terminaba evaluando el flag de OTRA obra
 *      social. El paciente trae su `Deudor_Id`, así que se puede resolver de
 *      forma exacta en vez de confiar en el orden de una búsqueda por texto.
 *
 *   2. El mapeo de la API hace `permite_turnos_online: ... ?? true` — si el
 *      campo no viene, se asume habilitada. Es un "fail-open" sobre una regla
 *      de negocio que sirve justamente para bloquear.
 *
 * Sobre el punto 2 este módulo NO invierte el default a "bloquear": si la API
 * dejara de mandar el campo para todas las obras sociales, eso frenaría a
 * TODOS los pacientes, que es un daño mucho peor que el que se quiere evitar.
 * En su lugar distingue explícitamente los tres estados posibles y deja el
 * caso indeterminado registrado, para poder decidir con datos si conviene
 * endurecerlo.
 */

import { validarObraSocial } from '@/lib/api-tools/api-functions'
import { recordDiag, recordDiagSample, DIAG } from '@/lib/diagnostics'

export type EstadoTurnosOnline =
  /** La obra social está explícitamente habilitada. */
  | 'permitida'
  /** La obra social está explícitamente NO habilitada → hay que bloquear. */
  | 'bloqueada'
  /** No se pudo determinar (no se encontró, falló la API, o falta el campo). */
  | 'indeterminado'

export interface ResultadoObraSocial {
  estado: EstadoTurnosOnline
  /** Nombre tal como lo devuelve la API (para usarlo en el mensaje al paciente). */
  nombre?: string
  /** Motivo del 'indeterminado', para diagnóstico. */
  motivo?: string
}

/**
 * Determina si la obra social del paciente admite turnos online.
 *
 * @param clientId          cliente_id de la clínica
 * @param obraSocialNombre  nombre de la obra social del paciente (para la búsqueda)
 * @param obraSocialId      Deudor_Id del paciente — cuando está, manda sobre el nombre
 */
export async function resolverTurnosOnline(
  clientId: string,
  obraSocialNombre?: string,
  obraSocialId?: string,
): Promise<ResultadoObraSocial> {
  const nombreBusqueda = (obraSocialNombre || '').trim()
  if (!nombreBusqueda) {
    return { estado: 'indeterminado', motivo: 'sin_nombre_de_obra_social' }
  }

  try {
    const validacion = await validarObraSocial(clientId, nombreBusqueda)

    if (!validacion?.exito || !validacion.datos?.obras_sociales?.length) {
      return { estado: 'indeterminado', motivo: 'busqueda_sin_resultados', nombre: nombreBusqueda }
    }

    const candidatas = validacion.datos.obras_sociales
    const idBuscado = (obraSocialId || '').trim().toLowerCase()
    const normalizar = (s: string) =>
      (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

    // Prioridad de resolución: ID exacto > nombre exacto > única candidata.
    // Si nada de eso resuelve, NO se adivina con la primera de la lista: eso
    // es justamente lo que hacía que se evaluara la obra social equivocada.
    let elegida = idBuscado
      ? candidatas.find((os: any) => (os.id || '').toString().trim().toLowerCase() === idBuscado)
      : undefined

    if (!elegida) {
      elegida = candidatas.find((os: any) => normalizar(os.nombre) === normalizar(nombreBusqueda))
    }
    if (!elegida && candidatas.length === 1) {
      elegida = candidatas[0]
    }

    if (!elegida) {
      void recordDiagSample({
        tipo: 'obra_social_ambigua',
        mensaje: nombreBusqueda,
        detalle: {
          obraSocialId,
          candidatas: candidatas.slice(0, 5).map((os: any) => ({ id: os.id, nombre: os.nombre, permite: os.permite_turnos_online })),
        },
      })
      return { estado: 'indeterminado', motivo: 'no_se_pudo_identificar_cual', nombre: nombreBusqueda }
    }

    // Ojo: api-functions mapea el campo ausente a `true`. Acá solo se confía en
    // un `false` explícito para bloquear; cualquier otra cosa se trata como
    // permitida, pero el caso "no se encontró por ID" ya quedó registrado arriba.
    if (elegida.permite_turnos_online === false) {
      return { estado: 'bloqueada', nombre: elegida.nombre || nombreBusqueda }
    }

    return { estado: 'permitida', nombre: elegida.nombre || nombreBusqueda }
  } catch (error) {
    console.error('[OBRA-SOCIAL] Error resolviendo turnos online:', error)
    return { estado: 'indeterminado', motivo: 'error_api', nombre: nombreBusqueda }
  }
}

/**
 * Igual que resolverTurnosOnline pero además registra la métrica de bloqueo.
 * Se usa en los puntos donde el bloqueo efectivamente corta el flujo.
 */
export async function resolverTurnosOnlineConMetrica(
  clientId: string,
  configId: string | undefined,
  obraSocialNombre?: string,
  obraSocialId?: string,
): Promise<ResultadoObraSocial> {
  const resultado = await resolverTurnosOnline(clientId, obraSocialNombre, obraSocialId)

  if (resultado.estado === 'bloqueada') {
    void recordDiag(configId, DIAG.OBRA_SOCIAL_BLOQUEADA_EN_SALUDO)
  } else if (resultado.estado === 'indeterminado') {
    // Métrica clave: cada uno de estos es un paciente que PODRÍA tener la obra
    // social bloqueada y al que igual dejamos avanzar. Si el número es alto,
    // hay que revisar la fuente de datos antes que el flujo.
    console.warn(
      `[OBRA-SOCIAL] No se pudo determinar si "${obraSocialNombre}" permite turnos online (${resultado.motivo}) — se deja avanzar`,
    )
    void recordDiag(configId, 'obra_social_indeterminada')
  }

  return resultado
}
