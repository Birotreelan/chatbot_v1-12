# ANÁLISIS: SISTEMA ACTUAL DE RECORDATORIOS Y TEMPLATES

## 📍 RESUMEN EJECUTIVO

Actualmente el proyecto tiene:

1. **Sistema de Templates Dual:**
   - **Global Templates** (almacenados en el sistema) → `/api/global-templates/*`
   - **WhatsApp Templates** (en la cuenta de WhatsApp del cliente) → `/api/whatsapp/templates/*`

2. **Envío de Recordatorios:**
   - Los CLIENTES (sistemas externos) invocan `/api/send-template`
   - Envían el `Body` (contenido del mensaje) **directamente**
   - El servidor envía al usuario vía WhatsApp

3. **Flujo Actual (Muy Simplificado):**
   ```
   Sistema Externo del Cliente
        ↓
   POST /api/send-template
        ↓ (Body del mensaje ya formateado)
   Nuestro servidor
        ↓
   WhatsApp API
        ↓
   Usuario recibe recordatorio con contenido del cliente
   ```

---

## 🔄 FLUJO ACTUAL DETALLADO

### 1. ENDPOINT: `/api/send-template` (POST)

**Ubicación:** `/vercel/share/v0-project/app/api/send-template/route.ts`

**Parámetros Requeridos:**
```typescript
{
  Cliente_Id: string          // ID único del cliente
  Phone_Number_Id: string     // (Opcional) ID de número de WhatsApp
  Telefono: string            // Teléfono destino (REQUERIDO EXPLÍCITAMENTE)
  Body: string                // CONTENIDO DEL MENSAJE (enviado por cliente)
  Template_Name?: string      // Nombre del template (solo para logs)
  Has_Buttons?: boolean       // ¿Tiene botones?
  Button_Options?: string[]   // Opciones de botones
}
```

**¿QUIÉN LLAMA ESTO?**
- Sistema de turnos del cliente (ej: software médico)
- Sistema de notificaciones del cliente
- Cualquier sistema que necesite enviar recordatorios

**EJEMPLO DE INVOCACIÓN (desde cliente externo):**
```bash
curl -X POST https://tu-dominio.com/api/send-template \
  -H "Content-Type: application/json" \
  -d '{
    "Cliente_Id": "clinica-abc",
    "Telefono": "+5491123456789",
    "Body": "Hola Juan, recordamos que tienes turno mañana a las 15:00 con el Dr. López. Confirma aquí.",
    "Template_Name": "reminder_appointment",
    "Has_Buttons": false
  }'
```

**¿QUÉ HACE EL ENDPOINT?**
1. Valida que exista `Cliente_Id` y `Body`
2. Busca la configuración de WhatsApp del cliente
3. Normaliza el teléfono
4. Invoca `sendWhatsAppMessage()` con el Body tal como viene
5. Guarda el mensaje en Redis (para auditoría)
6. Notifica a OpenAI sobre la plantilla enviada (si hay thread)
7. Retorna `{ success: true }`

**CÓDIGO SIMPLIFICADO:**
```typescript
export async function POST(request: Request) {
  const { Cliente_Id, Telefono, Body, Template_Name, Has_Buttons, Button_Options } = await request.json()
  
  // Validaciones...
  const config = await getWhatsAppConfigByPhoneId(Phone_Number_Id) || 
                 await getWhatsAppConfig(Cliente_Id)
  
  // Enviar el Body EXACTAMENTE como viene
  await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, Telefono, Body)
  
  // Guardar en Redis
  await saveConversationMessage({ ... Body, messageType: "template" })
  
  return { success: true, message: "Mensaje enviado correctamente" }
}
```

---

### 2. ALMACENAMIENTO DE TEMPLATES

#### A) Global Templates (Nuestros)
**Ubicación:** `/api/global-templates/*`

