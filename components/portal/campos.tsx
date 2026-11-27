"use client"

/**
 * Las piezas compartidas de los formularios del portal (27/11/2026).
 *
 * Estaban dentro de `identificarse.tsx`, que era su único usuario. Salieron
 * cuando apareció el segundo —la pantalla para corregir la cobertura— y la
 * alternativa era copiarlas: el campo tiene decisiones adentro (16px para que
 * iOS no haga zoom, 52px de alto mínimo para el pulgar) y dos copias se separan
 * en el primer ajuste.
 */

import { LoadingState } from "@/components/ui/loading-state"

/**
 * 16px o más en el campo: con menos, iOS hace zoom solo al enfocarlo y el
 * paciente queda con la pantalla corrida.
 */
export const CLASES_CAMPO =
  "w-full rounded-xl border border-input bg-background px-4 py-3.5 text-base text-foreground sm:py-3 outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

/**
 * Una fila tocable de una lista de opciones.
 *
 * Las dos listas de obras sociales —la del catálogo y la de la búsqueda contra
 * el proxy— tienen que verse iguales: es la misma acción, elegir una obra
 * social, y que cambie de aspecto según de dónde salió la lista no significa
 * nada para el paciente. Cada lista le agrega lo suyo: la del catálogo va
 * dentro de un recuadro, así que no lleva borde propio.
 */
export const CLASES_OPCION =
  "min-h-[52px] w-full rounded-xl px-4 py-3 text-left text-[15px] transition-colors hover:bg-accent sm:min-h-[48px] sm:px-5 sm:text-base"

export function Campo({
  etiqueta,
  error,
  children,
}: {
  etiqueta: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">{etiqueta}</span>
      {children}
      {error && (
        <span role="alert" className="mt-1.5 block text-sm text-destructive">
          {error}
        </span>
      )}
    </label>
  )
}

export function Enviando({ children }: { children: React.ReactNode }) {
  return <LoadingState inline label={typeof children === "string" ? children : undefined} />
}

/**
 * Para comparar lo que el paciente escribe con el nombre de la obra social.
 *
 * Sin acentos y en minúscula porque nadie escribe "ASOCIACIÓN" con tilde en un
 * teclado de teléfono, y la lista de la clínica los usa de las dos maneras.
 */
export function paraComparar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
}
