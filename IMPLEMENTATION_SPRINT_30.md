# Sprint 30: Implementación de Flujo Multiusuario (Familiar)

## Cambios Implementados

### 1. **Menú Principal Actualizado**
- **Archivo:** `lib/conversation-state/patient-detection/patient-templates.ts`
- **Cambios:**
  - `buildExistingPatientNoTurnosGreeting()`: Agregada opción 3 "Solicitar turno para un familiar"
  - `buildNewPatientGreeting()`: Agregada opción 3 para pacientes no identificados
  - `buildSingleTurnoGreeting()`: Agregada opción 4 para pacientes con 1 turno
  - `buildMultipleTurnosGreeting()`: Agregada opción 4 para pacientes con múltiples turnos
- **Beneficio:** Usuarios ahora ven explícitamente la opción de agendar para un familiar

### 2. **Handler de Detección de Opciones**
- **Archivo:** `lib/conversation-state/patient-detection/patient-flow-handler.ts`
- **Cambios:**
  - Actualizado mapeo de acciones en `processPatientDetectionMessage()` para incluir `book_family_appointment`
  - Opción 3/4 mapea a la acción `'book_family_appointment'`
  - Regex de detección de 1-4 ya estaba implementado correctamente
- **Beneficio:** Sistema detecta la selección de opción 3 correctamente

### 3. **Multi-Patient Handler (NUEVO)**
- **Archivo:** `lib/conversation-state/shared/multi-patient-handler.ts` (nuevamente creado)
- **Funcionalidades:**
  - `initializeMultiPatientFlow()`: Inicia flujo cuando usuario selecciona opción 3
  - `handleTargetDNIInput()`: Procesa DNI del familiar con búsqueda en API
  - `handleTargetNameInput()`: Captura nombre si el familiar no existe
  - `isMultiPatientFlowActive()`: Verifica si hay flujo activo
  - `getTargetPatientInfo()`: Obtiene datos del familiar
  - `clearMultiPatientFlow()`: Limpia estado después de completar
- **Beneficio:** Flujo completo para buscar/crear familiar con validación de API

### 4. **Tipos Ampliados**
- **Archivo:** `lib/conversation-state/types.ts`
- **Cambios:**
  - Agregadas fases: `family_patient_awaiting_dni`, `family_patient_awaiting_name`, `family_patient_found`, `family_patient_new_creating`, `family_patient_completed`
- **Beneficio:** Tipos tipados para máquina de estados del flujo multiusuario

### 5. **Mensaje de "Persona Equivocada" Contextual**
- **Archivo:** `lib/conversation-state/wrong-number-handler.ts`
- **Cambios:**
  - `buildWrongNumberResponse()` ahora toma parámetro `hasRecentReminder: boolean`
  - Si NO hay recordatorio reciente: muestra menú "¿Para ti o para otra persona?" → Opción 2 lleva a familiar
  - Si hay recordatorio: muestra mensaje de disculpa (comportamiento original)
- **Beneficio:** Usuario que dice "no soy esa persona" puede agendar para sí o para familiar sin confusión

### 6. **Integración en WhatsApp Handler**
- **Archivo:** `lib/whatsapp.tsx`
- **Cambios:**
  - Import del `multi-patient-handler`
  - Case para `'book_family_appointment'`: Inicia flujo multiusuario
  - Verificación de `isMultiPatientFlowActive()` en verificación de flujos activos
  - Manejo de `awaiting_target_dni` y `awaiting_target_name` fases
  - Integración con flujos de paciente existente/nuevo después de validar familiar
- **Beneficio:** Flujo completo integrado en el sistema de procesamiento de WhatsApp

## Flujos Soportados

### Flujo 1: Familiar Existente (Opción 3)
```
Usuario: 3
Bot: ¿Cuál es el DNI de la persona para la que deseas agendar el turno?
Usuario: 35.987.654
Bot: Perfecto. Encontré a Juan García (DNI 35.987.654)
      Vamos a agendar su turno.
      ¿Qué obra social tiene?
→ Continúa con flujo de paciente existente
```

