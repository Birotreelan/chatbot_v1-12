# SPRINT 9a: Detección Inicial de Paciente (Sin Recordatorio Previo)

## Objetivo
Crear el handler determinístico que detecta al paciente por teléfono cuando escribe SIN recordatorio previo, mostrando su saludo personalizado con opciones de acción.

## Arquitectura del Sprint 9a

### Fase 1: Detección por Teléfono
```
User escribe mensaje (sin recordatorio)
    ↓
whatsapp.tsx llama a isPatientDetectionFlowActive()
    ↓
Backend busca paciente por TELEFONO (usando clinic-api.paciente_telefono)
    ↓
3a. Paciente encontrado → showExistingPatientGreeting()
3b. Paciente NO encontrado → showFirstTimeGreeting()
```

### Flujos de Saludo (Determinísticos)

#### 3a. Paciente Existente Encontrado
```
Mostrar:
  - Saludo personalizado con nombre
  - Turnos próximos (si los hay)
  - Menú de opciones:
    1. Confirmar turno próximo
    2. Cancelar turno próximo
    3. Pedir nuevo turno
    4. Otro (volver a OpenAI para lenguaje natural)
```

#### 3b. Paciente Nuevo (No en el sistema)
```
Mostrar:
  - Saludo genérico
  - "Primero necesito saber tu DNI para ubicarte en el sistema"
  - Estado: awaiting_dni
```

## Archivos a Crear

### 1. `lib/conversation-state/patient-detection/patient-flow-handler.ts`
**Responsabilidades:**
- `isPatientDetectionFlowActive()` - Determina si usar flujo determinístico vs OpenAI
- `detectPatientByPhone()` - Busca paciente en API
- `getPatientGreeting()` - Retorna saludo + turnos + menú
- Manejo de estado en Redis (TTL 24h)
- Logging con prefijo `[PATIENT-DETECTION]`

**Funciones Principales:**
```typescript
export async function startPatientDetectionFlow(
  phone: string,
  configId: string
): Promise<PatientDetectionResult>

export async function processPatientMessage(
  phone: string,
  configId: string,
  message: string,
  userMessage: string
): Promise<PatientDetectionResult>

export async function isPatientDetectionFlowActive(
  phone: string,
  configId: string
): Promise<boolean>

export async function getPatientGreeting(
  phone: string,
  configId: string
): Promise<{ message: string; state: PatientDetectionState }>
```

### 2. `lib/conversation-state/patient-detection/patient-templates.ts`
**Responsabilidades:**
- Mensajes de saludo personalizados
- Menú de opciones formateado
- Mensajes de error/transicion

**Templates:**
```typescript
buildExistingPatientGreeting(patientData, turnos)
buildFirstTimeGreeting()
buildPatientMenuOptions()
buildPatientMenuError(reason)
buildTurnoSummary(turno)
```

### 3. `lib/conversation-state/patient-detection/patient-flow-integration.ts`
**Responsabilidades:**
- API limpia para `whatsapp.tsx`
- Decide flujo vs OpenAI basado en feature flags
- Manejo de transiciones de estado

**Función Principal:**
```typescript
export async function handlePatientInitialContact(
  phone: string,
  configId: string,
  userMessage: string
): Promise<{
  shouldProcessDeterministic: boolean
  response?: string
  nextPhase?: ConversationPhase
  fallbackToOpenAI?: boolean
}>
```

## Estados Conversacionales Nuevos

Agregar a `types.ts`:
```typescript
// Flujo de detección inicial
| "initial_detection_pending"
| "initial_detection_existing_shown"
| "initial_detection_new_shown"
| "initial_detection_awaiting_action"
```

## Redis Keys Structure

```
patient_detection:{configId}:{phone} → PatientDetectionState (TTL: 24h)
  {
    phase: "existing_found" | "new_patient",
    pacienteId?: string,
    paciente?: { nombres, apellido, dni, telefono, obra_social_id },
    turnosProximos?: TurnoDisponible[],
    createdAt: ISO,
    updatedAt: ISO
  }
```

## Integración en `whatsapp.tsx`

**En `handleMessage()` ANTES de enviar a OpenAI:**
```typescript
// 1. Verificar si hay recordatorio
const template = await getTemplate(phone, configId)
if (template) {
  // Flujo de recordatorio existente (no cambiar)
  return
}

// 2. NUEVO: Verificar si hay detección de paciente
const isPatientFlow = await isPatientDetectionFlowActive(phone, configId)
if (isPatientFlow) {
  const result = await handlePatientInitialContact(phone, configId, message)
  if (result.shouldProcessDeterministic) {
    if (result.response) {
      // Enviar respuesta determinística
      await sendMessage(phone, result.response)
    }
    // Guardar estado
    if (result.nextPhase) {
      await updateConversationPhase(phone, configId, result.nextPhase)
    }
    return
  }
}

// 3. Si no hay flujo determinístico, enviar a OpenAI
await enqueueMessage(phone, configId, message, userMessage)
```

## Lógica de Activación

El flujo se activa cuando:
1. No hay recordatorio/plantilla pendiente
2. Feature flag `directPatientDetection` está ENABLED
3. Es el primer mensaje del usuario (o después de cierto tiempo sin actividad)

Se desactiva cuando:
1. El usuario elige opción 4 (Otro/OpenAI)
2. El usuario envía texto libre ambiguo
3. Hay timeout de fase

## Casos de Uso Cubiertos

### Usuario Existente
- ✅ Saludo personalizado
- ✅ Mostrar turnos próximos
- ✅ Menú de 4 opciones
- ✅ Detección de números 1-4
- ✅ Fallback a OpenAI si escribe texto libre

### Usuario Nuevo
- ✅ Saludo genérico
- ✅ Solicitar DNI
- ✅ Guardar estado en Redis
- ✅ Transición a DNI extraction

### Errores Manejados
- ✅ API no disponible → Fallback a OpenAI
- ✅ Teléfono sin formato → Normalizar
- ✅ Selección fuera de rango → Mensaje de error + reintentos
- ✅ DNI inválido → Pedir reintento

## Testing Manual

```
1. Paciente existente:
   - Enviar mensaje como +54911123456789 (que exista en sistema)
   - ✅ Debe mostrar saludo personalizado + turnos + menú

2. Paciente nuevo:
   - Enviar mensaje como +54911999999999 (que NO exista)
   - ✅ Debe pedir DNI

3. Selección de turno:
   - Responder "1" al menú
   - ✅ Debe confirmar turno o mostrar error

4. Fallback a OpenAI:
   - Responder "no me siento bien" al menú
   - ✅ Debe derivar a OpenAI
```

## Archivos Afectados

**Nuevos:**
- `lib/conversation-state/patient-detection/patient-flow-handler.ts` (500 líneas)
- `lib/conversation-state/patient-detection/patient-templates.ts` (200 líneas)
- `lib/conversation-state/patient-detection/patient-flow-integration.ts` (300 líneas)

**Modificados:**
- `lib/conversation-state/types.ts` - Agregar estados nuevos
- `lib/conversation-state/index.ts` - Exportar nuevos handlers
- `lib/whatsapp.tsx` - Integrar en `handleMessage()`

**Documentación:**
- Este archivo (plan)

## Transición a Sprint 9b

Una vez este sprint esté completo y testeado:
1. Activar feature flag `directPatientDetection` en cliente de prueba
2. Monitorear logs `[PATIENT-DETECTION]`
3. Luego pasar a Sprint 9b (Flujo Paciente Existente completo)
