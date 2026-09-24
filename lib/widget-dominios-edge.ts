/**
 * Los dominios permitidos de un cliente, leídos desde el middleware (24/9/2026).
 *
 * ── Por qué no reusa lib/db ────────────────────────────────────────────────
 *
 * Porque esto corre en el edge, antes de cada request. `lib/db.tsx` arrastra
 * `distributed-lock`, `nanoid` y el resto del módulo: todo eso terminaría en el
 * bundle del middleware, que se ejecuta para CADA petición del sitio. Acá sólo
 * hacen falta dos GETs, así que se hacen los dos GETs.
 *
 * ── Fallar leyendo NO es lo mismo que no tener dominios ────────────────────
 *
 * Esta es la decisión importante del archivo. Si Redis no contesta, la función
 * devuelve `null`, que significa "no sé" — y el llamador deja pasar.
 *
 * La alternativa sería tratar el error como "este cliente no tiene dominios
 * cargados" y bloquear. Suena más seguro y es exactamente el error que venimos
 * sacando del código: tomar la ausencia de información como un hecho positivo.
 * En la práctica significaría que un hipo de Redis apaga el widget de todas las
 * clínicas a la vez, y que nadie entienda por qué. Un widget de más durante
 * treinta segundos es un problema mucho menor.
 *
 * `[]` sí es un hecho: leímos la config y el campo está vacío.
 */

import { Redis } from "@upstash/redis"
import { cacheDeOrigenHabilitado } from "./api-tools/cache-conmutador"

const CONFIG_PREFIX = "whatsapp_config:"
const CLIENTE_TO_CONFIG_PREFIX = "cliente_to_config:"

/**
 * Caché en memoria del worker.
 *
 * El middleware corre en workers que viven un rato, así que esto evita dos
 * GETs por cada carga del iframe. 60 segundos: suficiente para no golpear
 * Redis en cada visita, y poco como para que un cambio de dominios en el
 * dashboard se note casi enseguida.
 */
const CACHE = new Map<string, { dominios: string[] | null; hasta: number }>()
const CACHE_MS = 60_000

let redis: Redis | null = null
function cliente(): Redis | null {
  if (redis) return redis
  try {
    redis = Redis.fromEnv()
    return redis
  } catch {
    return null
  }
}

/**
 * Misma normalización que `widget-domain-validation.ts`, y por el mismo motivo:
 * el campo lo completa una persona copiando la barra del navegador, así que
 * "https://clinica.com/" tiene que valer igual que "clinica.com". Antes no
 * valía, y el resultado era un 403 con el dominio correcto cargado.
 */
export function normalizarHost(host: string): string {
  let valor = String(host || "").trim().toLowerCase()
  if (!valor) return ""
  valor = valor.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^\/\//, "")
  valor = valor.replace(/^[^/@]*@/, "")
  valor = valor.split(/[/?#]/)[0]
  valor = valor.split(":")[0]
  return valor.replace(/\.$/, "").replace(/^www\./, "")
}

/**
 * Los dominios permitidos de un cliente.
 *
 *  - `string[]` con los hosts normalizados (puede venir vacío: el cliente no
 *    cargó ninguno).
 *  - `null` cuando no se pudo averiguar. NO es "ninguno".
 */
export async function dominiosPermitidosDelCliente(clienteId: string): Promise<string[] | null> {
  if (!clienteId) return null

  // El interruptor global también apaga esto: los dominios permitidos se
  // editan en el dashboard, y esperar un minuto para ver si el cambio tomó
  // efecto es justo la duda que el interruptor viene a eliminar.
  const cacheActivo = cacheDeOrigenHabilitado()

  const enCache = cacheActivo ? CACHE.get(clienteId) : undefined
  if (enCache && enCache.hasta > Date.now()) return enCache.dominios

  const r = cliente()
  if (!r) return null

  try {
    const configId = await r.get<string>(`${CLIENTE_TO_CONFIG_PREFIX}${clienteId}`)
    if (!configId) {
      // El índice no existe: puede ser un cliente_id inventado. Eso SÍ es un
      // hecho —no hay config— y se responde con la lista vacía.
      if (cacheActivo) CACHE.set(clienteId, { dominios: [], hasta: Date.now() + CACHE_MS })
      return []
    }

    const crudo = await r.get(`${CONFIG_PREFIX}${configId}`)
    if (!crudo) {
      if (cacheActivo) CACHE.set(clienteId, { dominios: [], hasta: Date.now() + CACHE_MS })
      return []
    }

    const config: any = typeof crudo === "string" ? JSON.parse(crudo) : crudo
    const dominios = String(config?.widgetAllowedDomains || "")
      .split(",")
      .map(normalizarHost)
      .filter(Boolean)

    if (cacheActivo) CACHE.set(clienteId, { dominios, hasta: Date.now() + CACHE_MS })
    return dominios
  } catch (error) {
    console.error("[WIDGET-DOMINIOS] No se pudo leer la configuración:", error)
    return null
  }
}

/**
 * El valor de `frame-ancestors` para este cliente.
 *
 * Un dominio declarado cubre también su `www.` y cualquier subdominio: la
 * clínica que carga "clinica.com" no debería tener que acordarse de listar
 * "www.clinica.com" ni "turnos.clinica.com".
 */
export function frameAncestors(dominios: string[] | null): string {
  // "no sé" → no se restringe. Ver la nota de arriba.
  if (dominios === null) return "*"

  // Sin dominios cargados, nadie puede embeber. `'none'` es lo que dice la
  // especificación para eso.
  if (dominios.length === 0) return "'none'"

  const fuentes = dominios.flatMap((d) => [`https://${d}`, `https://*.${d}`])

  // `'self'` para que el propio dashboard y /demo puedan seguir mostrando el
  // widget: probarlo desde nuestra casa no es el escenario que se restringe.
  return `'self' ${fuentes.join(" ")}`
}