### Flujo 2: Familiar Nuevo (Opción 3 → No existe)
```
Usuario: 3
Bot: ¿Cuál es el DNI de la persona para la que deseas agendar el turno?
Usuario: 39.654.321
Bot: Perfecto, lo agendaremos como Paciente Nuevo.
      ¿Cuál es el nombre de esta persona?
Usuario: Roberto López
Bot: Perfecto, Roberto López. Vamos a crear su registro.
      ¿Qué obra social tiene?
→ Continúa con flujo de paciente nuevo
```

### Flujo 3: Persona Equivocada (Consulta Directa)
```
Usuario: hola
Bot: Hola Ariel! ¡Bienvenido de nuevo...
     1- Solicitar turno médico
     2- Realizar otra consulta
     3- Solicitar turno para un familiar
Usuario: no soy ariel
Bot: Ah, entendido. ¿Para quién deseas agendar un turno entonces?
     1- Para ti mismo/a
     2- Para otra persona
Usuario: 2
Bot: ¿Cuál es el DNI de esa persona?
→ Continúa como Flujo 1 o 2
```

## Variables de Estado (Redis)

### Multi-Patient Flow State
```typescript
{
  requesterPhoneNumber: string        // Teléfono que hace la solicitud
  requesterPatientName?: string       // Nombre del solicitante
  requesterPatientId?: string         // ID del solicitante
  requesterDNI?: string               // DNI del solicitante
  
  targetPatientDNI?: string           // DNI del familiar
  targetPatientName?: string          // Nombre del familiar
  targetPatientId?: string            // ID del familiar
  targetPatientLastName?: string      // Apellido del familiar
  targetPatientEmail?: string         // Email del familiar
  
  phase: 'awaiting_target_dni' | 'awaiting_target_name' | 'completed' | 'error'
  attempts: number
  createdAt: number
  lastUpdated: number
}
```

TTL: 2 horas (7200 segundos)
Clave Redis: `multi_patient_flow:{phoneNumber}`

## Validaciones

✅ DNI válido (7-9 dígitos, sin puntos/espacios)
✅ Búsqueda en API de clínica
✅ Nombre mínimo 3 caracteres
✅ Mensajes contextualizados según el escenario
✅ Transición suave entre flujos (multiusuario → paciente existente/nuevo)

## Testing Manual

### Test 1: Madre agendando para hijo (existente)
1. Enviar "3" desde teléfono de madre
2. Enviar DNI del hijo
3. Sistema debe mostrar datos del hijo y continuar con flujo de paciente existente

### Test 2: Padre agendando para hijo nuevo
1. Enviar "3" desde teléfono de padre
2. Enviar DNI inválido (no existe)
3. Sistema debe pedir nombre
4. Enviar nombre del hijo
5. Sistema debe continuar con flujo de paciente nuevo

### Test 3: Usuario diciendo "no soy esa persona"
1. Contactar desde teléfono registrado a otro nombre
2. Enviar "no soy ariel" (variante del patrón de número equivocado)
3. Sistema debe preguntar "¿Para ti o para otra persona?"
4. Seleccionar opción 2 (otra persona)
5. Ingresar DNI del familiar
6. Sistema debe continuar como Test 1 o 2

## Archivos Modificados

| Archivo | Cambios |
|---------|---------|
| `lib/conversation-state/patient-detection/patient-templates.ts` | +15 líneas (opciones de menú) |
| `lib/conversation-state/patient-detection/patient-flow-handler.ts` | +4 líneas (mapeo de opción 3/4) |
| `lib/conversation-state/shared/multi-patient-handler.ts` | +314 líneas (NUEVO) |
| `lib/conversation-state/types.ts` | +7 líneas (fases nuevas) |
| `lib/conversation-state/wrong-number-handler.ts` | +17 líneas (parámetro contextual) |
| `lib/whatsapp.tsx` | +92 líneas (integración completa) |

**Total: ~449 líneas de código nuevo/modificado**

## Backward Compatibility

✅ No cambios breaking
✅ Flujos existentes mantienen funcionamiento idéntico
✅ Feature flags no afectados
✅ APIs de existentes/nuevos pacientes sin cambios
✅ Nuevas opciones de menú son aditivas

## Próximos Pasos (Futuro)

- Agregar opción de "múltiples familiares" en una sola sesión
- Historial de familiares agendados frecuentemente
- Validación de parentesco (opcional, según política clínica)
- Dashboard para ver turnos agendados para familiares
