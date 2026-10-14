/**
 * Las pantallas donde el enlace no sigue (14/10/2026).
 *
 * El enlace no existe, venció, ya se usó, o el plazo para gestionar terminó.
 * En los cuatro casos no hay nada que elegir: se muestra una pantalla y se
 * termina.
 *
 * ── Por qué están acá y no en cada página ──────────────────────────────────
 *
 * Estas cuatro guardas vivían dentro de `pagina-del-enlace.tsx`, que era la
 * única página del enlace. Cuando el chat pasó a ser una página propia —con su
 * propio motor, no la máquina de pasos del portal— quedaban dos caminos que
 * tienen que contestar lo mismo a "¿este enlace se puede usar?".
 *
 * Duplicarlas sería garantizar que un día se corrija un borde en uno de los dos
 * formatos y no en el otro. Y los bordes acá no son hipotéticos: cada uno de los
 * textos de abajo se escribió por un caso real.
 *
 * ── Devuelve `null` cuando el enlace sí sirve ──────────────────────────────
 *
 * Así el llamador lo lee como una guarda y no como una rama más:
 *
 *     const terminal = pantallaTerminal({ ... })
 *     if (terminal) return terminal
 */

import type { ReactNode } from "react"
import type { LecturaDelEnlace } from "@/lib/portal/token"
import type { MarcaDelPortal } from "@/lib/portal/marca"
import { permiteGestionar, permiteVerDatos } from "@/lib/portal/vigencia"
import { Marco, Avance, Aviso, ResumenDelTurno, TituloDePaso } from "@/components/portal/marco"

export function pantallaTerminal({
  lectura,
  marca,
  token,
  cookieNueva,
  nombreCookie,
  formato,
}: {
  /** `null` cuando el token no existe en Redis. */
  lectura: LecturaDelEnlace | null
  marca: MarcaDelPortal
  token: string
  cookieNueva: string | null
  nombreCookie: string
  formato?: "pantallas" | "chat"
}): ReactNode | null {
  const marco = (children: ReactNode, conToken = true) => (
    <Marco
      marca={marca}
      cookieNueva={cookieNueva}
      nombreCookie={nombreCookie}
      token={conToken ? token : undefined}
      formato={formato}
    >
      {children}
    </Marco>
  )

  // Un token inexistente y uno vencido hace rato se ven igual desde acá, y está
  // bien: no hay nada que decirle a quien tiene una URL que no le corresponde.
  //
  // Sin `token`: no se anota el hito "abierto" de un enlace que no existe.
  if (!lectura) {
    return marco(
      <Aviso
        tono="atencion"
        titulo="Este enlace ya no está disponible"
        detalle="Puede haber vencido o haberse usado. Escribinos por WhatsApp y te mandamos uno nuevo."
      />,
      false,
    )
  }

  const { contexto, estado } = lectura

  if (!permiteVerDatos(estado)) {
    return marco(
      <Aviso
        tono="atencion"
        titulo="Este enlace venció"
        detalle="Escribinos por WhatsApp y te mandamos uno nuevo."
      />,
    )
  }

  // Ya gestionó: se muestra lo que quedó, sin botones. El paciente vuelve a
  // abrir el enlace para chequear, y encontrarse un error lo mandaría a
  // preguntarle al bot — un mensaje que pagamos y que no debería existir.
  if (estado === "gestionado" && contexto.resultado) {
    // ── El título tiene que decir lo mismo que el texto (28/9/2026) ────────
    //
    // Acá había tres frases fijas: "Listo", tono de éxito, y "te va a llegar
    // la confirmación por WhatsApp". Las tres eran ciertas sólo para una
    // reserva confirmada. A quien había CANCELADO su turno, esta pantalla le
    // decía "Listo ✓ — te va a llegar la confirmación": el `detalle` decía
    // "cancelamos tu turno" y el encabezado celebraba lo contrario.
    //
    // Y a quien tenía una solicitud pendiente de aprobación le decía "Listo",
    // que es exactamente lo que la pantalla del selector se cuida de no decir
    // para que nadie se presente un día que no tiene turno.
    //
    // `tipo` y `pendiente` los guarda `consumirEnlace` en el momento en que
    // pasó. `tipo` puede faltar en enlaces emitidos antes de este cambio: en
    // ese caso se cae al texto neutro, que no afirma de más.
    const { tipo, pendiente } = contexto.resultado

    const titulo = pendiente
      ? "Tu solicitud fue enviada"
      : tipo === "cancelacion"
        ? "Turno cancelado"
        : tipo === "confirmacion"
          ? "Asistencia confirmada"
          : tipo === "cambio"
            ? "Tu turno cambió"
            : "Listo"

    const pie = pendiente
      ? "Te avisamos por WhatsApp apenas la clínica la apruebe."
      : tipo === "cancelacion"
        ? "Si más adelante querés sacar otro turno, escribinos por WhatsApp."
        : tipo === "confirmacion"
          ? "Te esperamos. Si algo cambia, escribinos por WhatsApp."
          : "Te va a llegar la confirmación por WhatsApp."

    return marco(
      <>
        <Avance actual="Confirmar" />
        <TituloDePaso tipo="listo" sinIcono>
          {titulo}
        </TituloDePaso>
        {/* Sin `detalle`: el título de arriba ya encabeza, así que el aviso
            lleva la frase concreta y nada más. Repetir "Turno cancelado" dos
            veces seguidas no agrega nada y empuja el dato real más abajo. */}
        <Aviso
          titulo={contexto.resultado.texto}
          // Verde salvo en la cancelación: salió bien, pero no es una buena
          // noticia, y el verde le pone una celebración encima a alguien que
          // perdió su turno.
          //
          // Pendiente de aprobación SÍ va en verde (30/9/2026): el color no
          // habla del turno sino de lo que el paciente hizo, y su solicitud
          // salió bien. Lo que falta se lo dice el texto.
          tono={tipo === "cancelacion" ? "neutro" : "exito"}
        />
        {contexto.resultado.turno && (
          <ResumenDelTurno
            turno={contexto.resultado.turno}
            titulo={tipo === "cancelacion" ? "El turno que cancelaste" : undefined}
          />
        )}
        <p className="text-muted-foreground">{pie}</p>
      </>,
    )
  }

  // Hoy esto no se alcanza: el vencimiento está apagado y `estadoDelEnlace`
  // nunca devuelve "vencido" (ver `vencimientoHabilitado`). Se deja porque es
  // la pantalla que vuelve a hacer falta el día que se encienda, y porque un
  // enlace que caduca sin explicar por qué es peor que este mensaje.
  if (!permiteGestionar(estado)) {
    return marco(
      <>
        <Aviso
          tono="atencion"
          titulo="El plazo para gestionar por acá terminó"
          detalle="Escribinos por WhatsApp y lo resolvemos."
        />
        {contexto.turno && <ResumenDelTurno turno={contexto.turno} titulo="Tu turno" />}
      </>,
    )
  }

  return null
}
