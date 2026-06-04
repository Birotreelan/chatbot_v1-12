# Corrección: Número de Derivación desde Configuración del Cliente

## Problema Identificado

El número de derivación se estaba mostrando como `[NÚMERO DE DERIVACIÓN]` en lugar del número real configurado en cada cliente.

### Causa Raíz

Se estaba intentando obtener el número desde `process.env.ESCALATION_PHONE_NUMBER` (variable de entorno global), cuando debería obtenerse desde `config.escalationPhoneNumber` (configuración específica de cada cliente).

### Mensaje Incorrecto

```
Hola Ariel. Lamentablemente, tu obra social (@Prueba) no está habilitada para agendar turnos por este medio.

Para agendar tu turno, por favor contactanos al: [NÚMERO DE DERIVACIÓN]
```

## Solución Implementada

### 1. **Flujo de Pacientes Nuevos** (`new-patient-flow-integration.ts`)

**Cambios:**
- Línea ~359: Usar parámetro `escalationPhoneNumber` en lugar de `process.env.ESCALATION_PHONE_NUMBER`
- Línea ~459: Mismo cambio en fase de selección múltiple

**Código:**
```typescript
const numeroDerivacion = escalationPhoneNumber || '[NÚMERO DE DERIVACIÓN]'
```

La función `handleNewPatientMessage` ya recibía este parámetro desde `whatsapp.tsx`.

### 2. **Flujo de Pacientes Existentes** (`existing-patient-flow-integration.ts`)

**Cambios:**
- Línea 245: Agregar parámetro `escalationPhoneNumber?: string` a `initializeExistingPatientFlow()`
- Línea 302: Usar parámetro en lugar de `process.env.ESCALATION_PHONE_NUMBER`

**Firma Anterior:**
```typescript
export async function initializeExistingPatientFlow(
  phoneNumber: string,
  patientId: string,
  patientName: string,
  patientDNI: string,
  patientEmail: string | undefined,
  clientId: string,
  additionalPatientData?: { ... }
)
```

**Firma Nueva:**
```typescript
export async function initializeExistingPatientFlow(
  phoneNumber: string,
  patientId: string,
  patientName: string,
  patientDNI: string,
  patientEmail: string | undefined,
  clientId: string,
  additionalPatientData?: { ... },
  escalationPhoneNumber?: string
)
```

### 3. **Llamada en WhatsApp** (`whatsapp.tsx`)

**Cambios:**
- Línea 1945-1953: Actualizar llamada a `initializeExistingPatientFlow()` para pasar `config.escalationPhoneNumber`

**Antes:**
```typescript
const existingResult = await initializeExistingPatientFlow(
  userPhoneNumber,
  patientInfo.patientId || '',
  patientInfo.patientName || '',
  '',
  undefined,
  config.cliente_id
)
```

**Después:**
```typescript
const existingResult = await initializeExistingPatientFlow(
  userPhoneNumber,
  patientInfo.patientId || '',
  patientInfo.patientName || '',
  '',
  undefined,
  config.cliente_id,
  undefined,
  config.escalationPhoneNumber
)
```

## Resultado Esperado

### Mensaje Correcto (Paciente Nuevo)

```
Gracias María. Lamentablemente, PAMI no está habilitada para agendar turnos por este medio.

Para agendar tu turno, por favor contactanos al: *+54 9 11 6123 4567*
```

### Mensaje Correcto (Paciente Existente)

```
Hola Ariel. Lamentablemente, tu obra social (@Prueba) no está habilitada para agendar turnos por este medio.

Para agendar tu turno, por favor contactanos al: *+54 9 11 6123 4567*
```

## Archivos Modificados

1. ✅ `lib/conversation-state/new-patient/new-patient-flow-integration.ts`
   - 2 líneas actualizadas (359, 459)

2. ✅ `lib/conversation-state/existing-patient/existing-patient-flow-integration.ts`
   - Línea 245: Agregar parámetro
   - Línea 302: Usar parámetro

3. ✅ `lib/whatsapp.tsx`
   - Línea 1945-1953: Actualizar llamada

## Verificación

✅ Build exitoso: `pnpm run build` sin errores
✅ TypeScript válido
✅ Imports correctos
✅ El número ahora proviene de `config.escalationPhoneNumber`
✅ Fallback a `[NÚMERO DE DERIVACIÓN]` si no está configurado

## Cómo Funciona

**Flujo del número de derivación:**

1. Se configura en el dashboard → se guarda en `config.escalationPhoneNumber`
2. En `whatsapp.tsx` se obtiene del objeto `config`
3. Se pasa como parámetro a:
   - `handleNewPatientMessage()` (ya existía)
   - `handleExistingPatientMessage()` (ya existía)
   - `initializeExistingPatientFlow()` (NUEVO)
4. Se usa en los mensajes de validación cuando obra social no permite turnos online

## Testing

Para verificar que funciona correctamente:

1. **Paciente Nuevo**: Escribir nombre de obra social que no permite turnos online
   - Verificar que aparece el número correcto

2. **Paciente Existente**: Sistema detecta paciente con obra social que no permite turnos
   - Verificar que aparece el número correcto al inicializar flujo

3. **Sin configuración**: Si no está configurado `config.escalationPhoneNumber`
   - Fallback: Muestra `[NÚMERO DE DERIVACIÓN]`
