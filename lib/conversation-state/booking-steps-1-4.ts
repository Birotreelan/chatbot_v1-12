/**
 * Sprint 6b: Handlers para Pasos 1-4
 * Datos personales (nombre, obra social) + tipo de búsqueda
 */

import { createConversationLogger } from "./logger"
import { getBookingFlowState, setBookingFlowState } from "./booking-flow-handler"
import {
  buildRequestNameMessage,
  buildRequestObraSocialMessage,
  buildSelectSedeMessage,
  buildInvalidSedeSelectionMessage,
  buildSearchTypeMenuMessage,
  buildInvalidSearchTypeSelectionMessage,
  buildRequestDoctorNameMessage,
  buildRequestSpecialtyMessage,
} from "./booking-messages"

const logger = createConversationLogger("", "", "booking-steps-1-4")

/**
 * Normaliza nombre extrayendo primer nombre
 * "Juan Carlos" → "Juan"
 */
export function extractFirstName(fullName: string): string {
  return fullName.split(" ")[0]
}

/**
 * Normaliza nombre: mayúscula primera letra de cada palabra
 * "juan carlos martinez" → "Juan Carlos Martinez"
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/**
 * PASO 1: Solicitar nombre y apellido (paciente nuevo)
 */
export async function step1RequestName(phone: string, configId: string): Promise<string> {
  logger.info("PASO 1: Solicitando nombre y apellido")
  const state = await getBookingFlowState(phone, configId)
  if (!state) return buildRequestNameMessage()

  await setBookingFlowState(phone, configId, {
    ...state,
    phase: "awaiting_name",
    updatedAt: new Date().toISOString(),
  })

  return buildRequestNameMessage()
}

/**
 * PASO 1: Procesar respuesta con nombre y apellido
 */
export async function step1ProcessName(
  userMessage: string,
  phone: string,
  configId: string
): Promise<{ success: boolean; nextMessage: string }> {
  const state = await getBookingFlowState(phone, configId)
  if (!state || state.phase !== "awaiting_name") {
    return { success: false, nextMessage: "" }
  }

  const parts = userMessage.trim().split(/\s+/)
  if (parts.length < 2) {
    logger.warn("Nombre inválido: menos de 2 palabras")
    return {
      success: false,
      nextMessage: "Por favor, indicá tu nombre y apellido separados por espacio.",
    }
  }

  const nombre = normalizeName(parts[0])
  const apellido = normalizeName(parts.slice(1).join(" "))

  await setBookingFlowState(phone, configId, {
    ...state,
    phase: "awaiting_obra_social",
    patientName: nombre,
    patientLastName: apellido,
    updatedAt: new Date().toISOString(),
  })

  logger.info("PASO 1 completado", { nombre, apellido })

  // PASO 2: Solicitar obra social
  const firstName = extractFirstName(nombre)
  return {
    success: true,
    nextMessage: buildRequestObraSocialMessage(firstName),
  }
}

/**
 * PASO 3: Procesar selección de sede
 */
export async function step3ProcessSedeSelection(
  userMessage: string,
  phone: string,
  configId: string
): Promise<{
  success: boolean
  type?: "valid_selection" | "invalid_selection"
  nextMessage: string
  selectedSede?: { numero: number; nombre: string }
}> {
  const state = await getBookingFlowState(phone, configId)
  if (!state || state.phase !== "awaiting_sede") {
    return { success: false, type: "invalid_selection", nextMessage: "" }
  }

  const numeroMatch = userMessage.match(/\d+/)
  if (!numeroMatch) {
    return {
      success: true,
      type: "invalid_selection",
      nextMessage: "Por favor, indicá el número de la sede que preferís.",
    }
  }

  const selectedNumber = parseInt(numeroMatch[0], 10)
  const sedes = state.sedeOptions || []
  const selectedSede = sedes.find((s) => s.numero === selectedNumber)

  if (!selectedSede) {
    return {
      success: true,
      type: "invalid_selection",
      nextMessage: buildInvalidSedeSelectionMessage(sedes.length),
    }
  }

  await setBookingFlowState(phone, configId, {
    ...state,
    phase: "awaiting_search_type",
    selectedSede: selectedSede,
    updatedAt: new Date().toISOString(),
  })

  logger.info("PASO 3 completado", { sede: selectedSede.nombre })

  // PASO 4: Mostrar menú de búsqueda
  return {
    success: true,
    type: "valid_selection",
    nextMessage: buildSearchTypeMenuMessage(),
    selectedSede,
  }
}

/**
 * PASO 4: Procesar selección de tipo de búsqueda
 */
export async function step4ProcessSearchType(
  userMessage: string,
  phone: string,
  configId: string
): Promise<{
  success: boolean
  type?: "invalid_selection" | "doctor_name" | "specialty" | "any_doctor"
  nextMessage: string
  searchType?: "doctor" | "specialty" | "any"
}> {
  const state = await getBookingFlowState(phone, configId)
  if (!state || state.phase !== "awaiting_search_type") {
    return { success: false, type: "invalid_selection", nextMessage: "" }
  }

  const numeroMatch = userMessage.match(/\d+/)
  if (!numeroMatch) {
    return {
      success: true,
      type: "invalid_selection",
      nextMessage: buildInvalidSearchTypeSelectionMessage(),
    }
  }

  const selection = parseInt(numeroMatch[0], 10)

  if (selection === 1) {
    // Médico particular
    await setBookingFlowState(phone, configId, {
      ...state,
      phase: "awaiting_doctor_name",
      searchType: "doctor",
      updatedAt: new Date().toISOString(),
    })

    return {
      success: true,
      type: "doctor_name",
      nextMessage: buildRequestDoctorNameMessage(),
      searchType: "doctor",
    }
  } else if (selection === 2) {
    // Especialidad
    await setBookingFlowState(phone, configId, {
      ...state,
      phase: "awaiting_specialty",
      searchType: "specialty",
      updatedAt: new Date().toISOString(),
    })

    return {
      success: true,
      type: "specialty",
      nextMessage: buildRequestSpecialtyMessage(),
      searchType: "specialty",
    }
  } else if (selection === 3) {
    // Cualquier médico
    await setBookingFlowState(phone, configId, {
      ...state,
      phase: "awaiting_turns",
      searchType: "any",
      updatedAt: new Date().toISOString(),
    })

    return {
      success: true,
      type: "any_doctor",
      nextMessage: "Voy a buscar todos los turnos disponibles.",
      searchType: "any",
    }
  } else {
    return {
      success: true,
      type: "invalid_selection",
      nextMessage: buildInvalidSearchTypeSelectionMessage(),
    }
  }
}
