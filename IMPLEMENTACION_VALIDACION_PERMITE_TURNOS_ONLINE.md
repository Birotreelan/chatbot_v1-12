# Implementación de Validación: Permite_Turnos_Online

## Resumen de Cambios

Se ha implementado la validación del campo `Permite_Turnos_Online` en ambos flujos de agendamiento (pacientes nuevos y existentes). Cuando una obra social NO permite turnos online, el sistema muestra un mensaje con el número de derivación y termina el flujo.

---

## Cambios Implementados

### 1. **Archivo: `lib/conversation-state/shared/types.ts`**

**Cambio:** Actualización de la interfaz `ObraSocialOption`

```typescript
export interface ObraSocialOption {
  numero: number
  id: string
  nombre: string
  razonSocial?: string
  permite_turnos_online?: boolean // 🆕 NUEVO CAMPO
}
```

**Propósito:** Agregar el campo `permite_turnos_online` a las opciones de obras sociales para que pueda validarse cuando el usuario selecciona.

---

### 2. **Archivo: `lib/conversation-state/new-patient/new-patient-flow-integration.ts`**

**Cambio 2.1:** Validación en `handleObraSocialPhase` (cuando encuentra 1 obra social)

Ubicación: Línea ~354

```typescript
if (result.datos.total_encontradas === 1) {
  const obraSocial = result.datos.obras_sociales[0]
  
  // 🆕 VALIDAR SI PERMITE TURNOS ONLINE
  if (obraSocial.permite_turnos_online === false) {
    const numeroDerivacion = process.env.ESCALATION_PHONE_NUMBER || '[NÚMERO DE DERIVACIÓN]'
    logger.warn('Obra social no permite turnos online', { 
      obraSocialId: obraSocial.id, 
      nombre: obraSocial.nombre 
    })
    
    return {
      handled: true,
      message: `Gracias ${state.patientFirstName}. Lamentablemente, ${obraSocial.nombre} no está habilitada para agendar turnos por este medio.

Para agendar tu turno, por favor contactanos al: *${numeroDerivacion}*`,
    }
  }
  
  // Si permite_turnos_online === true, continuar normalmente
  state.obraSocialId = obraSocial.id
  // ... resto del código
}
```

**Cambio 2.2:** Agregar `permite_turnos_online` al mapeo de opciones

```typescript
const opciones: ObraSocialOption[] = result.datos.obras_sociales.slice(0, 5).map((os, i) => ({
  numero: i + 1,
  id: os.id,
  nombre: os.nombre,
  razonSocial: os.razon_social,
  permite_turnos_online: os.permite_turnos_online, // 🆕 AGREGAR CAMPO
}))
```

**Cambio 2.3:** Validación en `handleObraSocialSelectionPhase` (cuando user selecciona de múltiples)

```typescript
if (selectedOption) {
  // 🆕 VALIDAR SI PERMITE TURNOS ONLINE
  if (selectedOption.permite_turnos_online === false) {
    const numeroDerivacion = process.env.ESCALATION_PHONE_NUMBER || '[NÚMERO DE DERIVACIÓN]'
    logger.warn('Obra social seleccionada no permite turnos online', { 
      id: selectedOption.id, 
      nombre: selectedOption.nombre 
    })
    
    return {
      handled: true,
      message: `Gracias ${state.patientFirstName}. Lamentablemente, ${selectedOption.nombre} no está habilitada para agendar turnos por este medio.

Para agendar tu turno, por favor contactanos al: *${numeroDerivacion}*`,
    }
  }
  
  // Si permite_turnos_online === true, continuar normalmente
  state.obraSocialId = selectedOption.id
  // ... resto del código
}
```

---

### 3. **Archivo: `lib/conversation-state/existing-patient/existing-patient-flow-integration.ts`**

**Cambio 3.1:** Agregar import

```typescript
import { validarObraSocial } from '@/lib/api-tools/api-functions' // 🆕 IMPORT PARA VALIDAR OBRA SOCIAL
```

**Cambio 3.2:** Validación en `initializeExistingPatientFlow` 

Ubicación: Después de enriquecer datos del paciente (línea ~290)

```typescript
// 🆕 VALIDAR SI LA OBRA SOCIAL PERMITE TURNOS ONLINE
if (finalObraSocialNombre) {
  try {
    const obraSocialValidation = await validarObraSocial(clientId, finalObraSocialNombre)
    
    if (obraSocialValidation.exito && obraSocialValidation.datos.obras_sociales.length > 0) {
      const obraSocial = obraSocialValidation.datos.obras_sociales[0]
      
      if (obraSocial.permite_turnos_online === false) {
        const numeroDerivacion = process.env.ESCALATION_PHONE_NUMBER || '[NÚMERO DE DERIVACIÓN]'
        logger.warn('Obra social de paciente existente no permite turnos online', {
          obraSocialId: finalObraSocialId,
          obraSocialNombre: finalObraSocialNombre,
        })
        
        return {
          handled: true,
          message: `Hola ${finalPatientFirstName}. Lamentablemente, tu obra social (${finalObraSocialNombre}) no está habilitada para agendar turnos por este medio.

