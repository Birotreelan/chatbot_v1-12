# Análisis: Sistema Multi-Modo de Clientes para Recordatorios y Chatbot Limitado

## 🎯 Objetivo General

Permitir que la plataforma soporte **dos modos de operación para clientes**:

1. **Modo CHATBOT COMPLETO** (actual): Funcionalidad total
   - Confirmación/Cancelación de turnos
   - Reagendamiento
   - Paciente nuevo
   - Paciente existente
   - Flujos conversacionales complejos

2. **Modo RECORDATORIOS SOLAMENTE** (nuevo): Funcionalidad limitada
   - SOLO envío de plantillas de recordatorios
   - SOLO derívación por otros canales (teléfono, email, web, etc.)
   - SIN capacidad de conversación chatbot
   - SIN capacidad de reagendamiento
   - SIN capacidad de booking

---

## 📊 Estado Actual del Proyecto

### Arquitectura Base

- **Framework**: Next.js App Router
- **Base de Datos**: Redis (Upstash)
- **Comunicación**: WhatsApp API
- **Gestión de Estado**: Redis + OpenAI Threads

### Componentes Clave

```
lib/
├── types.ts                          # Define WhatsAppConfig, FeatureFlags
├── conversation-state/
│   ├── types.ts                      # Define ConversationPhase, FeatureFlags
│   └── [handlers específicos]        # Detectores de intención, templates
├── whatsapp.tsx                      # Router principal de mensajes (2500+ líneas)
├── db.tsx                            # Gestión de Redis
└── direct-response-templates.ts      # Templates de respuestas directas

app/
├── api/
│   ├── send-template/route.ts        # Envío de plantillas
│   ├── process-message/route.ts      # Procesamiento de mensajes entrantes
│   └── dashboard/configs/route.ts    # CRUD de configuraciones
└── dashboard/
    ├── config/[id]/page.tsx          # Edición de configuración
    └── [otros paneles]               # Stats, features, usuarios, etc.

components/
└── dashboard/
    ├── whatsapp-templates.tsx        # Gestor de plantillas WhatsApp
    ├── whatsapp-config-form.tsx      # Formulario de configuración
    └── feature-flags-panel.tsx       # Control de feature flags
```

### Feature Flags Existentes

El sistema ya tiene un mecanismo de **Feature Flags por cliente**:

```typescript
// lib/conversation-state/types.ts
export interface FeatureFlags {
  directConfirmation: boolean           # Detecta "Sí", "Confirmo", etc.
  directCancellation: boolean           # Detecta "No", "Cancelo", etc.
  directTurnSelection: boolean          # Detecta número de turno
  directDNIExtraction: boolean          # Detecta DNI
  directReagendamiento: boolean         # Reagendamiento automático
  directPacienteNuevo: boolean          # Registro de paciente nuevo
  directPacienteExistente: boolean      # Búsqueda de paciente existente
  directBookingFlow: boolean            # Flujo de reserva unificado
  directSelectionExtraction: boolean    # Selecciones inteligentes
  directPatientDetection: boolean       # Detección inicial de paciente
  // ... 8 flags más para detectar intenciones
}
```

**Cómo se usan:**
- `getFeatureFlags(configId, phoneNumber)` obtiene los flags desde Redis
- En `whatsapp.tsx` se verifica: `if (flags.directConfirmation) { ... }`
- Si el flag es FALSE → pasa todo a OpenAI
- Si el flag es TRUE → procesa directamente

### Configuración de Clientes

```typescript
// lib/types.ts
export interface WhatsAppConfig {
  id: string
  phoneNumberId: string
  whatsappNumber?: string
  wabaId: string
  displayName: string
  cliente_id?: string                  # ID del cliente/clínica
  active: boolean
  // ... otros campos
  escalationPhoneNumber?: string       # Número para derivación
  // ... configuraciones del widget
}
```

---

## 🔧 Cambios Necesarios

### 1. **Nuevo Campo en `WhatsAppConfig`**

**Archivo:** `lib/types.ts`

