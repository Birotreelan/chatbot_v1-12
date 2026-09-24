"use client"

/**
 * Las dos pantallas en las que el paciente dice quién es (23/9/2026).
 *
 * ── Por qué estas SÍ llevan JavaScript ─────────────────────────────────────
 *
 * Los pasos de filtro son enlaces a propósito (ver `elegir-filtro.tsx`):
 * funcionan sin JS y el botón "atrás" hace lo esperable. Acá no se puede: los
 * datos son personales y no pueden viajar por la query string, así que hay que
 * mandarlos por POST. Lo que sí se conserva de aquel criterio es que el campo
 * mantenga lo escrito si algo falla — reescribir el DNI porque el servidor
 * tardó es la clase de fricción que hace abandonar.
 *
 * ── El orden: DNI, después el resto ────────────────────────────────────────
 *
 * Primero el DNI solo, porque la mayoría de los pacientes YA tienen ficha
 * aunque el bot no los haya reconocido por su teléfono (escribieron desde el
 * celular de un hijo, cambiaron de número, la clínica tiene otro cargado).
 * Para esos, pedirles nombre, apellido y email antes de buscar sería hacerlos
 * tipear cuatro campos que la clínica ya tiene.
 */

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Aviso, BotonPrimario } from "./marco"

// 16px o más en el campo: con menos, iOS hace zoom solo al enfocarlo y el
// paciente queda con la pantalla corrida.
const CLASES_CAMPO =
  "w-full rounded-xl border border-gray-300 bg-white px-4 py-3.5 text-base text-gray-900 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-200"

function Campo({
  etiqueta,
  error,
  children,
}: {
  etiqueta: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-700">{etiqueta}</span>
      {children}
      {error && (
        <span role="alert" className="mt-1.5 block text-sm text-red-700">
          {error}
        </span>
      )}
    </label>
  )
}

function Enviando({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> {children}
    </span>
  )
}

/** Paso 1: el DNI, solo. */
export function PedirDNI({
  token,
  paraFamiliar,
  valorInicial,
}: {
  token: string
  /** El turno es para otra persona: el DNI que va es el de ella. */
  paraFamiliar?: boolean
  /**
   * Lo ya cargado, cuando el paciente volvió para corregirlo.
   *
   * Sin esto, "volver a corregir el DNI" sería volver a tipearlo entero — y el
   * que vuelve normalmente quiere cambiar un dígito.
   */
  valorInicial?: string
}) {
  const [dni, setDni] = useState(valorInicial || "")
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setCargando(true)
    setError(null)
    try {
      const r = await fetch("/api/portal/identificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, accion: "dni", dni }),
      })
      const data = await r.json()
      if (data.ok) {
        // Recarga la página, que vuelve a decidir el paso con la identidad ya
        // guardada. Así la lógica de "qué sigue" vive en un solo lugar
        // (`decidirPaso`) y no se duplica acá.
        window.location.href = `/p/${token}`
        return
      }
      setError(data.errores?.dni || data.error || "No pudimos validar el DNI.")
    } catch {
      setError("No pudimos conectarnos. Revisá tu señal y probá de nuevo.")
    } finally {
      setCargando(false)
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="space-y-4">
      <Campo etiqueta={paraFamiliar ? "DNI de la persona que se atiende" : "Número de DNI"}>
        <input
          // `inputMode="numeric"` abre el teclado numérico en el teléfono sin
          // rechazar un pegado con puntos: el servidor los saca igual.
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={dni}
          onChange={(e) => setDni(e.target.value)}
          placeholder="30123456"
          className={CLASES_CAMPO}
        />
      </Campo>

      {error && <Aviso titulo="Revisá el DNI" detalle={error} tono="error" />}

      <BotonPrimario type="submit" deshabilitado={cargando}>
        {cargando ? <Enviando>Buscando…</Enviando> : "Continuar"}
      </BotonPrimario>
    </form>
  )
}

interface ObraSocial {
  id: string
  nombre: string
  permiteOnline: boolean
}

