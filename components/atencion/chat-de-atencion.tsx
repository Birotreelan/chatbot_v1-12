"use client"

/**
 * El chat del paciente con la clínica (5/11/2026).
 *
 * ── Qué tiene que parecer ──────────────────────────────────────────────────
 *
 * Un WhatsApp. No porque haya que imitarlo, sino porque el paciente viene de
 * ahí: el enlace se lo mandamos por WhatsApp y lo abre con ese chat todavía en
 * la pantalla de al lado. Cualquier otra convención —un formulario, una lista
 * de tickets— le haría preguntarse qué es esto.
 *
 * ── Consultas y no stream ──────────────────────────────────────────────────
 *
 * Cada 5 segundos mientras la pestaña está visible, y nada mientras no lo
 * está. Es el mismo criterio del widget de notificaciones, por el mismo
 * motivo: un SSE mantiene viva una instancia de función y en Fluid compute la
 * memoria se factura por tiempo de vida. Ahí costó 731,9 GB-hora en un mes.
 *
 * Y pausar con la pestaña oculta no es sólo ahorro: la consulta es también el
 * latido de presencia, y un chat abierto en una pestaña que nadie mira no
 * tiene que contar como "el paciente está leyendo" —si contara, la clínica le
 * escribiría y no se le avisaría por WhatsApp—.
 *
 * ── `desde` y no comparar fechas ───────────────────────────────────────────
 *
 * El servidor devuelve `total` —la cantidad de mensajes que tiene— y el chat
 * pide `desde=total` en la consulta siguiente. Comparar por fecha duplica
 * burbujas cuando dos mensajes caen en el mismo segundo, que es exactamente lo
 * que pasa cuando un agente manda tres líneas seguidas.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Mic, Paperclip, Send, Square, Trash2 } from "lucide-react"

export interface MensajeEnPantalla {
  id: string
  rol: "paciente" | "agente" | "sistema"
  texto: string
  enviadoEl: string
  agenteNombre?: string
  via?: "chat" | "whatsapp"
  media?: {
    tipo: string
    mimeType: string
    nombreArchivo: string
    tamanoBytes: number
    url: string
  }
}

const INTERVALO_MS = 5000

/** "14:32" en la hora del dispositivo del paciente. */
function hora(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

/** "hoy", "ayer" o "lunes 3 de noviembre". */
function etiquetaDelDia(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const hoy = new Date()
  const mismoDia = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (mismoDia(d, hoy)) return "hoy"
  const ayer = new Date(hoy.getTime() - 86_400_000)
  if (mismoDia(d, ayer)) return "ayer"
  const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
  const meses = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ]
  const anio = d.getFullYear() !== hoy.getFullYear() ? ` de ${d.getFullYear()}` : ""
  return `${dias[d.getDay()]} ${d.getDate()} de ${meses[d.getMonth()]}${anio}`
}

