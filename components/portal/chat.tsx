/**
 * El enlace visto como conversación (13/10/2026).
 *
 * ── Qué es y qué no es ─────────────────────────────────────────────────────
 *
 * Es una PRESENTACIÓN. No hay un chatbot acá: no hay mensajes que se envían,
 * ni endpoint que responda, ni estado de conversación. Lo que hay es la misma
 * máquina de pasos del portal —`decidirPaso`— dibujada como burbujas: el paso
 * actual es la última burbuja y cada opción es un enlace, igual que en las
 * pantallas.
 *
 * Esa decisión es la que hace que esto sea chico y no un canal nuevo. Un chat
 * "de verdad" necesitaría un transporte, un historial propio y una máquina de
 * estados paralela; y las tres cosas tendrían que coincidir con las que ya
 * existen. Acá no pueden divergir porque son las mismas.
 *
 * ── El historial es una proyección, no un almacén ──────────────────────────
 *
 * Las burbujas de arriba se DERIVAN del estado: los filtros de la URL y la
 * identidad del token. No se guarda ninguna transcripción.
 *
 * Si se guardara, habría dos respuestas a la misma pregunta —"¿qué eligió el
 * paciente?"— y un refresh o un "volver" del navegador podría mostrar una
 * conversación que no coincide con el estado real. Es el mismo criterio que
 * `decidirPaso`: una sola autoridad sobre dónde está el paciente.
 */

import type { ReactNode } from "react"

/** Una respuesta ya dada, dibujada como burbuja del paciente. */
export interface RespuestaDada {
  /** Lo que se le preguntó, acortado. Da contexto sin repetir el párrafo entero. */
  pregunta: string
  /** Lo que el paciente eligió o escribió. */
  respuesta: string
  /**
   * A dónde va el "cambiar" de esta burbuja. `undefined` = no se puede
   * cambiar desde acá.
   *
   * Sólo los pasos revisitables lo traen. Ver PASOS_REVISITABLES en
   * lib/portal/pasos.ts y la nota del bucle del DNI: ofrecer "cambiar" en un
   * paso que no vuelve deja al paciente rebotando entre dos pantallas.
   */
  cambiar?: string
}

function Burbuja({
  children,
  de,
}: {
  children: ReactNode
  de: "asistente" | "paciente"
}) {
  if (de === "paciente") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] text-primary-foreground">
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      {/* `max-w-full` y no un porcentaje: la burbuja del asistente puede
          contener el calendario o el formulario del alta, que necesitan todo
          el ancho. Acotarla cortaría la grilla de horarios. */}
      <div className="w-full max-w-full rounded-2xl rounded-bl-md border bg-card px-4 py-3 text-[15px] shadow-sm">
        {children}
      </div>
    </div>
  )
}

/**
 * La conversación completa: el historial y el paso actual.
 *
 * `children` es exactamente lo que el paso le pasaría a `marco()` en el
 * formato de pantallas. No se reinterpreta: se mete dentro de la última
 * burbuja tal cual. Por eso el chat no necesita saber qué paso se está
 * dibujando — y por eso un paso nuevo aparece en los dos formatos sin tocar
 * este archivo.
 */
export function Conversacion({
  historial,
  children,
}: {
  historial: RespuestaDada[]
  children: ReactNode
}) {
  return (
    <div className="space-y-3">
      {historial.map((paso, i) => (
        <div key={i} className="space-y-1.5">
          <Burbuja de="asistente">
            <p className="text-muted-foreground">{paso.pregunta}</p>
          </Burbuja>
          <Burbuja de="paciente">{paso.respuesta}</Burbuja>
          {/* El "cambiar" va debajo de la respuesta y alineado a la derecha,
              pegado a la burbuja que modifica. Arriba se leería como una
              opción de la pregunta siguiente. */}
          {paso.cambiar && (
            <div className="flex justify-end">
              <a
                href={paso.cambiar}
                className="text-[13px] text-primary underline underline-offset-2"
              >
                Cambiar
              </a>
            </div>
          )}
        </div>
      ))}

      <Burbuja de="asistente">{children}</Burbuja>
    </div>
  )
}
