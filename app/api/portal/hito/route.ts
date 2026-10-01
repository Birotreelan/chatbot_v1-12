/**
 * Los hitos del recorrido por el portal (1/10/2026).
 *
 * Antes era `app/api/portal/visto/route.ts` y anotaba una sola cosa: que el
 * enlace se había abierto. Se generalizó al agregar el segundo hito —que la
 * agenda no tuviera horarios para ofrecerle—, porque la alternativa era una
 * ruta por hito con el mismo cuerpo copiado.
 *
 * ── Para qué ───────────────────────────────────────────────────────────────
 *
 * El portal sacó al paciente de WhatsApp, y desde el panel eso se ve como un
 * silencio: se mandó un enlace y después no pasa nada hasta que reserva o
 * cancela. Estas líneas convierten ese silencio en algo legible: no abrió,
 * abrió y abandonó, abrió y no había turnos, abrió y gestionó.
 *
 * ── Por qué la llama el navegador y no la página ───────────────────────────
 *
 * Las pantallas son Server Components: podrían anotarlo al renderizar, sin
 * esta ruta. Pero entonces contaría como "el paciente entró" cualquier cosa
 * que siga la URL —un escáner de enlaces, un antivirus corporativo, un
 * proxy—, porque todos reciben el mismo HTML.
 *
 * Que el aviso venga del navegador exige que alguien haya ejecutado
 * JavaScript, que es la evidencia más barata de que del otro lado hay una
 * persona. No es infalible; es mucho mejor que lo otro.
 *
 * Y por eso también el fallo es silencioso: esto es telemetría. Si Redis no
 * está o el token venció, el paciente no tiene que enterarse de nada.
 */

import { NextResponse } from "next/server"

import { marcarVisto, marcarHito } from "@/lib/portal/token"
import { anotarEnElMonitor, TEXTO_DEL_HITO, type HitoDelPortal } from "@/lib/portal/monitor"

export const runtime = "nodejs"

/**
 * Sólo se aceptan los hitos que conocemos.
 *
 * El `hito` llega del navegador, o sea de donde llega cualquier cosa. Sin esta
 * lista, un pedido armado a mano escribiría el texto que quisiera en la
 * conversación de un paciente — y el panel lo mostraría con el prefijo
 * `[Portal]`, que es justamente el que da a entender que lo escribimos
 * nosotros.
 */
function esHitoConocido(valor: string): valor is HitoDelPortal {
  return Object.prototype.hasOwnProperty.call(TEXTO_DEL_HITO, valor)
}

export async function POST(request: Request) {
  let token = ""
  let hito = "abierto"
  try {
    const cuerpo = await request.json()
    token = String(cuerpo?.token || "")
    hito = String(cuerpo?.hito || "abierto")
  } catch {
    // Body ilegible: no hay nada que anotar y nada que avisar.
  }

  if (!token || !esHitoConocido(hito)) return NextResponse.json({ ok: true })

  try {
    // `abierto` sigue usando `marcarVisto` y su propio campo: el contexto lo
    // lee en otros lados para decidir, no sólo para informar.
    const marca = hito === "abierto" ? await marcarVisto(token) : await marcarHito(token, hito)

    // Ya estaba marcado, o el enlace no existe. En los dos casos, nada que
    // escribir: el panel no tiene que mostrar una línea por cada recarga.
    if (!marca?.primera) return NextResponse.json({ ok: true })

    const { contexto } = marca
    const textos = TEXTO_DEL_HITO[hito]

    await anotarEnElMonitor({
      configId: contexto.configId,
      phoneNumber: contexto.phone,
      texto: contexto.demo ? textos.demo : textos.real,
    })

    console.log(`[PORTAL] ${contexto.phone} — hito "${hito}" (${contexto.intencion})`)
  } catch (error) {
    console.error(`[PORTAL] No se pudo anotar el hito "${hito}":`, error)
  }

  return NextResponse.json({ ok: true })
}