```typescript
export interface WhatsAppConfig {
  // ... campos existentes ...
  
  // NUEVO: Modo de operación del cliente
  clientMode: "CHATBOT_FULL" | "REMINDERS_ONLY"  // NUEVO
  
  // NUEVO: Configuración para modo recordatorios
  reminderConfig?: {                             // NUEVO
    // Plantillas editables por el cliente
    reminderTemplate?: string                    # Template del recordatorio
    noShowTemplate?: string                      # Template para inasistencia
    
    // Mensajes de derivación
    derivationChannels: {                        # Canales alternativos
      phone?: string                             # "Para agendar o cambiar: +54..."
      email?: string                             # "O envía un correo a: ..."
      web?: string                               # "O usa nuestra web: ..."
      whatsappBusiness?: string                  # Otro número WhatsApp
    }
    
    // Mensajes editables de derivación
    derivationMessageTemplate?: string           # "¿Necesitas cambiar? {{channels}}"
    confirmationResponseTemplate?: string        # "Gracias, confirmamos tu turno para..."
    cancellationResponseTemplate?: string        # "Entendido, hemos cancelado..."
    
    // Comportamiento
    autoConfirmOnReply?: boolean                 # ¿Confirmar automáticamente al responder?
    autoRejectOutOfWindow?: boolean              # ¿Rechazar mensajes fuera de ventana 24h?
    silenceOnFarewell?: boolean                  # ¿Silencio si responden con despedida?
  }
}
```

### 2. **Tipos para Modo Recordatorios**

**Archivo:** `lib/conversation-state/types.ts` (NUEVO)

```typescript
export type ClientMode = "CHATBOT_FULL" | "REMINDERS_ONLY"

export interface ReminderModeContext {
  mode: "REMINDERS_ONLY"
  phoneNumber: string
  configId: string
  
  // Estado simple
  lastReminderTemplate?: string                 # Template último enviado
  lastReminderSentAt?: string                   # Timestamp del envío
  
  // Confirmación/Cancelación simple
  lastActionType?: "confirmed" | "cancelled"    # Acción del usuario
  lastActionAt?: string                         # Cuándo respondió
  
  // Derivación
  derivationChannelsSent?: string[]              # Canales mencionados al usuario
  requiresDerivation?: boolean                  # ¿Necesita otro canal?
}
```

### 3. **Nuevo Handler para Modo Recordatorios**

**Archivo:** `lib/conversation-state/reminder-mode-handler.ts` (NUEVO)

```typescript
// 250-300 líneas

export interface ReminderResponse {
  shouldRespond: boolean
  responseText?: string
  responseType: "confirmation" | "cancellation" | "derivation" | "silence"
  recordMetrics: boolean
}

export async function detectIntentionInReminderMode(
  phoneNumber: string,
  configId: string,
  userMessage: string,
  lastTemplate: string
): Promise<ReminderResponse> {
  // Lógica:
  // 1. Detectar confirmación (regex simple: "sí", "confirmo", "perfecto", etc.)
  // 2. Detectar cancelación (regex simple: "no", "cancelo", "no puedo", etc.)
  // 3. Detectar despedida (regex simple: "gracias", "chau", "listo", etc.)
  // 4. Si confirma → responder con template de confirmación
  // 5. Si cancela → responder con template de cancelación + derivación
  // 6. Si despide → silencio (no responder)
  // 7. Si otra cosa → derivación amable
}

export async function buildReminderResponse(
  configId: string,
  actionType: "confirmation" | "cancellation" | "derivation" | "silence"
): Promise<string> {
  // Obtener config
  // Obtener template personalizado
  // Construir respuesta con derivación si es necesario
}
```

### 4. **Control en el Flujo Principal**

**Archivo:** `lib/whatsapp.tsx` (MODIFICACIÓN)

En la función principal de procesamiento de mensajes, antes de iniciar cualquier flujo:

```typescript
// Línea ~100 (después de validación inicial)
const config = await getWhatsAppConfig(configId)

// NUEVO: Verificar modo de cliente
if (config.clientMode === "REMINDERS_ONLY") {
  // Usar nuevo handler de recordatorios
  const reminderResponse = await handleReminderModeMessage(
    phoneNumber,
    configId,
    userMessage,
    config.reminderConfig
  )
  
  if (reminderResponse.shouldRespond) {
    await sendWhatsAppMessage(
      config.phoneNumberId,
      config.accessToken,
      phoneNumber,
      reminderResponse.responseText
    )
  }
  
  // Registrar métrica
  if (reminderResponse.recordMetrics) {
    await recordReminderModeAction(
      phoneNumber,
      configId,
      reminderResponse.responseType
    )
  }
  
  return // SALIR DEL FLUJO NORMAL
}

// ... resto del flujo normal de chatbot ...
```

