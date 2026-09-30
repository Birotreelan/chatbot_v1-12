"use client"

/**
 * Un enlace que avisa que está trabajando (30/9/2026).
 *
 * ── Por qué `loading.tsx` no alcanza ───────────────────────────────────────
 *
 * El portal tiene un límite de Suspense —`app/p/[token]/loading.tsx`— que
 * muestra un esqueleto mientras el servidor responde. Funciona en la primera
 * carga y no hace nada en los pasos siguientes, y el motivo es que TODOS los
 * pasos son la misma ruta: `/p/[token]` con otra query string. Next no
 * remonta el segmento cuando sólo cambian los parámetros, así que el límite
 * no se vuelve a disparar y la pantalla se queda como está.
 *
 * El resultado, que es lo que se reportó: el paciente toca "Un profesional en
 * particular", el servidor tarda unos segundos en traer la lista de la
 * clínica, y en la pantalla no pasa absolutamente nada. Vuelve a tocar.
 *
 * ── La señal va en lo que tocó ─────────────────────────────────────────────
 *
 * `startTransition` + `router.push` deja `pendiente` en true hasta que llega
 * la pantalla nueva. Se usa para marcar LA opción que el paciente tocó, no
 * para tapar todo con un spinner: así ve que el sistema registró su toque, y
 * cuál fue.
 *
 * Sigue siendo un `<a>` de verdad, con su `href`: el botón "atrás" del
 * teléfono lo entiende, se puede abrir en otra pestaña, y si el JavaScript no
 * llegó a cargar el clic navega igual por el camino de siempre.
 */

import { useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

export function EnlaceDePaso({
  href,
  className,
  children,
}: {
  href: string
  className?: string
  children: ReactNode
}) {
  const router = useRouter()
  const [pendiente, iniciarTransicion] = useTransition()

  return (
    <Link
      href={href}
      onClick={(evento) => {
        // Los clics con modificadores —rueda, Ctrl, Cmd— abren en otra
        // pestaña. Interceptarlos rompería eso sin ganar nada.
        if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.button !== 0) return

        evento.preventDefault()
        iniciarTransicion(() => router.push(href))
      }}
      aria-busy={pendiente || undefined}
      className={cn(className, pendiente && "opacity-70")}
    >
      {children}
      {pendiente && (
        <Loader2
          className="ml-auto h-5 w-5 shrink-0 animate-spin text-muted-foreground"
          aria-label="Cargando"
        />
      )}
    </Link>
  )
}
