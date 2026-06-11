# PROPUESTA: ARQUITECTURA DE TEMPLATES GESTIONADOS + MIGRACIÓN GRADUAL

## 📍 VISIÓN GENERAL

**Estado Actual:**
- Clientes envían Body completo → Nosotros solo reenviamos

**Estado Futuro:**
- Clientes solicitan recordatorio → Nosotros aplicamos template personalizado
- **Fallback:** Si cliente no está en nuevo sistema, usar Body como viene

**Ventaja:** Cero disrupción, migración bajo demanda

---

## 🏗️ ARQUITECTURA PROPUESTA

### 1. NUEVOS TIPOS (en `lib/types.ts`)

```typescript
// Tipo de template de recordatorios que maneja el sistema
export interface ClientReminderTemplate {
  id: string
  cliente_id: string                    // Asociado a cliente específico
  template_type: "reminder" | "confirmation" | "cancellation" | "derivation"
  name: string                          // "appointment_reminder_main"
  displayName: string                   // "Recordatorio de turno - Principal"
  description?: string
  body: string                          // Template con {{variables}}
  variables: ReminderTemplateVariable[] // {{nombre}}, {{fecha}}, {{hora}}, etc.
  language: string                      // "es", "es_AR", "en", etc.
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface ReminderTemplateVariable {
  key: string                           // "nombre", "fecha", "hora"
  description: string                   // "Nombre del paciente"
  required: boolean
  example: string                       // "Juan López"
}

// Configuración de cliente en REMINDERS_ONLY mode
export interface ReminderModeConfig {
  template_mode: "LEGACY" | "MANAGED"   // LEGACY = Body como viene, MANAGED = nuestros templates
  appointment_reminder_template_id?: string
  cancellation_template_id?: string
  derivation_template_id?: string
  derivation_channels?: DerivatioChannel[]
  auto_confirm_24h: boolean             // Auto-confirmar si responden en ventana 24h
  silence_on_farewell: boolean          // No responder si se despiden
}

export interface DerivationChannel {
  type: "phone" | "email" | "web" | "whatsapp"
  value: string                         // "+54...", "email@...", "https://..."
  label?: string
}

// Expandir WhatsAppConfig con estos campos
// (en la interfaz existente agregar):
// reminder_mode_config?: ReminderModeConfig
```

### 2. NUEVA TABLA EN DB (en `lib/db.tsx`)

```typescript
// ============= CLIENT REMINDER TEMPLATES =============

const CLIENT_REMINDER_PREFIX = "client_reminder_template:"

export async function createClientReminderTemplate(
  template: Omit<ClientReminderTemplate, "id" | "createdAt" | "updatedAt">
): Promise<ClientReminderTemplate> {
  const id = nanoid()
  const now = new Date().toISOString()
  
  const newTemplate: ClientReminderTemplate = {
    ...template,
    id,
    createdAt: now,
    updatedAt: now,
  }
  
  const redisClient = getRedisClient()
  if (redisClient) {
    await redisClient.set(
      `${CLIENT_REMINDER_PREFIX}${id}`,
      JSON.stringify(newTemplate),
      { ex: 30 * 24 * 60 * 60 } // 30 días
    )
  }
  
  return newTemplate
}

export async function getClientReminderTemplate(
  template_id: string
): Promise<ClientReminderTemplate | null> {
  const redisClient = getRedisClient()
  if (!redisClient) return null
  
  const data = await redisClient.get(`${CLIENT_REMINDER_PREFIX}${template_id}`)
  return data ? JSON.parse(data) : null
}

export async function getClientReminderTemplatesByType(
  cliente_id: string,
  template_type: string
): Promise<ClientReminderTemplate[]> {
  // Implementación con Upstash scan si necesario
  // Por ahora, buscar en memoria o con patrón simple
}

export async function updateClientReminderTemplate(
  template_id: string,
  updates: Partial<Omit<ClientReminderTemplate, "id" | "createdAt">>
): Promise<ClientReminderTemplate | null> {
  const template = await getClientReminderTemplate(template_id)
  if (!template) return null
  
  const updated: ClientReminderTemplate = {
    ...template,
    ...updates,
    updatedAt: new Date().toISOString(),
  }
  
  const redisClient = getRedisClient()
  if (redisClient) {
    await redisClient.set(
      `${CLIENT_REMINDER_PREFIX}${template_id}`,
      JSON.stringify(updated),
      { ex: 30 * 24 * 60 * 60 }
    )
  }
  
  return updated
}

export async function deleteClientReminderTemplate(
  template_id: string
): Promise<boolean> {
  const redisClient = getRedisClient()
  if (redisClient) {
    await redisClient.del(`${CLIENT_REMINDER_PREFIX}${template_id}`)
    return true
  }
  return false
}
```

