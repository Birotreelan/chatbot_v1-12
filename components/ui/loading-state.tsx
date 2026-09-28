/**
 * El "cargando" del sistema (28/9/2026).
 *
 * Existe porque el markup del spinner estaba copiado en cada pantalla que
 * espera algo, y copiado quiere decir distinto: en una el ícono medía 20px y
 * en otra 16, en una había etiqueta y en otra no. Nada de eso es una decisión,
 * es lo que quedó.
 *
 * Tres formas, que son las tres situaciones reales:
 *
 *  - en línea, para el texto adentro de un botón que está esperando;
 *  - en bloque, para una sección que todavía no tiene contenido;
 *  - `fullScreen`, para una pantalla entera antes del primer dato.
 *
 * `label` no es opcional por capricho: un spinner sin texto le dice al usuario
 * que espere sin decirle qué. Cuando se omite queda igual el `aria-label` para
 * quien usa lector de pantalla, que si no escucha nada.
 */

import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

export function LoadingState({
  label,
  fullScreen = false,
  inline = false,
  className,
}: {
  label?: string
  fullScreen?: boolean
  inline?: boolean
  className?: string
}) {
  const spinner = (
    <Loader2
      className={cn("animate-spin text-muted-foreground", inline ? "h-5 w-5" : "h-6 w-6")}
      aria-hidden
    />
  )

  const contenido = (
    <span
      className={cn(
        "flex items-center gap-2 text-muted-foreground",
        inline ? "" : "flex-col justify-center py-8",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label={label || "Cargando"}
    >
      {spinner}
      {label && <span className={inline ? "" : "text-[15px]"}>{label}</span>}
    </span>
  )

  if (!fullScreen) return contenido

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">{contenido}</div>
  )
}
