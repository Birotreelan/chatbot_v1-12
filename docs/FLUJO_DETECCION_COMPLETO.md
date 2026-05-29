# Flujo de Detección Inicial de Paciente - Completo

## Visión General

Cuando un usuario escribe a WhatsApp **sin un recordatorio previo**, el sistema sigue un flujo determinístico (100% backend, sin OpenAI inicial) para identificar al paciente:

```
Usuario escribe sin recordatorio
        ↓
    Buscar por teléfono
        ↓
    ├─ No encontrado → Paciente NUEVO (solicitar DNI)
    ├─ Múltiples → Solicitar DNI para DESAMBIGUAR
    └─ Uno solo → Paciente EXISTENTE (mostrar saludo + turnos)
```

---

## Flujo Paso a Paso

### Paso 1: Inicialización (Sin Recordatorio)

**Ubicación:** `lib/whatsapp.tsx` línea ~1247

```typescript
// Usuario escribe sin recordatorio previo
const detectionResult = await initializePatientDetection(
  userPhoneNumber,    // Número del usuario
  config.id,          // configId para flags (WhatsApp)
  config.cliente_id   // clienteId para API (Sistema Clínica)
)
```

**Responsable:** `patient-flow-integration.ts` → `initializePatientDetection()`

---

### Paso 2: Búsqueda por Teléfono

**Ubicación:** `lib/conversation-state/patient-detection/patient-flow-handler.ts`

```typescript
// Consultar API de la clínica
const patientResponse = await clinicAPI.paciente_telefono(phoneNumber)
```

**API Call:**
- **Action:** `get_paciente`
- **Params:** `{ telefono: "549xxxxxxxxx" }`
- **Response:**
  - `null` → Paciente no existe
  - `{ object }` → Paciente único encontrado
  - `{ array }` → Múltiples pacientes
  - `{ multiple: true, pacientes: [...] }` → Múltiples pacientes (formato alternativo)

---

### Paso 3: Lógica de Decisión

#### **CASO A: Paciente No Encontrado**

```
Usuario escribe → API retorna null
                    ↓
            Crear estado "awaiting_initial_response"
                    ↓
            Retornar mensaje "solicitar DNI"
                    ↓
            Usuario envía DNI → ir a Paso 5
```

**Mensaje:**
```
¡Hola! 👋

Bienvenido a nuestro centro. Para continuar, necesito tu número de DNI 
para verificar tu información.

Por favor, ingresa tu DNI (sin puntos ni espacios).

Ejemplo: 12345678
```

---

#### **CASO B: Múltiples Pacientes Encontrados**

```
Usuario escribe → API retorna [{ paciente1 }, { paciente2 }]
                    ↓
            Crear estado "awaiting_dni_for_disambiguation"
            Guardar array de pacientes en Redis
                    ↓
            Retornar mensaje "solicitar DNI para desambiguar"
                    ↓
            Usuario envía DNI → ir a Paso 4
```

**Mensaje:**
```
¡Hola! 👋

Veo que este número está asociado a más de un paciente. 
Para poder ayudarte mejor, por favor indicame tu DNI (7 u 8 dígitos) 
para identificar correctamente tu información.

Ejemplo: 12345678
```

---

#### **CASO C: Paciente Único Encontrado**

```
Usuario escribe → API retorna { paciente }
                    ↓
            Obtener turnos próximos del paciente
            Crear estado "awaiting_action_selection"
                    ↓
            Retornar saludo personalizado + menú
```

**Mensaje:**
```
¡Hola Hugo! 👋

Tu próximo turno es:
📅 viernes, 30 de mayo de 2025 a las 14:30
👨‍⚕️ Dr. García

¿Qué deseas hacer?

1️⃣ Confirmar turno
2️⃣ Cancelar turno
3️⃣ Agendar otro turno
4️⃣ Otra consulta
```

---

### Paso 4: Procesamiento de DNI (Cuando hay Múltiples)

**Ubicación:** `patient-flow-integration.ts` → `handleDNIForMultiplePatients()`

```typescript
// Usuario envía DNI
const result = await processDNIForDisambiguation(
  phoneNumber,
  "12345678",
  configId,
  clienteId
)
```

**Lógica:**
1. Extraer DNI del mensaje (solo números)
2. Validar formato (7-8 dígitos)
3. Buscar en array de múltiples pacientes guardado en Redis
4. Si encontrado → Obtener turnos → Mostrar saludo
5. Si NO encontrado → Permitir 3 intentos, luego marcar como nuevo

**Resultado:**
- ✅ Paciente identificado → Mostrar saludo como Caso C
- ❌ DNI no coincide → Mensaje de error + reintentar
- ❌ 3 intentos fallidos → Marcar como nuevo paciente

---

### Paso 5: Selección Numérica (1-4)

**Ubicación:** `patient-flow-handler.ts` → `processPatientDetectionMessage()`

Una vez identificado el paciente existente, si el usuario envía 1-4:

```
Usuario envía: "2"
        ↓
    Mapear a acción: "cancel_appointment"
        ↓
    Marcar flujo como "completed"
        ↓
    Derivar a flujo específico (cancelación)
```

**Mapeo (Paciente Existente):**
- `1` → `confirm_appointment`
- `2` → `cancel_appointment`
- `3` → `book_new_appointment`
- `4` → `other_inquiry`

---

## Gestión de Estado en Redis

### Estados del Flujo

