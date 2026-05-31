/**
 * Handler compartido para email
 */

import { createConversationLogger } from '../logger'
import type { HandlerResult } from './types'

/**
 * Valida formato de email
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email.trim())
}

/**
 * Verifica si se necesita solicitar email
 */
export function shouldRequestEmail(existingEmail?: string): boolean {
  return !existingEmail || existingEmail.trim() === ''
}

/**
 * Construye mensaje de solicitud de email
 */
export function buildEmailRequestMessage(): string {
  return `Para confirmar tu turno, necesito tu *correo electronico*.

Por favor, escribi tu email para enviarte la confirmacion del turno.`
}

/**
 * Maneja la entrada de email
 */
export async function handleEmailInput(
  userInput: string,
  phoneNumber: string,
  clientId: string,
  attempts: number
): Promise<HandlerResult & { validatedEmail?: string }> {
  const logger = createConversationLogger(phoneNumber, clientId, 'email_input')

  const emailInput = userInput.trim().toLowerCase()

  if (!validateEmail(emailInput)) {
    logger.info('Email invalido', { input: emailInput, attempts: attempts + 1 })

    if (attempts >= 2) {
      return {
        handled: true,
        message: 'Has ingresado un email invalido varias veces. Por favor, comunicate directamente con la clinica para completar tu reserva.',
        nextPhase: 'abandoned',
      }
    }

    return {
      handled: true,
      message: `El formato del email no es valido. Por favor, ingresa un email correcto (ejemplo: nombre@correo.com).`,
      nextPhase: 'awaiting_email',
    }
  }

  logger.info('Email validado', { email: emailInput })

  return {
    handled: true,
    nextPhase: 'awaiting_confirmation',
    validatedEmail: emailInput,
  }
}
