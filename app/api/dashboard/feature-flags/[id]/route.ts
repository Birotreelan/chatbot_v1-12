/**
 * Los flags de atención humana de UN cliente, para el dashboard (14/10/2026).
 *
 * ── Por qué esta ruta no existía y había que crearla ───────────────────────
 *
 * `components/dashboard/whatsapp-config-form.tsx` le viene pegando a
 * `/api/dashboard/feature-flags/<id>` desde que se agregó el toggle de
 * Atención Humana al formulario. La ruta nunca se creó: sólo estaban la global
 * (`../route.ts`) y la de auditoría (`../clients/route.ts`), así que el fetch
 * devolvía 404, `data.flags` quedaba `undefined` y el formulario se quedaba con
 * su estado inicial — `humanSupport: false` — para TODOS los clientes.
 *
 * Síntomas que eso producía, los dos silenciosos:
 *
 *  - El toggle "Atención humana habilitada" del dashboard se mostraba apagado
 *    aunque la clínica lo tuviera encendido desde su propio panel.
 *  - Encenderlo desde el dashboard tampoco hacía nada: el POST también caía en
 *    404 y `fetch` no lanza con un 404, así que ni el toast de error aparecía.
 *    El switch se movía en pantalla y nada más.
 *
 * Lo destapó el switch nuevo de "Ofrecer el teléfono al paciente", que se
 * bloquea cuando la atención humana está apagada: apareció bloqueado en un
 * cliente que la tiene encendida.
 *
 * ── Qué se lee y qué se escribe ────────────────────────────────────────────
 *
 * Se LEE el resultado efectivo (`getEffectiveFeatureFlags`): es lo que ve el
 * bot. Leer el override crudo del cliente mostraría apagado lo que está
 * encendido por global o por código, que es justo la confusión que esto viene a
 * arreglar.
 *
 * Se ESCRIBE un override PARCIAL (`setClientFeatureFlags`), sólo de las dos
 * claves que la clínica controla. Es el mismo contrato que usa su panel
 * (`app/api/support/settings/route.ts`), y por eso las dos pantallas no se
 * pisan. Guardar un snapshot completo es el error que ya se pagó una vez con
 * Filomena —ver la cabecera de `../clients/route.ts`—: congelaba al cliente en
 * los valores de ese día, afuera de toda mejora posterior.
 *
 * ── Lo que esta ruta NO hace ───────────────────────────────────────────────
 *
 * Apagar `humanSupport` desde el panel de la clínica además cierra las sesiones
 * abiertas (ver el bloque del 25/8/2026 en support/settings). Acá no se
 * replica: ese efecto lo dispara el control maestro de la clínica y duplicarlo
 * desde el dashboard daría dos lugares que cierran sesiones con criterios que
 * pueden separarse. Si hace falta, se extrae a una función compartida y la
 * llaman los dos.
 */

import { type NextRequest, NextResponse } from "next/server"
import {
  getEffectiveFeatureFlags,
  setClientFeatureFlags,
  getRawClientFlags,
  clearFeatureFlagsCache,
} from "@/lib/conversation-state/feature-flags"
import { getWhatsAppConfig } from "@/lib/db"
import type { FeatureFlags } from "@/lib/conversation-state/types"

export const dynamic = "force-dynamic"

/** Las dos únicas claves que se pueden tocar por cliente. Igual que en su panel. */
const CLAVES_DEL_CLIENTE = ["humanSupport", "humanSupportOfferToPatient"] as const
type ClaveDelCliente = (typeof CLAVES_DEL_CLIENTE)[number]

function esClaveDelCliente(clave: string): clave is ClaveDelCliente {
  return (CLAVES_DEL_CLIENTE as readonly string[]).includes(clave)
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const config = await getWhatsAppConfig(id)
    if (!config) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })
    }

    const flags = await getEffectiveFeatureFlags(id)

    return NextResponse.json({
      configId: id,
      flags,
      // El override propio, para poder distinguir "lo eligió la clínica" de
      // "lo hereda de global o del código". El formulario hoy no lo usa; el
      // dato cuesta una lectura de Redis y ahorra un diagnóstico entero.
      rawFlags: await getRawClientFlags(id),
      clientControlledKeys: CLAVES_DEL_CLIENTE,
    })
  } catch (error) {
    console.error(`[API feature-flags/${id}] Error leyendo flags del cliente:`, error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const config = await getWhatsAppConfig(id)
    if (!config) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })
    }

    const body = await request.json().catch(() => null)
    const entrantes = body?.flags

    if (!entrantes || typeof entrantes !== "object") {
      return NextResponse.json({ error: "Body debe incluir { flags: {...} }" }, { status: 400 })
    }

    const aGuardar: Partial<FeatureFlags> = {}
    const rechazadas: string[] = []

    for (const [clave, valor] of Object.entries(entrantes)) {
      if (!esClaveDelCliente(clave) || typeof valor !== "boolean") {
        rechazadas.push(clave)
        continue
      }
      aGuardar[clave] = valor
    }

    // Se rechaza en vez de ignorar en silencio: un flag mal escrito que "se
    // guarda" y no hace nada es exactamente el tipo de falla que costó este
    // diagnóstico.
    if (rechazadas.length > 0) {
      return NextResponse.json(
        {
          error: `Sólo se pueden cambiar por cliente: ${CLAVES_DEL_CLIENTE.join(", ")}`,
          rechazadas,
        },
        { status: 400 },
      )
    }

    if (Object.keys(aGuardar).length === 0) {
      return NextResponse.json({ error: "No hay flags para guardar" }, { status: 400 })
    }

    await setClientFeatureFlags(id, aGuardar)
    // El bot cachea los flags efectivos unos minutos. Sin esto, la clínica
    // apaga la atención humana y el bot sigue ofreciéndola hasta que venza.
    clearFeatureFlagsCache()

    const flags = await getEffectiveFeatureFlags(id)
    console.info(
      `[API feature-flags/${id}] ${Object.entries(aGuardar)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")} (${config.displayName || id})`,
    )

    return NextResponse.json({ configId: id, flags, rawFlags: await getRawClientFlags(id) })
  } catch (error) {
    console.error(`[API feature-flags/${id}] Error guardando flags del cliente:`, error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
