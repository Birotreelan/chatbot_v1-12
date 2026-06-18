"use client"

import { useState } from "react"

// ─── helpers (réplica de patient-templates.ts) ────────────────────────────────

function normalizeName(name: string): string {
  if (!name) return ""
  return name
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

function getFirstName(fullName: string): string {
  return normalizeName(fullName).split(" ")[0] || "Paciente"
}

function formatearFecha(fecha: string): string {
  try {
    // Agregar T00:00:00 para evitar off-by-one por zona horaria
    const date = new Date(fecha + "T00:00:00")
    return new Intl.DateTimeFormat("es-AR", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date)
  } catch {
    return fecha
  }
}

function formatearHora(hora: string): string {
  if (!hora) return ""
  const parts = hora.split(":")
  return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : hora
}

function formatearProfesional(nombre: string): string {
  if (!nombre) return "el profesional"
  return normalizeName(nombre)
}

function buildBloqueCirugias(turnosQx: any[]): string {
  let bloque = `_Además, registramos ${
    turnosQx.length === 1
      ? "un turno de cirugía agendado"
      : `${turnosQx.length} turnos de cirugía agendados`
  }:_\n\n`

  turnosQx.forEach((qx, idx) => {
    const fecha = formatearFecha(qx.Fecha || qx.fecha)
    const hora = formatearHora(qx.Hora || qx.hora || "")
    const cirugiaName = normalizeName(
      qx.Cirugia_Nombre || qx.cirugia_nombre || qx.Descripcion || "Cirugía"
    )
    const cirujano = formatearProfesional(
      qx.Profesional_Nombre || qx.profesional_nombre || qx.Cirujano || ""
    )

    if (turnosQx.length > 1) bloque += `${idx + 1}. Cirugía: ${cirugiaName}\n`
    else bloque += `Cirugía: ${cirugiaName}\n`
    if (cirujano && cirujano !== "el profesional") bloque += `Cirujano: ${cirujano}\n`
    bloque += `Fecha: ${fecha}${hora ? ` a las ${hora}` : ""}\n`
    if (idx < turnosQx.length - 1) bloque += "\n"
  })

  bloque += `\n_La gestión de turnos quirúrgicos debe realizarse comunicándote directamente con la clínica._\n\n`
  return bloque
}

function buildSingleTurnoGreeting(firstName: string, turno: any, clinicName: string): string {
  const fecha = formatearFecha(turno.Fecha)
  const hora = formatearHora(turno.Hora)
  const profesional = formatearProfesional(turno.Profesional_Nombre)
  const sede = turno.Centro_Nombre || clinicName
  const estaConfirmado = (turno.Estado || "").toLowerCase() === "confirmado"

  let m = `*${firstName}, ¡bienvenido de nuevo a ${clinicName}!*\n\n`
  m += `Soy Iris, tu asistente virtual de inteligencia artificial. Por este canal podrás solicitar, consultar, confirmar asistencia o cancelar turnos médicos.\n\n`

  if (estaConfirmado) {
    m += `*Veo que ya tenés un turno médico agendado y con la asistencia confirmada para el ${fecha} a las ${hora} con ${profesional} en la sede ${sede}.*\n\n`
    m += `¿En qué te podemos ayudar?\n\n`
    m += `1- Confirmar asistencia al turno médico (ya confirmado)\n`
    m += `2- Cancelar el turno médico confirmado\n`
    m += `3- Solicitar otro turno médico\n\n`
  } else {
    m += `*Veo que ya tenés un turno médico agendado para el ${fecha} a las ${hora} con ${profesional} en la sede ${sede}.*\n\n`
    m += `¿En qué te podemos ayudar?\n\n`
    m += `1- Confirmar asistencia al turno médico\n`
    m += `2- Cancelar turno médico\n`
    m += `3- Solicitar otro turno médico\n\n`
  }
  m += `Respondé con el número de opción que prefieras.`
  return m
}

function buildSoloCirugiaGreeting(firstName: string, turnosQx: any[], clinicName: string): string {
  let m = `*${firstName}, ¡bienvenido de nuevo a ${clinicName}!*\n\n`
  m += `Soy Iris, tu asistente virtual de inteligencia artificial. Por este canal podrás solicitar, consultar, confirmar asistencia o cancelar turnos médicos.\n\n`

  if (turnosQx.length === 1) {
    const qx = turnosQx[0]
    const fecha = formatearFecha(qx.Fecha || qx.fecha)
    const hora = formatearHora(qx.Hora || qx.hora || "")
    const cirugiaName = normalizeName(qx.Cirugia_Nombre || qx.Descripcion || "cirugía")
    const cirujano = formatearProfesional(qx.Profesional_Nombre || qx.Cirujano || "")
    m += `*Veo que tenés un turno de cirugía agendado:*\n\n`
    m += `Cirugía: ${cirugiaName}\n`
    if (cirujano && cirujano !== "el profesional") m += `Cirujano: ${cirujano}\n`
    m += `Fecha: ${fecha}${hora ? ` a las ${hora}` : ""}\n\n`
  } else {
    m += `*Veo que tenés ${turnosQx.length} turnos de cirugía agendados:*\n\n`
    turnosQx.forEach((qx, idx) => {
      const fecha = formatearFecha(qx.Fecha || qx.fecha)
      const hora = formatearHora(qx.Hora || qx.hora || "")
      const cirugiaName = normalizeName(qx.Cirugia_Nombre || qx.Descripcion || "cirugía")
      const cirujano = formatearProfesional(qx.Profesional_Nombre || qx.Cirujano || "")
      m += `${idx + 1}. Cirugía: ${cirugiaName}\n`
      if (cirujano && cirujano !== "el profesional") m += `   Cirujano: ${cirujano}\n`
      m += `   Fecha: ${fecha}${hora ? ` a las ${hora}` : ""}\n\n`
    })
  }

  m += `La gestión de turnos quirúrgicos (cancelación, modificación o confirmación) debe realizarse comunicándote directamente con la clínica.\n\n`
  m += `¿En qué más te puedo ayudar?\n\n`
  m += `1- Solicitar un turno médico\n`
  m += `2- Realizar otra consulta\n\n`
  m += `Respondé con el número de opción que prefieras.`
  return m
}

function buildGreeting(scenario: string): string {
  const clinicName = "Salud Ocular"

  const turnoMedico = {
    Fecha: "2026-06-27",
    Hora: "10:30:00",
    Profesional_Nombre: "RODRIGUEZ, Carlos Alberto",
    Centro_Nombre: "Sede Palermo",
    Estado: "",
  }

  const turnoQx = {
    Fecha: "2026-07-15",
    Hora: "08:00:00",
    Cirugia_Nombre: "FACOEMULSIFICACION DE CATARATA",
    Profesional_Nombre: "GARCIA, Luis Fernando",
  }

  if (scenario === "solo_qx") {
    return buildSoloCirugiaGreeting("Amanda", [turnoQx], clinicName)
  }

  if (scenario === "medico_y_qx") {
    let m = buildSingleTurnoGreeting("Amanda", turnoMedico, clinicName)
    const ancla = "Respondé con el número de opción que prefieras."
    const bloque = buildBloqueCirugias([turnoQx])
    const idx = m.lastIndexOf(ancla)
    m = m.slice(0, idx) + bloque + "\n" + m.slice(idx)
    return m
  }

  // solo_medico
  return buildSingleTurnoGreeting("Amanda", turnoMedico, clinicName)
}

// ─── Renderer de formato WhatsApp ─────────────────────────────────────────────

function WhatsAppText({ text }: { text: string }) {
  const lines = text.split("\n")
  return (
    <div className="space-y-0.5">
      {lines.map((line, i) => {
        if (line === "") return <div key={i} className="h-2" />

        // bold: *texto*
        const parts = line.split(/(\*[^*]+\*|_[^_]+_)/)
        return (
          <p key={i} className="leading-relaxed">
            {parts.map((part, j) => {
              if (part.startsWith("*") && part.endsWith("*"))
                return <strong key={j}>{part.slice(1, -1)}</strong>
              if (part.startsWith("_") && part.endsWith("_"))
                return <em key={j} className="text-[#667781]">{part.slice(1, -1)}</em>
              return <span key={j}>{part}</span>
            })}
          </p>
        )
      })}
    </div>
  )
}

// ─── Burbuja WhatsApp ─────────────────────────────────────────────────────────

function WaBubble({ text, time }: { text: string; time: string }) {
  return (
    <div className="flex justify-start">
      <div className="relative max-w-[85%] bg-white rounded-tr-2xl rounded-br-2xl rounded-bl-2xl shadow-sm px-3 py-2">
        <div className="absolute top-0 -left-2 w-0 h-0 border-t-[10px] border-t-white border-l-[10px] border-l-transparent" />
        <div className="text-[14px] text-[#111b21] font-normal">
          <WhatsAppText text={text} />
        </div>
        <div className="flex justify-end mt-1">
          <span className="text-[11px] text-[#667781]">{time}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const SCENARIOS = [
  { id: "solo_qx",      label: "Solo cirugía",            desc: "Sin turnos médicos" },
  { id: "medico_y_qx",  label: "Turno médico + cirugía",  desc: "Ambos tipos juntos" },
  { id: "solo_medico",  label: "Solo turno médico",        desc: "Sin cirugías (control)" },
]

export default function PreviewCirugia() {
  const [active, setActive] = useState("solo_qx")
  const text = buildGreeting(active)
  const current = SCENARIOS.find((s) => s.id === active)!

  return (
    <div className="min-h-screen bg-[#efeae2] font-sans">
      {/* Header */}
      <div className="bg-[#075e54] text-white px-4 py-3 shadow">
        <p className="text-xs uppercase tracking-wider opacity-70 mb-0.5">Preview</p>
        <h1 className="text-base font-semibold">Saludo inicial — Turnos quirúrgicos</h1>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-[#e9edef] px-4 py-2 flex gap-2 flex-wrap">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              active === s.id
                ? "bg-[#075e54] text-white"
                : "bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Descripcion del escenario */}
      <div className="bg-[#d9fdd3] border-b border-[#c3e5bc] px-4 py-2">
        <p className="text-xs text-[#1f7a4d] font-medium">
          Escenario: <span className="font-semibold">{current.label}</span>
          <span className="ml-2 opacity-70">— {current.desc}</span>
        </p>
      </div>

      {/* Chat */}
      <div
        className="px-4 py-6 max-w-md mx-auto space-y-2"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23b2b2b2' fill-opacity='0.07'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
        }}
      >
        {/* Fecha del sistema */}
        <div className="flex justify-center">
          <span className="bg-white/80 text-[#54656f] text-[11px] px-3 py-1 rounded-full shadow-sm">
            hoy
          </span>
        </div>

        {/* Burbuja del bot */}
        <WaBubble text={text} time="10:32" />
      </div>

      {/* Input bar decorativo */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#f0f2f5] px-3 py-2 flex items-center gap-2 border-t border-[#e9edef]">
        <div className="flex-1 bg-white rounded-full px-4 py-2 text-sm text-[#8696a0]">
          Escribí un mensaje...
        </div>
        <div className="w-10 h-10 rounded-full bg-[#00a884] flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </div>
      </div>

      {/* Padding para el input bar fijo */}
      <div className="h-16" />
    </div>
  )
}
