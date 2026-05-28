/**
 * Script para activar/desactivar el sistema determinístico Sprint 9
 * 
 * Uso:
 *   npx ts-node --env-file=/vercel/share/.env.project scripts/activate-sprint9.ts [comando]
 * 
 * Comandos:
 *   status     - Ver estado actual de los feature flags
 *   enable     - Activar Sprint 9 globalmente
 *   disable    - Desactivar Sprint 9 globalmente (rollback)
 *   enable-client [configId]  - Activar para un cliente específico
 *   disable-client [configId] - Desactivar para un cliente específico
 */

import {
  getGlobalFeatureFlags,
  setGlobalFeatureFlags,
  resetGlobalFeatureFlags,
  getClientFeatureFlags,
  setClientFeatureFlags,
  resetClientFeatureFlags,
} from "../lib/conversation-state/feature-flags"

const SPRINT_9_FLAGS = {
  directPatientDetection: true,
  directExistingPatientFlow: true,
  directPacienteNuevo: true,
}

async function main() {
  const command = process.argv[2]
  const clientId = process.argv[3]

  console.log("\n========================================")
  console.log("  Sprint 9 - Sistema Determinístico")
  console.log("========================================\n")

  switch (command) {
    case "status":
      await showStatus()
      break

    case "enable":
      await enableGlobal()
      break

    case "disable":
      await disableGlobal()
      break

    case "enable-client":
      if (!clientId) {
        console.error("Error: Debes especificar el configId del cliente")
        console.log("Uso: npx ts-node scripts/activate-sprint9.ts enable-client [configId]")
        process.exit(1)
      }
      await enableClient(clientId)
      break

    case "disable-client":
      if (!clientId) {
        console.error("Error: Debes especificar el configId del cliente")
        console.log("Uso: npx ts-node scripts/activate-sprint9.ts disable-client [configId]")
        process.exit(1)
      }
      await disableClient(clientId)
      break

    default:
      showHelp()
  }
}

async function showStatus() {
  console.log("Estado actual de Feature Flags:\n")
  
  try {
    const globalFlags = await getGlobalFeatureFlags()
    console.log("Flags GLOBALES:")
    console.log("  directPatientDetection:", globalFlags.directPatientDetection ? "ON" : "OFF")
    console.log("  directExistingPatientFlow:", globalFlags.directExistingPatientFlow ? "ON" : "OFF")
    console.log("  directPacienteNuevo:", globalFlags.directPacienteNuevo ? "ON" : "OFF")
    console.log("")
    
    const sprint9Active = 
      globalFlags.directPatientDetection &&
      globalFlags.directExistingPatientFlow &&
      globalFlags.directPacienteNuevo

    if (sprint9Active) {
      console.log("Estado: SPRINT 9 ACTIVO GLOBALMENTE")
    } else {
      console.log("Estado: Sprint 9 parcialmente activo o inactivo")
    }
  } catch (error) {
    console.error("Error obteniendo status:", error)
  }
}

async function enableGlobal() {
  console.log("Activando Sprint 9 GLOBALMENTE...\n")
  
  try {
    await setGlobalFeatureFlags(SPRINT_9_FLAGS)
    console.log("EXITO: Sprint 9 activado globalmente")
    console.log("")
    console.log("Flags activados:")
    console.log("  - directPatientDetection: ON")
    console.log("  - directExistingPatientFlow: ON")
    console.log("  - directPacienteNuevo: ON")
    console.log("")
    console.log("El sistema ahora procesará pacientes sin recordatorio de forma determinística.")
  } catch (error) {
    console.error("Error activando Sprint 9:", error)
  }
}

async function disableGlobal() {
  console.log("DESACTIVANDO Sprint 9 globalmente (rollback)...\n")
  
  try {
    await setGlobalFeatureFlags({
      directPatientDetection: false,
      directExistingPatientFlow: false,
      directPacienteNuevo: false,
    })
    console.log("EXITO: Sprint 9 desactivado globalmente")
    console.log("")
    console.log("El sistema ahora usará OpenAI para todos los pacientes sin recordatorio.")
  } catch (error) {
    console.error("Error desactivando Sprint 9:", error)
  }
}

async function enableClient(configId: string) {
  console.log(`Activando Sprint 9 para cliente: ${configId}\n`)
  
  try {
    await setClientFeatureFlags(configId, SPRINT_9_FLAGS)
    console.log(`EXITO: Sprint 9 activado para ${configId}`)
    console.log("")
    console.log("Este cliente ahora usará el sistema determinístico.")
  } catch (error) {
    console.error("Error activando Sprint 9 para cliente:", error)
  }
}

async function disableClient(configId: string) {
  console.log(`Desactivando Sprint 9 para cliente: ${configId}\n`)
  
  try {
    await resetClientFeatureFlags(configId)
    console.log(`EXITO: Flags reseteados para ${configId}`)
    console.log("")
    console.log("Este cliente ahora usará los flags globales (o defaults).")
  } catch (error) {
    console.error("Error desactivando Sprint 9 para cliente:", error)
  }
}

function showHelp() {
  console.log("Comandos disponibles:\n")
  console.log("  status              Ver estado actual de los feature flags")
  console.log("  enable              Activar Sprint 9 globalmente")
  console.log("  disable             Desactivar Sprint 9 globalmente (rollback)")
  console.log("  enable-client [id]  Activar para un cliente específico")
  console.log("  disable-client [id] Desactivar para un cliente específico")
  console.log("")
  console.log("Ejemplos:")
  console.log("  npx ts-node scripts/activate-sprint9.ts status")
  console.log("  npx ts-node scripts/activate-sprint9.ts enable")
  console.log("  npx ts-node scripts/activate-sprint9.ts enable-client config_abc123")
}

main().catch(console.error)
