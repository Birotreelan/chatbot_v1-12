/**
 * ¿Se ofrece "Confirmar asistencia" en el menú del turno? (25/9/2026)
 *
 * ── Por qué es una función y no un `&&` en cada lugar ──────────────────────
 *
 * Esta pregunta se responde en CINCO lugares: el saludo de un turno, el de
 * varios, el menú de vuelta después de una gestión, y los dos mapas de
 * números que dicen qué hace cada tecla. El texto lo arma
 * `patient-templates.ts`; el mapa, `patient-flow-handler.ts`. Son archivos
 * distintos y sus comentarios dicen, cada uno, "debe coincidir con el otro".
 *
 * Mientras coincidan no pasa nada. El día que una opción se cae en la lista
 * del texto y no en la de los números, el paciente lee "2- Cancelar el turno"
 * y el 2 hace otra cosa. Ya pasó: el caso Liliana (tel. 1155891028, 9/7/2026)
 * es exactamente eso — el menú ofrecía confirmar, el mapa no, y el "1"
 * terminó cancelando el turno de alguien que quería confirmarlo.
 *
 * Agregarle una condición nueva a esa pregunta copiándola cinco veces era
 * repetir el error a propósito. Acá se responde una vez.
 *
 * ── Qué agrega el portal ───────────────────────────────────────────────────
 *
 * En los clientes con portal web la confirmación se hace con el botón
 * "Confirmar" del recordatorio, que ya está en el chat y no cuesta un mensaje
 * nuevo. Ofrecerla además en el menú suma una opción —y corre todos los
 * números— para algo que el paciente tiene a un toque.
 *
 * Como consecuencia, el saludo de esos clientes tampoco dice "todavía no
 * confirmaste tu asistencia": nombrar algo que el menú no permite hacer deja
 * al paciente buscando una opción que no existe.
 */

export interface PermisosDeConfirmacion {
  /**
   * El estado del turno admite confirmar: "no confirmado" y con recordatorio
   * enviado. Lo calcula el llamador con `shouldOfferConfirmation` o
   * `classifyTurnoEstado`, que es donde vive ese criterio y sigue ahí.
   *
   * Con varios turnos el llamador pasa `true`: es el comportamiento que había
   * antes de esta función y no se cambia de contrabando.
   */
  estadoAdmiteConfirmar: boolean
  /** `WhatsAppConfig.clientePortalWeb`. */
  usaPortalWeb?: boolean
}

export function seOfreceConfirmarAsistencia(permisos: PermisosDeConfirmacion): boolean {
  return permisos.estadoAdmiteConfirmar && permisos.usaPortalWeb !== true
}

/**
 * ¿El saludo menciona que el turno está sin confirmar?
 *
 * Es la misma decisión mirada desde el texto: si no se puede confirmar desde
 * acá, no se nombra. Se expone aparte porque el saludo la necesita antes de
 * armar el menú y porque así las dos no pueden separarse.
 */
export function seMencionaLaFaltaDeConfirmacion(permisos: PermisosDeConfirmacion): boolean {
  return seOfreceConfirmarAsistencia(permisos)
}
