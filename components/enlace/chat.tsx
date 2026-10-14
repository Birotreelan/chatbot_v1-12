"use client"

/**
 * La conversación del enlace, del lado del navegador (14/10/2026).
 *
 * ── Qué hace y qué no ──────────────────────────────────────────────────────
 *
 * Dibuja burbujas, manda lo que el paciente escribe o toca a
 * `POST /api/enlace/mensaje`, y agrega lo que contesta. No sabe en qué paso
 * está, ni qué viene después, ni qué botones corresponden: todo eso lo decide
 * el motor conversacional en el servidor y llega en la respuesta.
 *
 * Eso no es prolijidad: es la única forma de que el enlace y WhatsApp no se
 * separen. Si el cliente tuviera su propia idea de los pasos, habría dos
 * máquinas de estados que tendrían que coincidir, y el día que una cambie el
 * paciente del enlace vería un flujo distinto del del chat. Es exactamente el
 * error del primer intento de esta pantalla.
 *
 * ── El optimismo es sólo del mensaje propio ────────────────────────────────
 *
 * Lo que el paciente manda se dibuja antes de que el servidor conteste: en un
 * chat, ver lo que uno acaba de decir es inmediato o se siente roto. La
 * RESPUESTA nunca se adivina. Si la llamada falla, el mensaje propio queda —
 * pasó de verdad, el paciente lo escribió— y abajo aparece el error.
 */

import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import type { MensajeDelChat } from "@/lib/enlace/transcripcion"
import { tramos } from "@/lib/enlace/texto"

/** El texto del motor con su `*negrita*` dibujada. Ver lib/enlace/texto.ts. */
function Texto({ children }: { children: string }) {
  return (
    <>
      {tramos(children).map((t, i) =>
        t.negrita ? (
          <strong key={i} className="font-semibold">
            {t.texto}
          </strong>
        ) : (
          <span key={i}>{t.texto}</span>
        ),
      )}
    </>
  )
}

function Burbuja({ children, de }: { children: ReactNode; de: "asistente" | "paciente" }) {
  if (de === "paciente") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] text-primary-foreground">
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-md border bg-card px-4 py-3 text-[15px] shadow-sm">
        {children}
      </div>
    </div>
  )
}

/**
 * Los puntitos de "está escribiendo".
 *
 * No es decoración: el motor consulta la agenda de la clínica y hay pasos que
 * tardan varios segundos. Sin esta señal el paciente vuelve a tocar el botón, y
 * un doble envío en medio de una reserva es el peor momento posible.
 */
function Escribiendo() {
  return (
    <div className="flex justify-start">
      <div className="flex gap-1 rounded-2xl rounded-bl-md border bg-card px-4 py-3.5 shadow-sm">
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.3s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.15s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50" />
      </div>
    </div>
  )
}

export function ChatDelEnlace({
  token,
  inicial,
  terminadaInicial,
}: {
  token: string
  /** La transcripción que ya tenía el enlace, o los primeros mensajes. */
  inicial: MensajeDelChat[]
  /** `true` si la gestión ya se cerró: se muestra la conversación sin barra. */
  terminadaInicial?: boolean
}) {
  const [mensajes, setMensajes] = useState<MensajeDelChat[]>(inicial)
  const [texto, setTexto] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [terminada, setTerminada] = useState(!!terminadaInicial)
  const [error, setError] = useState<string | null>(null)
  const finRef = useRef<HTMLDivElement>(null)

  // Al último mensaje, siempre. `block: "end"` y no `scrollIntoView()` pelado:
  // el default centra, y en el móvil eso deja la barra de escritura tapada.
  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [mensajes, enviando])

  const enviar = async (valor: string) => {
    const limpio = valor.trim()
    if (!limpio || enviando || terminada) return

    setTexto("")
    setError(null)
    setEnviando(true)
    setMensajes((previos) => [
      ...previos,
      { de: "paciente", texto: limpio, en: new Date().toISOString() },
    ])

    try {
      const respuesta = await fetch("/api/enlace/mensaje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, texto: limpio }),
      })

      const datos = await respuesta.json().catch(() => null)

      if (!respuesta.ok || !datos?.mensajes) {
        setError("No pudimos procesar tu mensaje. Probá de nuevo en unos segundos.")
        return
      }

      setMensajes((previos) => [...previos, ...(datos.mensajes as MensajeDelChat[])])
      if (datos.terminada) setTerminada(true)
    } catch {
      // Casi siempre es el paciente perdiendo señal. El texto lo dice sin
      // culpar a nadie y sin pedirle que "revise su conexión", que es lo que
      // ya está haciendo.
      setError("Se cortó la conexión. Cuando vuelva, probá de nuevo.")
    } finally {
      setEnviando(false)
    }
  }

  // Los botones se dibujan SÓLO en el último mensaje del asistente. Los de los
  // mensajes viejos quedan guardados en la transcripción pero no se muestran:
  // tocar la opción de un paso que ya pasó manda al motor una respuesta que no
  // espera, y el chat contestaría algo que no tiene sentido.
  const ultimo = mensajes[mensajes.length - 1]
  const botones = !enviando && !terminada && ultimo?.de === "asistente" ? ultimo.botones : undefined

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-2.5">
        {mensajes.map((m, i) => (
          <Burbuja key={`${m.en}-${i}`} de={m.de}>
            <Texto>{m.texto}</Texto>
          </Burbuja>
        ))}
        {enviando && <Escribiendo />}
        <div ref={finRef} />
      </div>

      {botones && botones.length > 0 && (
        <div className="flex flex-col gap-2">
          {botones.map((b) => (
            <button
              key={b.id}
              type="button"
              // Se manda el TÍTULO y no el id: el motor viene de WhatsApp,
              // donde `extractMessageContent` lee primero `button.text`. Mandar
              // el id haría que el enlace hable un idioma que el bot no habla.
              onClick={() => enviar(b.titulo)}
              className="flex flex-col items-start rounded-xl border bg-card px-4 py-2.5 text-left text-[15px] transition hover:border-primary hover:bg-accent"
            >
              <span className="font-medium">{b.titulo}</span>
              {b.detalle && (
                <span className="text-[13px] text-muted-foreground">{b.detalle}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p role="status" className="text-[13px] text-destructive">
          {error}
        </p>
      )}

      {terminada ? (
        <p className="text-[13px] text-muted-foreground">
          Esta gestión ya está cerrada. Si necesitás algo más, escribinos por WhatsApp.
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            enviar(texto)
          }}
          className="sticky bottom-0 flex gap-2 bg-background py-2"
        >
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            disabled={enviando}
            maxLength={300}
            // `enterKeyHint` y `autoComplete="off"`: el teclado del móvil pone
            // "enviar" en vez de "ir", y el navegador no ofrece autocompletar
            // direcciones sobre un campo que recibe DNIs y nombres.
            enterKeyHint="send"
            autoComplete="off"
            placeholder="Escribí tu respuesta…"
            className="flex-1 rounded-xl border bg-card px-4 py-2.5 text-[15px] outline-none focus:border-primary disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={enviando || !texto.trim()}
            className="rounded-xl bg-primary px-4 py-2.5 text-[15px] font-medium text-primary-foreground transition disabled:opacity-40"
          >
            Enviar
          </button>
        </form>
      )}
    </div>
  )
}