### 3. API NUEVA: `/api/client-reminder-templates/` (CRUD)

**Ubicación:** `/app/api/client-reminder-templates/route.ts` + CRUD individual

```typescript
// GET - Obtener todos los templates del cliente
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const cliente_id = searchParams.get("cliente_id")
  
  if (!cliente_id) {
    return NextResponse.json({ error: "cliente_id requerido" }, { status: 400 })
  }
  
  // Obtener templates del cliente
  const templates = await getClientReminderTemplatesByClientId(cliente_id)
  
  return NextResponse.json({
    success: true,
    templates,
    count: templates.length,
  })
}

// POST - Crear nuevo template
export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    cliente_id,
    template_type,
    name,
    displayName,
    description,
    body,
    variables,
    language,
  } = body
  
  // Validaciones...
  
  const template = await createClientReminderTemplate({
    cliente_id,
    template_type,
    name,
    displayName,
    description,
    body,
    variables,
    language,
    active: true,
  })
  
  return NextResponse.json({ success: true, template })
}

// PATCH - Actualizar template
// DELETE - Eliminar template
```

### 4. LÓGICA DE PERSONALIZACIÓN (NUEVO archivo)

**Ubicación:** `/lib/template-personalization.ts`

```typescript
export interface PersonalizationVariables {
  nombre?: string
  apellido?: string
  fecha?: string
  hora?: string
  profesional?: string
  especialidad?: string
  lugar?: string
  obra_social?: string
  [key: string]: string | undefined
}

/**
 * Aplica variables a un template
 * "Hola {{nombre}}, tu turno es {{fecha}} a {{hora}}"
 * + { nombre: "Juan", fecha: "mañana", hora: "15:00" }
 * = "Hola Juan, tu turno es mañana a 15:00"
 */
export function personalizeTemplate(
  template: string,
  variables: PersonalizationVariables
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = variables[key]
    if (value === undefined || value === null) {
      console.warn(`[TEMPLATE] Variable no encontrada: ${key}`)
      return `{{${key}}}` // Dejar como está si no existe
    }
    return String(value)
  })
}

/**
 * Valida que todas las variables requeridas estén presentes
 */
export function validateTemplateVariables(
  requiredVariables: ReminderTemplateVariable[],
  providedVariables: PersonalizationVariables
): { valid: boolean; missing: string[] } {
  const missing = requiredVariables
    .filter(v => v.required)
    .filter(v => !providedVariables[v.key])
    .map(v => v.key)
  
  return {
    valid: missing.length === 0,
    missing,
  }
}

/**
 * Detecta qué variables se usan en un template
 */
export function extractVariablesFromTemplate(template: string): string[] {
  const matches = template.match(/\{\{(\w+)\}\}/g) || []
  return [...new Set(matches.map(m => m.slice(2, -2)))]
}
```

### 5. MODIFICAR `/api/send-template` (INTEGRACIÓN)

**Ubicación:** `/app/api/send-template/route.ts`

**CAMBIOS:**