```typescript
interface PatientDetectionState {
  phase: 
    | 'awaiting_initial_response'           // Nuevo paciente, espera DNI
    | 'awaiting_dni_for_disambiguation'     // Múltiples, espera DNI
    | 'awaiting_action_selection'           // Paciente existente, espera 1-4
    | 'completed'                           // Flujo terminado
  
  patientPhone: string                      // Teléfono del usuario
  patientId?: string                        // ID del paciente (si encontrado)
  patientName?: string                      // Nombre del paciente
  patientDNI?: string                       // DNI del paciente
  turnos?: any[]                            // Array de turnos del paciente
  multiplePatients?: any[]                  // Array si hay múltiples pacientes
  detectedAt: number                        // Timestamp de creación
  attempts: number                          // Intentos de DNI
}
```

### Clave de Redis

```
patient_detection_state:{phoneNumber}
```

**TTL:** 24 horas (86,400 segundos)

---

## Feature Flag

### Activación

```
dashboard/feature-flags → "Detección inicial de paciente" (Sprint 9a)
```

**Nombre:** `directPatientDetection`

**Default:** `false`

**Riesgo:** Alto

Si está desactivado, se derivará a OpenAI (`asst_router`) en lugar de usar el flujo determinístico.

---

## Funciones Principales

### En `patient-flow-handler.ts`

1. **`startPatientDetectionFlow()`**
   - Busca paciente por teléfono
   - Detecta si hay múltiples
   - Obtiene turnos si existe

2. **`processDNIForDisambiguation()`**
   - Procesa DNI cuando hay múltiples pacientes
   - Busca coincidencia
   - Maneja reintentos

3. **`processPatientDetectionMessage()`**
   - Procesa selección numérica (1-4)
   - Mapea a acciones

4. **`getPatientDetectionState()`**
   - Obtiene estado desde Redis

5. **`isPatientDetectionFlowActive()`**
   - Verifica si hay flujo activo

6. **`clearPatientDetectionFlow()`**
   - Limpia estado de Redis

### En `patient-flow-integration.ts`

1. **`initializePatientDetection()`**
   - Punto de entrada principal
   - Retorna mensaje listo para enviar

2. **`handleDNIForMultiplePatients()`**
   - Procesa DNI para múltiples pacientes
   - Retorna mensaje formateado

3. **`handlePatientDetectionMessage()`**
   - Procesa cada mensaje del usuario
   - Decide si requiere NLU

4. **`shouldUsePatientDetection()`**
   - Verifica si usar flujo determinístico

### En `patient-templates.ts`

1. **`buildNewPatientGreeting()`** - Mensaje para paciente nuevo
2. **`buildMultiplePatientGreeting()`** - Mensaje para múltiples pacientes
3. **`buildExistingPatientGreeting()`** - Saludo para paciente existente
4. **`buildSelectionConfirmation()`** - Confirmación de selección

---

## Integración con WhatsApp

**Ubicación:** `lib/whatsapp.tsx` alrededor de línea 1247

```typescript
if (!detectionActive) {
  // Iniciar detección
  const detectionResult = await initializePatientDetection(
    userPhoneNumber,
    config.id,
    config.cliente_id
  )

  if (detectionResult.message) {
    // Enviar mensaje determinístico al usuario
    await sendWhatsAppMessage(userPhoneNumber, detectionResult.message)
  }

  // Si requiere OpenAI, derivar
  if (detectionResult.shouldCallOpenAI) {
    // ... derivar a asst_router
  }
}
```

---

## Ejemplo Real

### Usuario Hugo con Múltiples Pacientes

**Entrada:**
- Teléfono: `549xxxxxxxxx`
- Nombre: Hugo

**Flujo:**
```
1. Hugo escribe: "Hola buen día"
   ↓
2. Sistema busca teléfono → Encontrados 2 pacientes
   ↓
3. Enviar: "Veo que este número está asociado a más de un paciente. 
           Por favor indicame tu DNI..."
   ↓
4. Hugo responde: "8329756"
   ↓
5. Sistema busca DNI en los 2 pacientes → ENCONTRADO (Hugo García, DNI 8329756)
   ↓
6. Obtener turnos del Hugo García
   ↓
7. Enviar: "Hugo, ¡bienvenido de nuevo a Salud Ocular!
           Soy Iris, tu asistente virtual...
           No tienes turnos agendados.
           1- Solicitar turno médico."
   ↓
8. Hugo responde: "1"
   ↓
9. Derivar a flujo de reserva de turnos
```

---

## Fallback a OpenAI

El flujo determinístico se deriva a OpenAI en estos casos:

1. **Feature flag desactivado** → Ir directo a `asst_router`
2. **Redis no disponible** → Enviar mensaje genérico + derivar
3. **API error** → Enviar mensaje genérico + derivar
4. **Texto libre (no numérico)** → Procesar con NLU/OpenAI
5. **3 intentos fallidos de DNI** → Marcar como nuevo paciente

---

## Impacto Esperado

- ✅ **↓ 15-20%** menos llamadas a OpenAI por cliente
- ✅ **<500ms** latencia determinística vs 2-3s con IA
- ✅ **0% errores** de doble identificación de pacientes
- ✅ **Experiencia mejorada** respuesta inmediata

---

## Next Steps

1. Activar flag `directPatientDetection` en dashboard
2. Monitorear logs en `[PATIENT-DETECTION]`
3. Validar detección de múltiples pacientes
4. Medir reducción de llamadas a OpenAI