export function ChatDeAtencion({
  token,
  inicial,
  totalInicial,
  clinica,
}: {
  token: string
  inicial: MensajeEnPantalla[]
  totalInicial: number
  clinica: string
}) {
  const [mensajes, setMensajes] = useState<MensajeEnPantalla[]>(inicial)
  const [texto, setTexto] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [vencido, setVencido] = useState(false)

  const [subiendo, setSubiendo] = useState(false)
  /**
   * La grabación de audio.
   *
   * `MediaRecorder` existe en todos los navegadores que importan, pero cada
   * uno produce un formato distinto: webm/opus en Chrome y Android, ogg en
   * Firefox, mp4/aac en Safari e iOS. No se fuerza ninguno —forzar webm hace
   * que en iPhone la grabación falle sin decir por qué— y el servidor acepta
   * los cuatro. Ver lib/atencion/media.ts.
   */
  const [grabando, setGrabando] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const grabadora = useRef<MediaRecorder | null>(null)
  const pedazos = useRef<Blob[]>([])
  const cancelada = useRef(false)
  const archivoRef = useRef<HTMLInputElement | null>(null)

  const total = useRef(totalInicial)
  const finDeLaLista = useRef<HTMLDivElement | null>(null)
  // Para no robarle el scroll a quien está leyendo lo de arriba.
  const pegadoAbajo = useRef(true)

  const consultar = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/atencion/mensaje?token=${encodeURIComponent(token)}&desde=${total.current}`,
        { cache: "no-store" },
      )
      if (r.status === 401) {
        setVencido(true)
        return
      }
      if (!r.ok) return
      const datos = await r.json()
      if (!Array.isArray(datos?.mensajes)) return

      total.current = typeof datos.total === "number" ? datos.total : total.current
      if (datos.mensajes.length > 0) {
        setMensajes((previos) => {
          const vistos = new Set(previos.map((m) => m.id))
          const nuevos = (datos.mensajes as MensajeEnPantalla[]).filter((m) => !vistos.has(m.id))
          return nuevos.length > 0 ? [...previos, ...nuevos] : previos
        })
      }
      setError(null)
    } catch {
      // Un fallo de red no se le muestra: la consulta siguiente lo resuelve, y
      // un cartel que aparece y desaparece cada cinco segundos es peor que el
      // silencio.
    }
  }, [token])

  // El ciclo de consultas, pausado con la pestaña oculta.
  useEffect(() => {
    if (vencido) return

    let id: ReturnType<typeof setInterval> | null = null
    const arrancar = () => {
      if (id) return
      consultar()
      id = setInterval(consultar, INTERVALO_MS)
    }
    const parar = () => {
      if (id) clearInterval(id)
      id = null
    }
    const alCambiar = () => (document.visibilityState === "hidden" ? parar() : arrancar())

    if (document.visibilityState !== "hidden") arrancar()
    document.addEventListener("visibilitychange", alCambiar)
    return () => {
      parar()
      document.removeEventListener("visibilitychange", alCambiar)
    }
  }, [consultar, vencido])

  // Bajar al último mensaje, salvo que el paciente esté leyendo más arriba.
  useEffect(() => {
    if (pegadoAbajo.current) finDeLaLista.current?.scrollIntoView({ block: "end" })
  }, [mensajes])

  const enviar = async () => {
    const limpio = texto.trim()
    if (!limpio || enviando) return

    setEnviando(true)
    setError(null)
    try {
      const r = await fetch("/api/atencion/mensaje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, texto: limpio }),
      })
      if (r.status === 401) {
        setVencido(true)
        return
      }
      const datos = await r.json().catch(() => null)
      if (!r.ok || !datos?.mensaje) {
        setError(datos?.error || "No se pudo enviar el mensaje. Probá de nuevo.")
        return
      }

      // Se agrega en el acto y se corre `total`: si no, la consulta siguiente
      // lo traería otra vez y quedaría dos veces en pantalla.
      pegadoAbajo.current = true
      setMensajes((previos) =>
        previos.some((m) => m.id === datos.mensaje.id) ? previos : [...previos, datos.mensaje],
      )
      total.current += 1
      setTexto("")
    } catch {
      setError("No se pudo enviar el mensaje. Revisá tu conexión y probá de nuevo.")
    } finally {
      setEnviando(false)
    }
  }

  /** Sube un archivo (o el audio grabado) y lo agrega a la pantalla. */
  const subir = async (archivo: File) => {
    setSubiendo(true)
    setError(null)
    try {
      const form = new FormData()
      form.append("token", token)
      form.append("archivo", archivo)
      // El texto que estaba escrito se manda como pie del archivo, igual que
      // hace WhatsApp. Si no, se perdería al enviar el adjunto.
      if (texto.trim()) form.append("texto", texto.trim())

      const r = await fetch("/api/atencion/media", { method: "POST", body: form })
      if (r.status === 401) {
        setVencido(true)
        return
      }
      const datos = await r.json().catch(() => null)
      if (!r.ok || !datos?.mensaje) {
        setError(datos?.error || "No se pudo enviar el archivo.")
        return
      }

      pegadoAbajo.current = true
      setMensajes((previos) =>
        previos.some((m) => m.id === datos.mensaje.id) ? previos : [...previos, datos.mensaje],
      )
      total.current += 1
      setTexto("")
    } catch {
      setError("No se pudo enviar el archivo. Revisá tu conexión.")
    } finally {
      setSubiendo(false)
    }
  }

  const arrancarGrabacion = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      pedazos.current = []
      cancelada.current = false

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) pedazos.current.push(e.data)
      }
      rec.onstop = () => {
        // El micrófono se suelta SIEMPRE, también al cancelar: una pestaña que
        // se queda con el micrófono tomado deja el punto rojo prendido y es
        // motivo suficiente para que alguien no vuelva a usar esto.
        stream.getTracks().forEach((t) => t.stop())
        if (cancelada.current || pedazos.current.length === 0) return

        const tipo = rec.mimeType || pedazos.current[0]?.type || "audio/webm"
        const blob = new Blob(pedazos.current, { type: tipo })
        const extension = tipo.includes("ogg") ? "ogg" : tipo.includes("mp4") ? "m4a" : "webm"
        subir(new File([blob], `audio.${extension}`, { type: tipo }))
      }

      rec.start()
      grabadora.current = rec
      setSegundos(0)
      setGrabando(true)
    } catch {
      setError("No pudimos usar el micrófono. Revisá los permisos del navegador.")
    }
  }

  const terminarGrabacion = (descartar: boolean) => {
    cancelada.current = descartar
    grabadora.current?.stop()
    grabadora.current = null
    setGrabando(false)
  }

  // El contador, y el corte a los dos minutos. Sin tope, un audio de veinte
  // minutos no entra en el límite del servidor y la grabación se pierde entera
  // al final — después de que el paciente ya habló.
  useEffect(() => {
    if (!grabando) return
    const id = setInterval(() => {
      setSegundos((s) => {
        if (s + 1 >= 120) terminarGrabacion(false)
        return s + 1
      })
    }, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grabando])

  if (vencido) {
    return (
      <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm">
        <p className="font-medium">Este enlace venció</p>
        <p className="mt-1 text-muted-foreground">
          Escribile a {clinica} por WhatsApp y te mandamos uno nuevo con la conversación completa.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-[min(70vh,560px)] flex-col gap-3">
      <div
        className="flex-1 space-y-2 overflow-y-auto rounded-xl border bg-muted/20 p-3"
        onScroll={(e) => {
          const el = e.currentTarget
          pegadoAbajo.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        {mensajes.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Escribinos tu consulta y una persona de {clinica} te responde por acá.
          </p>
        )}

        {mensajes.map((m, i) => {
          const anterior = mensajes[i - 1]
          const cambiaElDia =
            !anterior || etiquetaDelDia(anterior.enviadoEl) !== etiquetaDelDia(m.enviadoEl)
          const mio = m.rol === "paciente"

          if (m.rol === "sistema") {
            return (
              <div key={m.id}>
                {cambiaElDia && <Separador etiqueta={etiquetaDelDia(m.enviadoEl)} />}
                <p className="py-1 text-center text-[11px] text-muted-foreground">{m.texto}</p>
              </div>
            )
          }

          return (
            <div key={m.id}>
              {cambiaElDia && <Separador etiqueta={etiquetaDelDia(m.enviadoEl)} />}
              <div className={`flex ${mio ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-[15px] ${
                    mio ? "bg-primary text-primary-foreground" : "bg-card border"
                  }`}
                >
                  {/* Quién contesta, cuando lo sabemos. Un mensaje sin firma de
                      una clínica con varias personas atendiendo se lee como si
                      viniera de un sistema. */}
                  {!mio && m.agenteNombre && (
                    <p className="mb-0.5 text-[11px] font-medium opacity-70">{m.agenteNombre}</p>
                  )}

                  {m.media && <Adjunto media={m.media} />}

                  {m.texto && <p className="whitespace-pre-wrap break-words">{m.texto}</p>}

                  <p className={`mt-0.5 text-[10px] ${mio ? "opacity-70" : "text-muted-foreground"}`}>
                    {hora(m.enviadoEl)}
                    {/* Que un mensaje vino por WhatsApp se dice: dos meses
                        después explica por qué es corto o por qué hay un
                        salto de una hora en la conversación. */}
                    {m.via === "whatsapp" && " · por WhatsApp"}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
        <div ref={finDeLaLista} />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {grabando ? (
        <div className="flex items-center gap-3 rounded-xl border bg-destructive/5 px-3 py-2.5">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-destructive" />
          <span className="flex-1 text-sm">
            Grabando… {String(Math.floor(segundos / 60)).padStart(2, "0")}:
            {String(segundos % 60).padStart(2, "0")}
          </span>
          <button
            type="button"
            onClick={() => terminarGrabacion(true)}
            aria-label="Descartar el audio"
            className="flex h-10 w-10 items-center justify-center rounded-full border"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => terminarGrabacion(false)}
            aria-label="Enviar el audio"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            <Square className="h-4 w-4" />
          </button>
        </div>
      ) : (
      <div className="flex items-end gap-2">
        <input
          ref={archivoRef}
          type="file"
          accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            // El input se limpia para que elegir el mismo archivo dos veces
            // seguidas vuelva a disparar el `change`.
            e.target.value = ""
            if (f) subir(f)
          }}
        />
        <button
          type="button"
          onClick={() => archivoRef.current?.click()}
          disabled={subiendo}
          aria-label="Adjuntar un archivo"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border disabled:opacity-50"
        >
          {subiendo ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
        </button>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            // Enter manda, Shift+Enter hace un salto de línea: es lo que la
            // gente espera de un chat. En el teléfono el teclado trae su
            // propio Enter de salto, así que no molesta.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              enviar()
            }
          }}
          rows={1}
          placeholder="Escribí tu mensaje"
          className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border bg-background px-3 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-ring"
        />
        {/* Micrófono con el campo vacío, avión con algo escrito: el mismo
            gesto que WhatsApp, y evita un botón más en una barra angosta. */}
        {texto.trim() ? (
          <button
            type="button"
            onClick={enviar}
            disabled={enviando}
            aria-label="Enviar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
          >
            {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        ) : (
          <button
            type="button"
            onClick={arrancarGrabacion}
            disabled={subiendo}
            aria-label="Grabar un audio"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
          >
            <Mic className="h-5 w-5" />
          </button>
        )}
      </div>
      )}
    </div>
  )
}

function Separador({ etiqueta }: { etiqueta: string }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{etiqueta}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

/**
 * El adjunto.
 *
 * Las imágenes se ven; los audios se escuchan; el resto se descarga. Es lo
 * mismo que hace el panel con `AdjuntoDelMensaje`, pero este componente es
 * aparte a propósito: aquél vive dentro del panel con sus estados de caducidad
 * y sus avisos de retención, que acá no corresponden —los archivos de este
 * chat no caducan—.
 */
function Adjunto({ media }: { media: NonNullable<MensajeEnPantalla["media"]> }) {
  const esImagen = media.mimeType.startsWith("image/")
  const esAudio = media.mimeType.startsWith("audio/")

  if (esImagen) {
    return (
      <a href={media.url} target="_blank" rel="noopener noreferrer" className="mb-1 block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={media.url}
          alt={media.nombreArchivo}
          className="max-h-64 w-auto rounded-lg"
          loading="lazy"
        />
      </a>
    )
  }

  if (esAudio) {
    return <audio controls src={media.url} className="mb-1 w-full max-w-[260px]" />
  }

  return (
    <a
      href={media.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-1 flex items-center gap-2 rounded-lg border bg-background/60 px-2 py-1.5 text-[13px] underline"
    >
      📎 {media.nombreArchivo}
    </a>
  )
}
