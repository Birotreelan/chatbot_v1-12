import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Espera un número específico de milisegundos
 * @param ms Milisegundos a esperar
 * @returns Promise que se resuelve después del tiempo especificado
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Otras funciones de utilidad existentes...
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