### 5. **Dashboard: Selector de Modo de Cliente**

**Archivo:** `components/dashboard/whatsapp-config-form.tsx` (MODIFICACIÓN)

Agregar nuevo campo en el formulario:

```tsx
<div className="space-y-4">
  <h3 className="text-lg font-semibold">Modo de Operación</h3>
  
  <RadioGroup value={clientMode} onValueChange={setClientMode}>
    <div className="flex items-center space-x-2">
      <RadioGroupItem value="CHATBOT_FULL" id="chatbot-full" />
      <Label htmlFor="chatbot-full">
        Chatbot Completo (confirmación, reagendamiento, pacientes nuevos)
      </Label>
    </div>
    
    <div className="flex items-center space-x-2">
      <RadioGroupItem value="REMINDERS_ONLY" id="reminders-only" />
      <Label htmlFor="reminders-only">
        Solo Recordatorios (plantillas editables, derivación)
      </Label>
    </div>
  </RadioGroup>
  
  {clientMode === "REMINDERS_ONLY" && (
    <ReminderModeConfig config={config} onUpdate={handleUpdate} />
  )}
</div>
```

### 6. **Componente: Configuración de Recordatorios**

**Archivo:** `components/dashboard/reminder-mode-config.tsx` (NUEVO)

```tsx
// 400-500 líneas
// Formulario con:
// - Campos de texto para templates editables
// - Selector de canales de derivación (checkbox multiple)
// - Vista previa de mensaje para usuario
// - Botones de prueba ("Enviar de prueba a +54...")

export function ReminderModeConfig({ config, onUpdate }: Props) {
  const [reminderTemplate, setReminderTemplate] = useState(config.reminderConfig?.reminderTemplate || "")
  const [derivationChannels, setDerivationChannels] = useState(config.reminderConfig?.derivationChannels || {})
  const [preview, setPreview] = useState("")
  
  // ... implementation
}
```

### 7. **API: Actualizar Configuración de Recordatorios**

**Archivo:** `app/api/dashboard/configs/update/route.ts` (MODIFICACIÓN)

Extender para soportar `clientMode` y `reminderConfig`:

```typescript
// Agregar validación
if (body.clientMode === "REMINDERS_ONLY" && !body.reminderConfig) {
  return NextResponse.json(
    { error: "reminderConfig es obligatorio en modo recordatorios" },
    { status: 400 }
  )
}

// Guardar los nuevos campos
const updated = await updateWhatsAppConfig(configId, {
  clientMode: body.clientMode,
  reminderConfig: body.reminderConfig
})
```

### 8. **Base de Datos: Persistencia**

**Archivo:** `lib/db.tsx` (MODIFICACIÓN)

Las configuraciones de recordatorios se guardan en Redis:

```typescript
// Clave: `config:{configId}`
// Valor incluye: clientMode, reminderConfig

async function updateWhatsAppConfig(configId: string, updates: Partial<WhatsAppConfig>) {
  const existing = await getWhatsAppConfig(configId)
  const updated = { ...existing, ...updates }
  await redisClient.set(`config:${configId}`, JSON.stringify(updated))
}
```

---

## 📋 Flujo de Funcionamiento

### Flujo Modo RECORDATORIOS ONLY

```
1. Sistema externo envía plantilla de recordatorio
   ↓
2. /api/send-template/route.ts → envía plantilla al usuario
   ↓
3. Usuario responde al mensaje
   ↓
4. /api/process-message/route.ts
   ├─ Obtiene config: clientMode === "REMINDERS_ONLY"?
   ├─ SÍ → handler de recordatorios
   │   ├─ Detectar intención (confirmación/cancelación/despedida/otra)
   │   ├─ Si confirmación → responder con template de confirmación
   │   ├─ Si cancelación → responder con template de cancelación + derivación
   │   ├─ Si despedida → silencio
   │   └─ Si otra → derivación amable
   └─ NO → flujo normal de chatbot
```

### Configuraciones Editables en Dashboard

