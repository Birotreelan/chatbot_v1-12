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
import type { MarcaDelPortal } from "@/lib/portal/marca"

const ESTILO_CAMPO: React.CSSProperties = {
  width: "100%",
  minHeight: 52,
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid #d1d5db",
  fontSize: 16, // 16px o menos hace que iOS zoomee solo al enfocar el campo.
  background: "#fff",
  color: "#111827",
  boxSizing: "border-box",
}

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
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={{ display: "block", fontSize: 14, color: "#374151", marginBottom: 6 }}>
        {etiqueta}
      </span>
      {children}
      {error && (
        <span role="alert" style={{ display: "block", fontSize: 14, color: "#b91c1c", marginTop: 6 }}>
          {error}
        </span>
      )}
    </label>
  )
}

function Boton({
  marca,
  cargando,
  children,
}: {
  marca: MarcaDelPortal
  cargando: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="submit"
      disabled={cargando}
      style={{
        width: "100%",
        minHeight: 56,
        borderRadius: 12,
        border: "none",
        background: cargando ? "#9ca3af" : marca.colorPrimario,
        color: "#fff",
        fontSize: 17,
        fontWeight: 600,
        cursor: cargando ? "default" : "pointer",
      }}
    >
      {cargando ? "Un momento..." : children}
    </button>
  )
}

/** Paso 1: el DNI, solo. */
export function PedirDNI({
  token,
  marca,
  paraFamiliar,
}: {
  token: string
  marca: MarcaDelPortal
  /** El turno es para otra persona: el DNI que va es el de ella. */
  paraFamiliar?: boolean
}) {
  const [dni, setDni] = useState("")
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
    <form onSubmit={enviar} noValidate>
      <Campo
        etiqueta={paraFamiliar ? "DNI de la persona que se atiende" : "Número de DNI"}
        error={error || undefined}
      >
        <input
          // `inputMode="numeric"` abre el teclado numérico en el teléfono sin
          // rechazar un pegado con puntos: el servidor los saca igual.
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={dni}
          onChange={(e) => setDni(e.target.value)}
          placeholder="30123456"
          style={ESTILO_CAMPO}
        />
      </Campo>
      <Boton marca={marca} cargando={cargando}>
        Continuar
      </Boton>
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
  marca,
  paraFamiliar,
}: {
  token: string
  dni?: string
  marca: MarcaDelPortal
  /** Los datos son de la persona que se atiende, no de quien completa. */
  paraFamiliar?: boolean
}) {
  const [nombre, setNombre] = useState("")
  const [apellido, setApellido] = useState("")
  const [email, setEmail] = useState("")
  const [busquedaOS, setBusquedaOS] = useState("")
  const [opcionesOS, setOpcionesOS] = useState<ObraSocial[]>([])
  const [elegida, setElegida] = useState<ObraSocial | null>(null)
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
    <form onSubmit={enviar} noValidate>
      <Campo etiqueta={paraFamiliar ? "Apellido del paciente" : "Apellido"} error={errores.apellido}>
        <input
          autoComplete={paraFamiliar ? "off" : "family-name"}
          autoFocus
          value={apellido}
          onChange={(e) => setApellido(e.target.value)}
          style={ESTILO_CAMPO}
        />
      </Campo>

      <Campo etiqueta={paraFamiliar ? "Nombre del paciente" : "Nombre"} error={errores.nombre}>
        <input
          autoComplete={paraFamiliar ? "off" : "given-name"}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          style={ESTILO_CAMPO}
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
          style={ESTILO_CAMPO}
        />
      </Campo>

      <Campo etiqueta={paraFamiliar ? "Obra social del paciente (opcional)" : "Obra social (opcional)"}>
        <input
          autoComplete="off"
          value={elegida ? elegida.nombre : busquedaOS}
          onChange={(e) => buscarOS(e.target.value)}
          placeholder="Escribí las primeras letras"
          style={ESTILO_CAMPO}
        />
      </Campo>

      {!elegida && opcionesOS.length > 0 && (
        <div style={{ marginTop: -6, marginBottom: 14, display: "flex", flexDirection: "column", gap: 6 }}>
          {opcionesOS.map((os) => (
            <button
              key={os.id}
              type="button"
              onClick={() => {
                setElegida(os)
                setOpcionesOS([])
              }}
              style={{
                textAlign: "left",
                minHeight: 48,
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #e5e7eb",
                background: "#fff",
                fontSize: 15,
                cursor: "pointer",
              }}
            >
              {os.nombre}
              {/* Las que no permiten turnos online se muestran igual, marcadas.
                  Ocultarlas dejaría al paciente buscando la suya sin encontrarla,
                  y terminaría eligiendo una parecida que no es la de él. */}
              {!os.permiteOnline && (
                <span style={{ display: "block", fontSize: 13, color: "#b45309", marginTop: 2 }}>
                  Con esta obra social el turno se saca por teléfono
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {elegida && !elegida.permiteOnline && (
        <p style={{ fontSize: 14, color: "#b45309", margin: "-6px 0 14px" }}>
          Los turnos de {elegida.nombre} se gestionan por teléfono. Si continuás, te vamos a pasar el
          contacto de la clínica.
        </p>
      )}

      {errores.general && (
        <p role="alert" style={{ color: "#b91c1c", fontSize: 14, marginBottom: 12 }}>
          {errores.general}
        </p>
      )}

      <Boton marca={marca} cargando={cargando}>
        Continuar
      </Boton>
    </form>
  )
}
