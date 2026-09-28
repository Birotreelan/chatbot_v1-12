/**
 * Lo que se ve mientras el portal piensa (28/9/2026).
 *
 * ── Por qué esto importa más que el `Link` ─────────────────────────────────
 *
 * Pasar los pasos de `<a>` a `Link` saca la recarga del documento, pero trae
 * un problema peor si se hace a medias: en el App Router, una navegación del
 * lado del cliente a una ruta dinámica deja la pantalla ANTERIOR congelada
 * hasta que el servidor responde. Y este portal le pregunta a la clínica en
 * casi todos los pasos —sedes, especialidades, profesionales, agenda—, con
 * respuestas que tardan segundos.
 *
 * O sea: el paciente toca "Volver", no pasa absolutamente nada durante tres
 * segundos, y vuelve a tocar. Eso es peor que el parpadeo que veníamos de
 * sacar, porque el parpadeo al menos era una señal de que el toque se
 * registró.
 *
 * Este archivo crea el límite de Suspense que resuelve eso: apenas se toca
 * algo, aparece esta pantalla. El paciente ve que su toque hizo algo.
 *
 * Sirve además para la primera carga, que es el momento más frágil de todos:
 * alguien que acaba de salir de WhatsApp y todavía no vio nada de este sitio.
 * Una pestaña en blanco ahí es alguien que vuelve al chat.
 *
 * ── Por qué no dice el nombre de la clínica ────────────────────────────────
 *
 * Porque todavía no se leyó el token y no lo sabemos. Se muestra la banda con
 * el color y la forma que va a tener, sin texto: cuando llega el contenido,
 * lo único que cambia es que aparecen las letras. Poner un nombre inventado
 * —o "Cargando…"— haría que la pantalla se reacomode al llegar el verdadero.
 */

import { CalendarDays } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"

export default function Cargando() {
  return (
    <div className="portal flex min-h-screen flex-col bg-background text-foreground">
      <header
        className="sticky top-0 z-10 flex items-center gap-3 bg-primary/95 px-4 py-4 text-primary-foreground"
        style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}
      >
        <CalendarDays className="h-6 w-6 shrink-0" aria-hidden />
        <div className="min-w-0 space-y-1.5">
          <Skeleton className="h-4 w-40 bg-primary-foreground/30" />
          <Skeleton className="h-3 w-24 bg-primary-foreground/20" />
        </div>
      </header>

      <main
        className="mx-auto w-full max-w-[560px] flex-1 space-y-4 px-4 pb-12 pt-5"
        // El lector de pantalla tiene que enterarse de que está esperando; la
        // animación no le dice nada.
        role="status"
        aria-live="polite"
        aria-label="Cargando"
      >
        {/* La forma del título de paso: círculo del ícono y una línea. */}
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <Skeleton className="h-5 w-56" />
        </div>

        {/* Y la de las opciones, que es lo que hay en casi todos los pasos. */}
        <Skeleton className="h-[60px] w-full rounded-xl" />
        <Skeleton className="h-[60px] w-full rounded-xl" />
        <Skeleton className="h-[60px] w-full rounded-xl" />
      </main>
    </div>
  )
}