```
Modo: REMINDERS_ONLY
├─ Templates Personalizables:
│  ├─ Plantilla de recordatorio: "[Editable] Tu turno el {{fecha}} a las {{hora}} con {{profesional}}"
│  ├─ Plantilla de confirmación: "[Editable] ¡Perfecto! Confirmamos tu turno"
│  ├─ Plantilla de cancelación: "[Editable] Entendido, hemos cancelado tu turno"
│  └─ Template de derivación: "[Editable] ¿Necesitas cambiar? Contáctanos: {{channels}}"
│
├─ Canales de Derivación (checkboxes):
│  ├─ ☑ Teléfono: "+54 9 11 1234-5678"
│  ├─ ☑ Email: "agendas@clinica.com.ar"
│  ├─ ☑ Web: "www.clinica.com.ar/agendar"
│  └─ ☑ WhatsApp alternativo: "+54 11 9876-5432"
│
└─ Opciones Adicionales:
   ├─ ☑ Confirmar automáticamente al responder
   ├─ ☑ Rechazar mensajes fuera de ventana 24h
   └─ ☑ Silencio si responden con despedida
```

---

## 🔐 Consideraciones de Seguridad

1. **Validación de Acceso**: Cuando se actualiza `reminderConfig`, validar que el usuario pertenezca al cliente
2. **Sanitización de Templates**: Escapar caracteres especiales en los templates personalizados
3. **Rate Limiting**: Aplicar en ambos modos (ya existe)
4. **Auditoría**: Registrar cambios en templates y canales de derivación

---

## 📊 Metrics & Analytics

Para modo recordatorios, registrar:
- **reminder_sent**: Plantilla enviada
- **reminder_confirmed**: Usuario confirmó
- **reminder_cancelled**: Usuario canceló
- **reminder_derivation**: Usuario fue derivado a otro canal
- **reminder_silence**: No se respondió (despedida)
- **reminder_other**: Otra intención

---

## 🎯 Plan de Implementación

### Fase 1: Backend Base (2-3 días)
1. ✅ Agregar campos a `WhatsAppConfig`
2. ✅ Crear tipos en `ReminderModeContext`
3. ✅ Crear `reminder-mode-handler.ts`
4. ✅ Integrar en `whatsapp.tsx`
5. ✅ Extender `db.tsx` para persistencia

### Fase 2: Dashboard (2-3 días)
1. ✅ Selector de modo en formulario de config
2. ✅ Componente `ReminderModeConfig`
3. ✅ API para actualizar config
4. ✅ Vista previa de templates

### Fase 3: Testing (1 día)
1. ✅ Test de intención en recordatorios
2. ✅ Test de respuestas personalizadas
3. ✅ Test de derivación

### Fase 4: Deployment (1 día)
1. ✅ Migración de datos (si aplica)
2. ✅ Comunicación a clientes

---

## 📝 Archivos a Modificar/Crear

### Crear (NUEVOS)
- `lib/conversation-state/reminder-mode-handler.ts` (300 líneas)
- `components/dashboard/reminder-mode-config.tsx` (400 líneas)
- Tests para reminder handler

### Modificar
- `lib/types.ts` → agregar `clientMode`, `reminderConfig`
- `lib/conversation-state/types.ts` → agregar `ReminderModeContext`
- `lib/whatsapp.tsx` → agregar verificación de modo (20-30 líneas)
- `components/dashboard/whatsapp-config-form.tsx` → selector de modo (30-40 líneas)
- `app/api/dashboard/configs/update/route.ts` → validación de modo (10-15 líneas)
- `lib/db.tsx` → adaptar serialización si es necesario (0-5 líneas)

---

## ✨ Beneficios

✅ **Flexibilidad**: Dos modos de operación sin duplicar código  
✅ **Escalabilidad**: Clientes pueden empezar simple y evolucionar  
✅ **Customización**: Templates y canales configurables por cliente  
✅ **Mantenibilidad**: Feature flags ya existen, solo se extienden  
✅ **Analytics**: Diferentes métricas según modo  
✅ **Seguridad**: Control granular de funcionalidades  

---

## 🚀 Próximos Pasos

1. ¿Apruebas esta arquitectura?
2. ¿Tienes feedback sobre los campos de configuración?
3. ¿Hay otros templates o canales que necesites?
4. ¿Quieres que comience con la implementación?