```typescript
import { getClientReminderTemplate } from "@/lib/db"
import { personalizeTemplate, validateTemplateVariables } from "@/lib/template-personalization"

export async function POST(request: Request) {
  try {
    const data = await request.json()
    const {
      Cliente_Id,
      Phone_Number_Id,
      Telefono,
      Body,              // Ahora OPCIONAL si está en MANAGED mode
      Template_Name,
      Template_Id,       // NUEVO: ID del template a usar
      TemplateVariables, // NUEVO: Variables de personalización
      Has_Buttons,
      Button_Options,
    } = data

    // 1. Obtener configuración del cliente
    let config = Phone_Number_Id 
      ? await getWhatsAppConfigByPhoneId(Phone_Number_Id)
      : await getWhatsAppConfig(Cliente_Id)
    
    if (!config) {
      return NextResponse.json({ error: "Config no encontrada" }, { status: 404 })
    }

    // 2. LÓGICA NUEVA: Determinar qué Body usar
    let finalBody = Body
    
    // Si cliente está en MANAGED mode y proporciona Template_Id
    if (config.reminder_mode_config?.template_mode === "MANAGED" && Template_Id) {
      console.log(`[SEND-TEMPLATE] Usando template MANAGED: ${Template_Id}`)
      
      const template = await getClientReminderTemplate(Template_Id)
      if (!template) {
        console.warn(`[SEND-TEMPLATE] Template no encontrado: ${Template_Id}, fallback a Body`)
        // Fallback a Body si template no existe
        if (!Body) {
          return NextResponse.json(
            { error: "Template no encontrado y Body no proporcionado" },
            { status: 400 }
          )
        }
        finalBody = Body
      } else {
        // Validar y aplicar variables
        const validation = validateTemplateVariables(
          template.variables,
          TemplateVariables || {}
        )
        
        if (!validation.valid) {
          return NextResponse.json(
            { error: `Variables faltantes: ${validation.missing.join(", ")}` },
            { status: 400 }
          )
        }
        
        // Personalizar template
        finalBody = personalizeTemplate(template.body, TemplateVariables || {})
        console.log(`[SEND-TEMPLATE] Template personalizado aplicado`)
      }
    } else if (!Body) {
      // LEGACY mode pero sin Body = error
      return NextResponse.json(
        { error: "Body requerido en LEGACY mode" },
        { status: 400 }
      )
    }

    // 3. Continuar como antes
    const destinationPhone = Telefono.startsWith("+") ? Telefono : `+${Telefono}`
    
    await sendWhatsAppMessage(
      config.phoneNumberId,
      config.accessToken,
      destinationPhone,
      finalBody
    )
    
    await saveConversationMessage({
      id: nanoid(),
      role: "assistant",
      content: finalBody,
      timestamp: new Date().toISOString(),
      phoneNumber: normalizePhoneNumber(destinationPhone),
      configId: config.id,
      messageType: Template_Id ? "template_managed" : "template_legacy",
      templateId: Template_Id,
    })

    return NextResponse.json({
      success: true,
      message: "Mensaje enviado correctamente",
      details: {
        mode: config.reminder_mode_config?.template_mode || "LEGACY",
        templateId: Template_Id || null,
        personalizedMessageLength: finalBody.length,
      },
    })
  } catch (error) {
    console.error("[SEND-TEMPLATE] Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
```

### 6. UI EN DASHBOARD (NUEVO COMPONENTE)

**Ubicación:** `/components/dashboard/reminder-mode-templates.tsx`

```typescript
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Plus, Edit2, Trash2, Eye } from "lucide-react"
import type { ClientReminderTemplate } from "@/lib/types"

interface ReminderModeTemplatesProps {
  clienteId: string
  templates: ClientReminderTemplate[]
  onSave: (template: ClientReminderTemplate) => Promise<void>
  onDelete: (templateId: string) => Promise<void>
}

const TEMPLATE_TYPES = [
  { value: "reminder", label: "Recordatorio de turno" },
  { value: "confirmation", label: "Confirmación" },
  { value: "cancellation", label: "Cancelación" },
  { value: "derivation", label: "Derivación" },
]

export function ReminderModeTemplates({
  clienteId,
  templates,
  onSave,
  onDelete,
}: ReminderModeTemplatesProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingData, setEditingData] = useState<Partial<ClientReminderTemplate>>({})
  const [preview, setPreview] = useState("")

  const handleEdit = (template: ClientReminderTemplate) => {
    setEditingId(template.id)
    setEditingData(template)
  }

  const handleSave = async () => {
    if (!editingId) return
    
    const template: ClientReminderTemplate = {
      id: editingId,
      cliente_id: clienteId,
      template_type: editingData.template_type || "reminder",
      name: editingData.name || "",
      displayName: editingData.displayName || "",
      description: editingData.description,
      body: editingData.body || "",
      variables: editingData.variables || [],
      language: editingData.language || "es",
      active: editingData.active !== false,
      createdAt: templates.find(t => t.id === editingId)?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await onSave(template)
    setEditingId(null)
    setEditingData({})
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Plantillas de Recordatorios</h2>
        <Button onClick={() => setEditingId("new")} className="gap-2">
          <Plus className="w-4 h-4" />
          Nueva Plantilla
        </Button>
      </div>

      {/* Lista de templates */}
      <div className="space-y-4">
        {templates.map(template => (
          <Card key={template.id} className={!template.active ? "opacity-50" : ""}>
            <CardHeader className="flex flex-row justify-between items-start">
              <div>
                <CardTitle>{template.displayName}</CardTitle>
                <p className="text-sm text-gray-600">{template.description}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleEdit(template)}
                >
                  <Edit2 className="w-4 h-4" />
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => onDelete(template.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <pre className="bg-gray-100 p-3 rounded text-sm overflow-x-auto">
                {template.body}
              </pre>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Editor de template */}
      {editingId && (
        <Card className="border-2 border-blue-500">
          <CardHeader>
            <CardTitle>Editar Plantilla</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Formulario de edición */}
            <div>
              <label className="text-sm font-medium">Nombre Amigable</label>
              <Input
                value={editingData.displayName || ""}
                onChange={e => setEditingData({ ...editingData, displayName: e.target.value })}
                placeholder="Ej: Recordatorio Principal"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Tipo</label>
              <select
                value={editingData.template_type || "reminder"}
                onChange={e => setEditingData({ ...editingData, template_type: e.target.value as any })}
                className="w-full p-2 border rounded"
              >
                {TEMPLATE_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium">Contenido (usa {{variable}})</label>
              <Textarea
                value={editingData.body || ""}
                onChange={e => {
                  setEditingData({ ...editingData, body: e.target.value })
                  setPreview(e.target.value) // Preview simple
                }}
                placeholder="Hola {{nombre}}, recordamos tu turno {{fecha}} a {{hora}}"
                rows={6}
              />
              <p className="text-xs text-gray-600 mt-2">
                Variables disponibles: {{"{nombre}, {fecha}, {hora}, {profesional}, {especialidad}"}}
              </p>
            </div>

            <div className="bg-blue-50 p-3 rounded">
              <p className="text-xs font-medium text-gray-700 mb-2">Preview:</p>
              <pre className="text-sm">{preview}</pre>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleSave}>Guardar</Button>
              <Button variant="outline" onClick={() => setEditingId(null)}>Cancelar</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
```