**Interfaz:**
```typescript
export interface GlobalTemplate {
  id: string
  name: string
  displayName: string          // Nombre amigable
  description?: string
  language: string             // "es", "es_AR", "en", etc.
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION"
  components: GlobalTemplateComponent[]
  createdAt: string
  updatedAt: string
  createdBy?: string           // Usuario que lo creó
  sourceConfigId?: string      // De dónde se extrajo
}

interface GlobalTemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS"
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT"
  text?: string
  buttons?: GlobalTemplateButton[]
}
```

**Almacenamiento:** Redis + Memory Store

**CRUD:**
- `GET /api/global-templates` → Obtener todas
- `POST /api/global-templates` → Crear nueva
- `PATCH /api/global-templates/[id]` → Actualizar
- `DELETE /api/global-templates/[id]` → Eliminar

#### B) WhatsApp Templates (Nativos de cliente)
**Ubicación:** `/api/whatsapp/templates/*`

Estos son templates **REGISTRADOS EN LA CUENTA DE WHATSAPP del cliente** via Meta/Facebook.

**GET `/api/whatsapp/templates`:**
```typescript
export async function GET(req: NextRequest) {
  const { wabaId, configId } = searchParams
  
  // Obtener access token
  const config = await getWhatsAppConfigById(configId)
  
  // Llamar a Meta API
  const response = await fetch(
    `https://graph.facebook.com/v18.0/${wabaId}/message_templates`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  
  return { success: true, templates: data.data, paging: data.paging }
}
```

---

### 3. FLUJO CUANDO CLIENTE ENVÍA RECORDATORIO

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Sistema del Cliente (ej: turnos.clinica.com.ar)          │
│    → Decide enviar recordatorio de turno                     │
│    → Construye el mensaje manualmente:                       │
│       "Hola {{nombre}}, recordamos turno mañana a {{hora}}   │
│        con {{profesional}}. Confirmar: 1, Cancelar: 2"       │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Invoca nuestro endpoint POST /api/send-template:          │
│    {                                                         │
│      "Cliente_Id": "clinica-xyz",                            │
│      "Telefono": "+5491123456789",                           │
│      "Body": "Hola Juan, recordamos turno mañana a 15:00...  │
│      "Template_Name": "reminder_appointment"                 │
│    }                                                         │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Nuestro Servidor:                                         │
│    • Busca config de cliente                                 │
│    • Normaliza teléfono                                      │
│    • Valida Body (solo que no sea vacío)                     │
│    • Prepara mensaje para WhatsApp API                       │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. WhatsApp API (Meta):                                      │
│    → Recibe Body EXACTO del cliente                          │
│    → Lo envía al usuario                                     │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Usuario recibe:                                           │
│    "Hola Juan, recordamos turno mañana a 15:00 con Dr.López  │
│     Confirmar: 1, Cancelar: 2"                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎯 PROBLEMAS CON SISTEMA ACTUAL

| Problema | Impacto | Severidad |
|----------|--------|-----------|
| **Inconsistencia de formato** | Cada cliente formatiza diferente | ⭐⭐⭐ |
| **Falta de validación** | Mensajes con errores llegan a usuarios | ⭐⭐ |
| **Imposible customizar centralmente** | Todo cliente debe editar su sistema | ⭐⭐⭐ |
| **Analytics débiles** | No sabemos qué template se usó | ⭐⭐ |
| **Traducción manual** | Cada cliente en varios idiomas | ⭐ |
| **Escalabilidad** | Si cambia algo, todos los clientes deben actualizar | ⭐⭐⭐ |

---

## 💡 LO QUE TÚ QUIERES IMPLEMENTAR

**MIGRACIÓN DE CONTROL:**

```
ANTES (Actual):
  Cliente → Construye Body → Envía a /api/send-template
  Cliente controla qué dice el mensaje

DESPUÉS (Tu solicitud):
  Cliente → Invoca /api/send-template-v2
  ↓
  Nuestro servidor → Aplica template LOCAL
  ↓
  Nuestro servidor → Personaliza con datos del cliente
  ↓
  Nuestro servidor → Envía al usuario
  Cliente NO controla la construcción del mensaje