Para agendar tu turno, por favor contactanos al: *${numeroDerivacion}*`,
          action: 'obra_social_no_permite_turnos_online',
        }
      }
    }
  } catch (error) {
    logger.warn('Error validating obra social for existing patient', error as Error)
    // Continuar aunque falle la validación
  }
}
```

---

## Matriz de Decisión

| Escenario | Tipo Paciente | `permite_turnos_online` | Acción |
|-----------|---------------|------------------------|--------|
| 1 | Nuevo | `true` | Continuar con flujo normal |
| 2 | Nuevo | `false` | Mostrar número de derivación y terminar |
| 3 | Nuevo | `null` (error API) | Asumir `true` (fallback) y continuar |
| 4 | Existente | `true` | Continuar con flujo normal |
| 5 | Existente | `false` | Mostrar número de derivación y terminar |
| 6 | Existente | `null` (error API) | Continuar (fallback) |

---

## Configuración Requerida

**Variable de entorno:** `ESCALATION_PHONE_NUMBER`

- Se usa en los mensajes cuando una obra social NO permite turnos online
- Debe estar configurada en el proyecto para que se muestre el número de derivación
- Si no está configurada, mostrará `[NÚMERO DE DERIVACIÓN]`

---

## Flujo Conversacional Resultante

### Paciente Nuevo - Obra Social PERMITE Turnos Online

```
Usuario: "PAMI"
→ API devuelve permite_turnos_online: true
Iris: "Gracias María. Tu cobertura es PAMI.

Para continuar, selecciona la sede donde querés atenderte:

1. Clínica De Ojos
   Ubicación: Mansilla 296, Santa Rosa La Pampa, Rio Negro

Responde con el número de la sede que prefieras."
```

✅ Continúa normalmente al siguiente paso

---

### Paciente Nuevo - Obra Social NO PERMITE Turnos Online

```
Usuario: "PAMI"
→ API devuelve permite_turnos_online: false
Iris: "Gracias María. Lamentablemente, PAMI no está habilitada para agendar turnos por este medio.

Para agendar tu turno, por favor contactanos al: *+54 9 123 4567890*"
```

❌ Flujo termina, usuario derivado a teléfono

---

### Paciente Nuevo - Múltiples Opciones, Selecciona una sin Permisos

```
Usuario: "Swiss"
→ API devuelve múltiples opciones
Iris: "Encontre varias opciones para 'Swiss':

1. Swiss Medical
2. Swiss Medical Plus

Responde con el número de tu obra social."

Usuario: "1"
→ API devuelve permite_turnos_online: false para Swiss Medical
Iris: "Gracias María. Lamentablemente, Swiss Medical no está habilitada para agendar turnos por este medio.

Para agendar tu turno, por favor contactanos al: *+54 9 123 4567890*"
```

❌ Flujo termina en la selección

---

### Paciente Existente - Obra Social NO PERMITE Turnos Online

```
Sistema detecta paciente existente con PAMI
→ Valida en initializeExistingPatientFlow
→ API devuelve permite_turnos_online: false
Iris: "Hola Juan. Lamentablemente, tu obra social (PAMI) no está habilitada para agendar turnos por este medio.

Para agendar tu turno, por favor contactanos al: *+54 9 123 4567890*"
```

❌ Flujo termina inmediatamente, sin mostrar sedes

---

## Comportamiento de Errores

### Si la validación de API falla:
- **Paciente Nuevo:** Asume `true` y continúa (fallback permisivo)
- **Paciente Existente:** Muestra advertencia en logs y continúa (fallback permisivo)

### Si `ESCALATION_PHONE_NUMBER` no está configurada:
- Muestra placeholder `[NÚMERO DE DERIVACIÓN]` en el mensaje
- No bloquea el flujo, solo falta información

---

## Testing Recomendado

1. **Paciente Nuevo - Con permisos:**
   - Ingresar obra social con `permite_turnos_online: true`
   - Verificar que continúe al paso de sedes

2. **Paciente Nuevo - Sin permisos (1 resultado):**
   - Ingresar obra social con `permite_turnos_online: false`
   - Verificar que muestre número de derivación

3. **Paciente Nuevo - Sin permisos (múltiples resultados):**
   - Ingresar texto que devuelva múltiples opciones
   - Seleccionar una con `permite_turnos_online: false`
   - Verificar que muestre número de derivación

4. **Paciente Existente - Sin permisos:**
   - Crear paciente existente con obra social sin permisos
   - Verificar que muestre derivación al inicializar flujo

---

## Status de Implementación

✅ Build exitoso: `pnpm run build` sin errores  
✅ Validación implementada en pacientes nuevos (1 y múltiples opciones)  
✅ Validación implementada en pacientes existentes  
✅ Uso de `ESCALATION_PHONE_NUMBER` desde environment  
✅ Logging de eventos de rechazo por obra social  
✅ Fallback permisivo en caso de errores de API  
✅ Cambios persistidos en rama actual