---

## 🔄 MIGRACIÓN GRADUAL (Fallback Strategy)

### Sistema de "Compatibilidad por Cliente"

```typescript
// Agregar a WhatsAppConfig:
export interface WhatsAppConfig {
  // ... campos existentes ...
  
  // NUEVO
  template_strategy: "LEGACY" | "MANAGED" // Default = LEGACY
}

// En /api/send-template, la lógica:
if (config.template_strategy === "MANAGED" && Template_Id) {
  // Usar template gestionado
  const template = await getClientReminderTemplate(Template_Id)
  finalBody = personalizeTemplate(template.body, TemplateVariables)
} else {
  // Usar Body como viene (LEGACY)
  finalBody = Body
}
```

### Timeline de Migración

1. **Fase 1 (Hoy):** Código completamente backward compatible
   - Todos los clientes en LEGACY mode
   - No requiere cambios

2. **Fase 2 (Semana 1-2):** Soporte opcional MANAGED mode
   - Habilitar para clientes que lo soliciten
   - El cliente proporciona `template_strategy: "MANAGED"` en su config

3. **Fase 3 (Semana 3-4):** Migración gradual
   - Ofrecer UI para crear templates gestionados
   - Soporte al cliente para migrar

4. **Fase 4 (Mes 2):** Deprecate LEGACY (opcional)
   - Documentar plan para deprecar
   - 30 días de notificación

---

## 📊 EJEMPLO DE USO

### Cliente en LEGACY Mode (Actual)
```bash
curl -X POST https://tu-dominio.com/api/send-template \
  -H "Content-Type: application/json" \
  -d '{
    "Cliente_Id": "clinica-abc",
    "Telefono": "+5491123456789",
    "Body": "Hola Juan, recordamos tu turno mañana a las 15:00 con Dr. López"
  }'
```

### Cliente en MANAGED Mode (Nuevo)
```bash
curl -X POST https://tu-dominio.com/api/send-template \
  -H "Content-Type: application/json" \
  -d '{
    "Cliente_Id": "clinica-abc",
    "Telefono": "+5491123456789",
    "Template_Id": "tpl_reminder_main",
    "TemplateVariables": {
      "nombre": "Juan",
      "fecha": "mañana",
      "hora": "15:00",
      "profesional": "Dr. López"
    }
  }'
```

---

## 🎯 BENEFICIOS

✅ **Backward Compatible:** CERO breaking changes
✅ **Control Centralizado:** Templates gestionados por nosotros
✅ **Flexible:** Fallback automático
✅ **Escalable:** Fácil agregar nuevas variables
✅ **Analytics:** Trackeo por template
✅ **Velocidad:** Cliente no arma el Body (menos errores)

---

## 🚀 IMPLEMENTACIÓN TIMELINE

- **Día 1-2:** Tipos + DB + Personalización
- **Día 3:** API CRUD de templates
- **Día 4:** Integración en /api/send-template
- **Día 5:** UI en dashboard
- **Día 6-7:** Testing + Fixes

**Total:** 7 días de desarrollo

