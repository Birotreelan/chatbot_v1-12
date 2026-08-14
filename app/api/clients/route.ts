import { NextRequest, NextResponse } from "next/server"
import { getWhatsAppConfigByPhoneId, getAllWhatsAppConfigs } from "@/lib/db"
import { createWhatsAppConfig } from "@/app/dashboard/actions"
import type { WhatsAppConfig } from "@/lib/types"

/**
 * Endpoint para alta externa de clientes (uso: sistemas/personas de
 * onboarding que no tienen acceso al dashboard). Requiere API key propia
 * (CLIENTS_API_KEY), independiente del login por sesión del dashboard.
 *
 * POST /api/clients
 * Headers: Authorization: Bearer <CLIENTS_API_KEY>
 * Body (JSON):
 *   {
 *     "displayName": "Salud Ocular",          // requerido — "Nombre de la Configuración"
 *     "phoneNumberId": "672289632642260",      // requerido
 *     "cliente_id": "faf82cd7-4b56-...",       // requerido
 *     "accessToken": "EAAa...",                // requerido — Access Token de WhatsApp
 *     "proxy": "https://...",                  // requerido — Proxy URL (pestaña Avanzado)
 *     "wabaId": "2506532436395025",            // opcional
 *     "whatsappNumber": "+54 9 11 3688-0068",  // opcional
 *     "alias": "Clínica Central",              // opcional (uso interno)
 *     "escalationPhoneNumber": "0800 345 9393",// opcional — "Número de Derivación"
 *     "active": true                           // opcional, default true
 *   }
 */

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.CLIENTS_API_KEY
  // Si no hay key configurada del lado del servidor, el endpoint queda
  // cerrado por defecto (fail-closed) en vez de aceptar cualquier request.
  if (!expected) return false

  const authHeader = request.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
  return token.length > 0 && token === expected
}

function toTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body inválido, se espera JSON" }, { status: 400 })
  }

  const displayName = toTrimmedString(body.displayName)
  const phoneNumberId = toTrimmedString(body.phoneNumberId)
  const clienteId = toTrimmedString(body.cliente_id)
  const accessToken = toTrimmedString(body.accessToken)
  const proxy = toTrimmedString(body.proxy)

  const missing = [
    !displayName && "displayName",
    !phoneNumberId && "phoneNumberId",
    !clienteId && "cliente_id",
    !accessToken && "accessToken",
    !proxy && "proxy",
  ].filter(Boolean)

  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Faltan campos obligatorios: ${missing.join(", ")}` },
      { status: 400 },
    )
  }

  // El mapeo Phone_Number_Id -> config es 1:1 (usado para rutear los
  // webhooks entrantes); si ya existe uno, no lo pisamos silenciosamente.
  const existingByPhone = await getWhatsAppConfigByPhoneId(phoneNumberId!)
  if (existingByPhone) {
    return NextResponse.json(
      {
        error: `Ya existe un cliente con ese Phone Number ID: "${existingByPhone.displayName}" (id: ${existingByPhone.id})`,
      },
      { status: 409 },
    )
  }

  const allConfigs = await getAllWhatsAppConfigs()
  const existingByClienteId = allConfigs.find((c) => c.cliente_id === clienteId)
  if (existingByClienteId) {
    return NextResponse.json(
      {
        error: `Ya existe un cliente con ese Cliente ID: "${existingByClienteId.displayName}" (id: ${existingByClienteId.id})`,
      },
      { status: 409 },
    )
  }

  const configData: Partial<WhatsAppConfig> = {
    displayName,
    phoneNumberId,
    cliente_id: clienteId,
    accessToken,
    proxy,
    wabaId: toTrimmedString(body.wabaId) || "",
    whatsappNumber: toTrimmedString(body.whatsappNumber),
    alias: toTrimmedString(body.alias),
    escalationPhoneNumber: toTrimmedString(body.escalationPhoneNumber),
    active: typeof body.active === "boolean" ? body.active : true,
  }

  try {
    const config = await createWhatsAppConfig(configData)
    return NextResponse.json({ success: true, id: config.id, config }, { status: 201 })
  } catch (error) {
    console.error("[API] Error creando cliente vía /api/clients:", error)
    return NextResponse.json({ error: "Error interno al crear el cliente" }, { status: 500 })
  }
}