FALLBACK (Migración lenta):
  if (clienteUsandoNuevoSistema) {
    → Usar new GlobalTemplates
  } else {
    → Usar Body como viene (compatibilidad)
  }
```

---

## 🏗️ ARQUITECTURA ACTUAL COMPLETA

### Componentes Clave

```
┌─ TIPOS (lib/types.ts)
│  ├─ WhatsAppConfig
│  ├─ GlobalTemplate
│  ├─ GlobalTemplateComponent
│  └─ GlobalTemplateButton
│
├─ DATABASE (lib/db.tsx)
│  ├─ getWhatsAppConfig(cliente_id)
│  ├─ getWhatsAppConfigByPhoneId(phoneId)
│  ├─ createGlobalTemplate(template)
│  ├─ getGlobalTemplate(id)
│  ├─ getAllGlobalTemplates()
│  ├─ updateGlobalTemplate(id, updates)
│  └─ deleteGlobalTemplate(id)
│
├─ APIs
│  ├─ POST /api/send-template ← CLIENTE INVOCA ESTO
│  ├─ GET /api/test-template  ← Testing manual
│  ├─ GET /api/whatsapp/templates ← Lee de Meta
│  ├─ POST /api/whatsapp/templates/create ← Crea en Meta
│  ├─ POST /api/global-templates ← Crea local
│  ├─ GET /api/global-templates ← Lee locales
│  ├─ PATCH /api/global-templates/[id] ← Actualiza
│  └─ DELETE /api/global-templates/[id] ← Elimina
│
├─ DASHBOARD
│  ├─ components/dashboard/whatsapp-template-creator.tsx
│  ├─ components/dashboard/whatsapp-config-form.tsx
│  └─ app/dashboard/config/[id]/page.tsx
│
└─ UTILS
   └─ lib/whatsapp-api.ts
      ├─ sendWhatsAppMessage()
      ├─ sendWhatsAppTemplate()
      └─ ...otros
```

---

## 📊 FLUJO DE DATOS ACTUAL

### Diagrama de Flujo Completo

```
CLIENTE EXTERNO (Software de Turnos)
         ↓
    [construye Body]
         ↓
    POST /api/send-template
         ↓
    [ validaciones ]
         ↓
    [ busca WhatsAppConfig ]
         ↓
    [ normaliza teléfono ]
         ↓
    [ llama sendWhatsAppMessage() ]
         ↓
    [ Meta WhatsApp API ]
         ↓
    [ Redis: saveConversationMessage ]
         ↓
    [ OpenAI: notifyOpenAIAboutTemplate ]
         ↓
    USUARIO recibe mensaje
         ↓
    [ responde ]
         ↓
    [ webhook de Meta ]
         ↓
    [ whatsapp.tsx procesa respuesta ]
         ↓
    [ detecta si es confirmación/cancelación ]
         ↓
    [ flujos de chatbot o recordatorios ]
```

---

## 🔐 SEGURIDAD ACTUAL

- ✅ `Cliente_Id` requerido → valida que cliente tenga config activa
- ✅ `Telefono` requerido (explícitamente) → NUNCA usa fallback
- ✅ `accessToken` se obtiene de BD (no envía cliente)
- ✅ Messages se guardan en Redis (auditoría)
- ✅ Validación básica del Body (no puede estar vacío)

---

## 🎨 TEMPLATES EN DASHBOARD

**Componente:** `whatsapp-template-creator.tsx`

**Funcionalidades:**
- Crear templates con header/body/footer/buttons
- Seleccionar idioma (9 opciones)
- Seleccionar categoría (UTILITY, MARKETING, AUTHENTICATION)
- Previsualizar
- Enviar a Meta para aprobación

**PERO:** Esto es para templates **registrados en Meta**, no para nuestros templates personalizados.

---

## 🚨 LIMITACIÓN ACTUAL

```
El sistema ACTUAL NO TIENE lugar para almacenar
"templates personalizados del cliente" que nosotros 
manejemos centralmente.