/** Paso 2: sólo para quien no tiene ficha. */
export function DarseDeAlta({
  token,
  dni,
  paraFamiliar,
  valoresIniciales,
}: {
  token: string
  dni?: string
  /** Los datos son de la persona que se atiende, no de quien completa. */
  paraFamiliar?: boolean
  /** Lo ya cargado, cuando el paciente volvió a corregir algo. */
  valoresIniciales?: {
    nombre?: string
    apellido?: string
    email?: string
    obraSocialId?: string
    obraSocialNombre?: string
  }
}) {
  const [nombre, setNombre] = useState(valoresIniciales?.nombre || "")
  const [apellido, setApellido] = useState(valoresIniciales?.apellido || "")
  const [email, setEmail] = useState(valoresIniciales?.email || "")
  const [busquedaOS, setBusquedaOS] = useState("")
  const [opcionesOS, setOpcionesOS] = useState<ObraSocial[]>([])
  const [elegida, setElegida] = useState<ObraSocial | null>(
    valoresIniciales?.obraSocialId && valoresIniciales?.obraSocialNombre
      ? {
          id: valoresIniciales.obraSocialId,
          nombre: valoresIniciales.obraSocialNombre,
          // La que ya estaba guardada pasó el chequeo del servidor cuando se
          // guardó; si estuviera bloqueada, el paciente no habría llegado acá.
          permiteOnline: true,
        }
      : null,
  )
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [cargando, setCargando] = useState(false)

  async function buscarOS(texto: string) {
    setBusquedaOS(texto)
    setElegida(null)
    if (texto.trim().length < 2) {
      setOpcionesOS([])
      return
    }
    try {
      const r = await fetch(
        `/api/portal/obras-sociales?token=${encodeURIComponent(token)}&q=${encodeURIComponent(texto)}`,
      )
      const data = await r.json()
      setOpcionesOS(Array.isArray(data.opciones) ? data.opciones : [])
    } catch {
      setOpcionesOS([])
    }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setCargando(true)
    setErrores({})
    try {
      const r = await fetch("/api/portal/identificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          accion: "alta",
          dni,
          nombre,
          apellido,
          email,
          obraSocialId: elegida?.id,
          obraSocialNombre: elegida?.nombre,
        }),
      })
      const data = await r.json()
      if (data.ok) {
        window.location.href = `/p/${token}`
        return
      }
      setErrores(data.errores || { general: data.error || "Revisá los datos." })
    } catch {
      setErrores({ general: "No pudimos conectarnos. Revisá tu señal y probá de nuevo." })
    } finally {
      setCargando(false)
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="space-y-4">
      <Campo etiqueta={paraFamiliar ? "Apellido del paciente" : "Apellido"} error={errores.apellido}>
        <input
          // Para un familiar el navegador NO debe autocompletar con los datos
          // del titular del teléfono: sería exactamente el error a evitar.
          autoComplete={paraFamiliar ? "off" : "family-name"}
          autoFocus
          value={apellido}
          onChange={(e) => setApellido(e.target.value)}
          className={CLASES_CAMPO}
        />
      </Campo>

      <Campo etiqueta={paraFamiliar ? "Nombre del paciente" : "Nombre"} error={errores.nombre}>
        <input
          autoComplete={paraFamiliar ? "off" : "given-name"}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className={CLASES_CAMPO}
        />
      </Campo>

      <Campo etiqueta={paraFamiliar ? "Email de contacto" : "Email"} error={errores.email}>
        <input
          type="email"
          inputMode="email"
          autoComplete={paraFamiliar ? "off" : "email"}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nombre@ejemplo.com"
          className={CLASES_CAMPO}
        />
      </Campo>

      <Campo etiqueta={paraFamiliar ? "Obra social del paciente (opcional)" : "Obra social (opcional)"}>
        <input
          autoComplete="off"
          value={elegida ? elegida.nombre : busquedaOS}
          onChange={(e) => buscarOS(e.target.value)}
          placeholder="Escribí las primeras letras"
          className={CLASES_CAMPO}
        />
      </Campo>

      {!elegida && opcionesOS.length > 0 && (
        <div className="-mt-2 space-y-2">
          {opcionesOS.map((os) => (
            <button
              key={os.id}
              type="button"
              onClick={() => {
                setElegida(os)
                setOpcionesOS([])
              }}
              className="min-h-[52px] w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-left text-[15px]"
            >
              {os.nombre}
              {/* Las que no permiten turnos online se muestran igual, marcadas.
                  Ocultarlas dejaría al paciente buscando la suya sin encontrarla,
                  y terminaría eligiendo una parecida que no es la de él. */}
              {!os.permiteOnline && (
                <span className="mt-0.5 block text-[13px] text-amber-700">
                  Con esta obra social el turno se saca por teléfono
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {elegida && !elegida.permiteOnline && (
        <Aviso
          titulo={`Los turnos de ${elegida.nombre} se gestionan por teléfono`}
          detalle="Si continuás, te vamos a pasar el contacto de la clínica."
          tono="atencion"
        />
      )}

      {errores.general && <Aviso titulo="No pudimos guardar tus datos" detalle={errores.general} tono="error" />}

      <BotonPrimario type="submit" deshabilitado={cargando}>
        {cargando ? <Enviando>Guardando…</Enviando> : "Continuar"}
      </BotonPrimario>
    </form>
  )
}
