/**
 * El interruptor del caché de datos del origen (24/9/2026).
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * Durante el desarrollo se cambian cosas en el sistema de la clínica todo el
 * tiempo: se agrega una especialidad, se corrige el nombre de una sede, se da
 * de alta un profesional. Con caché, esos cambios tardan entre cinco minutos y
 * una hora en verse, y mientras tanto uno no sabe si lo que está mirando es un
 * bug o una respuesta vieja. Se pierde más tiempo dudando del caché que
 * programando.
 *
 * ── Un solo interruptor, no una decisión por llamada ───────────────────────
 *
 * `fetchProxyApi` ya tenía un parámetro `useCache` por llamada, y las sedes
 * tienen su propio caché aparte. Apagar todo a mano sería tocar una docena de
 * lugares y, sobre todo, volver a encenderlo después sería arqueología: habría
 * que acordarse de cuáles eran cacheables y cuáles no.
 *
 * Por eso esto es una compuerta global que se consulta en cada punto de caché.
 * Encenderlo de nuevo es cambiar una variable de entorno, no revisar el código.
 *
 * ── El default es SIN caché, a propósito ───────────────────────────────────
 *
 * Es el estado que se necesita hoy, y el error de tenerlo apagado de más es
 * visible y barato: más llamadas al proxy, algo más lento. El error inverso
 * —quedar cacheando cuando alguien pensaba que no— es invisible y hace perder
 * horas persiguiendo fantasmas.
 *
 * Para encenderlo, en las variables de entorno de Vercel:
 *
 *     CACHE_ORIGEN_HABILITADO=true
 *
 * ── Qué NO controla ────────────────────────────────────────────────────────
 *
 * Nada que no sea un dato del sistema de la clínica. Los locks de Redis, el
 * estado de las conversaciones y los tokens del portal no son caché: son el
 * dato en sí. Apagarlos rompería el bot, no lo haría más fresco.
 */

/**
 * `true` sólo con la variable puesta explícitamente en "true" o "1".
 *
 * Se lee en cada llamada y no una sola vez al cargar el módulo: en Vercel los
 * workers viven un rato largo, y leer la variable al arranque haría que
 * cambiarla en el panel no tenga efecto hasta el próximo despliegue.
 */
export function cacheDeOrigenHabilitado(): boolean {
  const valor = (process.env.CACHE_ORIGEN_HABILITADO || "").trim().toLowerCase()
  return valor === "true" || valor === "1"
}