GlobalTemplates existen pero:
- Son globales para TODOS los clientes
- No hay campo de "cliente_id" en GlobalTemplate
- No hay filtrado por cliente
- No se usa en /api/send-template actualmente
```

---

## 📈 MÉTRICAS ACTUALES

Se guardan pero a nivel global:
- `template_sent` → guardado en Redis/Conversation
- Respuestas (confirmación/cancelación) → detectadas por chatbot

**NO HAY:**
- Métricas específicas por template
- Análisis de qué template se usó
- Tracking de performance por template
- Diferenciación entre templates del cliente vs. nuestros

---

## ✅ LO QUE NECESITAS CAMBIAR

Para implementar tu visión (cliente en modo REMINDERS_ONLY):

### 1. **Modificar `/api/send-template`:**
   ```typescript
   POST /api/send-template (NEW)
   
   // Si cliente está en modo REMINDERS_ONLY
   if (cliente.mode === "REMINDERS_ONLY") {
     // Usar template del cliente configurado
     const template = await getClientReminderTemplate(cliente_id, "appointment_reminder")
     const personalizedBody = applyPersonalization(template, variables)
     // Enviar personalizedBody
   } else {
     // Usar Body como viene (compatibilidad)
     const personalizedBody = Body
   }
   
   // Enviar igual
   await sendWhatsAppMessage(..., personalizedBody)
   ```

### 2. **Crear tabla/tipo `ClientReminderTemplate`:**
   ```typescript
   interface ClientReminderTemplate {
     id: string
     cliente_id: string
     type: "appointment_reminder" | "cancellation" | "derivation"
     body: string              // Template con {{variables}}
     language: string
     active: boolean
     createdAt: string
     updatedAt: string
   }
   ```

### 3. **Crear UI en dashboard:**
   - Sección "Plantillas de Recordatorios" (solo si modo = REMINDERS_ONLY)
   - Editar cada template
   - Variables disponibles: {{nombre}}, {{fecha}}, {{hora}}, {{profesional}}, etc.
   - Preview en tiempo real

### 4. **Añadir personalization engine:**
   ```typescript
   function applyPersonalization(template: string, variables: Record<string, string>): string {
     return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] || `{{${key}}}`)
   }
   // "Hola {{nombre}}, {{fecha}} a {{hora}}" 
   // + { nombre: "Juan", fecha: "mañana", hora: "15:00" }
   // = "Hola Juan, mañana a 15:00"
   ```

### 5. **Migración gradual:**
   - Campo en cliente: `template_mode: "LEGACY" | "MANAGED"`
   - Default = LEGACY (actual)
   - Cliente activa = MANAGED (nuevo)
   - Fallback automático si template no existe

---

## 📋 CHECKLIST DE CAMBIOS NECESARIOS

- [ ] Tipo `ClientReminderTemplate` en `lib/types.ts`
- [ ] CRUD en `lib/db.tsx` para `ClientReminderTemplate`
- [ ] API `/api/client-reminder-templates/*` (GET, POST, PATCH, DELETE)
- [ ] Lógica en `/api/send-template` para detectar modo y aplicar template
- [ ] Engine de personalización (reemplazar {{variables}})
- [ ] UI en dashboard para editar templates (por cliente)
- [ ] Métricas por template
- [ ] Tests unitarios
- [ ] Documentación para clientes

---

## 🎯 IMPACTO

**Backward Compatibility:**
- ✅ Clientes actuales funcionan como antes (LEGACY mode)
- ✅ Soporte para MANAGED mode cuando lo activen
- ✅ Migración sin interrupciones

**Beneficios:**
- Consistencia en mensajes
- Control centralizado
- Fácil A/B testing
- Analytics mejorado
- Personalización sin código

**Riesgo:**
- ⭐ Bajo (nueva funcionalidad, no toca actual)
- Fallback automático si algo falla

---

## 📞 PRÓXIMOS PASOS

1. Apruebas este análisis
2. Validamos la arquitectura
3. Comenzamos implementación
4. Testing con cliente piloto
5. Migración gradual de clientes existentes

