/**
 * El paciente dice quién es (23/9/2026).
 *
 * Dos acciones sobre el mismo contexto:
 *
 *  - `dni`: busca la ficha. Si existe, se completan nombre y obra social y el
 *    portal sigue derecho a la agenda. Si no existe, el paso siguiente es el
 *    alta.
 *  - `alta`: guarda los datos del paciente nuevo. NO crea la ficha todavía —
 *    eso lo hace `reservarTurno` al confirmar el turno, en una sola operación.
 *    Crear la ficha acá dejaría pacientes dados de alta que nunca sacaron
 *    turno, ensuciando la base de la clínica con gente que abandonó a mitad.
 *
 * ── La autorización es el token, otra vez ──────────────────────────────────
 *
 * Igual que en `gestionar`: no hay login. Lo que acota el daño es que un token
 * sirve para una gestión y vence en 30 minutos. Por eso esta ruta escribe
 * ÚNICAMENTE dentro de `contexto.identidad` — no acepta un `clienteId` ni un
 * `configId` del cuerpo, que saldrían del lado del cliente y permitirían
 * apuntar el enlace a otra clínica.
 */

import { NextResponse } from "next/server"
import { leerEnlace, guardarIdentidad } from "@/lib/portal/token"
import { permiteGestionar } from "@/lib/portal/vigencia"
import {
  normalizarDNI,
  validarAlta,
  resolverPorDNI,
  estaBloqueadaLaObraSocial,
} from "@/lib/portal/identidad"

export const runtime = "nodejs"

export async function POST(request: Request) {
  let cuerpo: any
  try {
    cuerpo = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 })
  }

  const token = String(cuerpo.token || "")
  if (!token) return NextResponse.json({ ok: false, error: "Faltan datos" }, { status: 400 })

  const lectura = await leerEnlace(token)
  if (!lectura) {
    return NextResponse.json({ ok: false, error: "Este enlace ya no está disponible." }, { status: 404 })
  }

  const { contexto, estado } = lectura

  if (!permiteGestionar(estado)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          estado === "gestionado"
            ? contexto.resultado?.texto || "Esta gestión ya se hizo."
            : "El plazo para gestionar por acá terminó. Escribinos por WhatsApp.",
      },
      { status: 409 },
    )
  }

  if (!contexto.clienteId) {
    return NextResponse.json({ ok: false, error: "Configuración incompleta" }, { status: 500 })
  }

  // ── Paso 1: el DNI ────────────────────────────────────────────────────────
  if (cuerpo.accion === "dni") {
    const dni = normalizarDNI(cuerpo.dni)
    if (!dni) {
      return NextResponse.json(
        { ok: false, errores: { dni: "Revisá el DNI: van sólo los números, sin puntos." } },
        { status: 400 },
      )
    }

    const identidad = await resolverPorDNI(contexto.clienteId, dni)

    // `null` = la búsqueda falló. No es lo mismo que "no tiene ficha", y la
    // diferencia importa: seguir al alta crearía un duplicado de alguien que sí
    // existe. Se le pide que reintente.
    if (!identidad) {
      return NextResponse.json(
        {
          ok: false,
          reintentar: true,
          error: "No pudimos consultar tus datos en este momento. Probá de nuevo en un minuto.",
        },
        { status: 502 },
      )
    }

    await guardarIdentidad(token, identidad)

    return NextResponse.json({
      ok: true,
      tieneFicha: identidad.tieneFicha === true,
      obraSocialBloqueada: identidad.obraSocialBloqueada === true,
    })
  }

  // ── Paso 2: el alta ───────────────────────────────────────────────────────
  if (cuerpo.accion === "alta") {
    // El DNI vuelve a validarse acá aunque ya haya pasado por el paso 1. Esta
    // ruta es pública: el paso 1 no es un requisito que se pueda dar por hecho.
    const validacion = validarAlta({
      dni: cuerpo.dni ?? contexto.identidad?.dni,
      nombre: cuerpo.nombre,
      apellido: cuerpo.apellido,
      email: cuerpo.email,
    })

    if (!validacion.ok) {
      return NextResponse.json({ ok: false, errores: validacion.errores }, { status: 400 })
    }

    const obraSocialId = cuerpo.obraSocialId ? String(cuerpo.obraSocialId) : undefined
    const obraSocialNombre = cuerpo.obraSocialNombre ? String(cuerpo.obraSocialNombre) : undefined

    // El chequeo se rehace del lado del servidor. La pantalla ya marca las
    // obras sociales que no permiten turnos online, pero eso es una ayuda
    // visual, no un control: el cuerpo de este POST lo arma el cliente.
    const bloqueada = await estaBloqueadaLaObraSocial(
      contexto.clienteId,
      obraSocialNombre,
      obraSocialId,
    )

    await guardarIdentidad(token, {
      ...validacion.datos,
      fichaConsultada: true,
      tieneFicha: false,
      obraSocialId,
      obraSocialNombre,
      obraSocialBloqueada: bloqueada,
    })

    return NextResponse.json({ ok: true, obraSocialBloqueada: bloqueada === true })
  }

  return NextResponse.json({ ok: false, error: "Acción desconocida" }, { status: 400 })
}
