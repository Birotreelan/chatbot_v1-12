# Guia de Implementacion - Sistema Determinístico Sprint 9

## Resumen del Sistema

El Sprint 9 implementa un sistema completamente determinístico para manejar pacientes que escriben SIN recordatorio previo. Esto reduce drasticamente las llamadas a OpenAI y mejora la latencia.

### Componentes Implementados

| Componente | Descripcion | Feature Flag |
|------------|-------------|--------------|
| Deteccion Inicial | Detecta paciente por telefono, muestra saludo + turnos | `directPatientDetection` |
| Flujo Paciente Existente | Reserva de turnos para pacientes registrados | `directExistingPatientFlow` |
| Flujo Paciente Nuevo | Registro + reserva para pacientes nuevos | `directPacienteNuevo` |
| NLU Auxiliar | Interpreta texto libre cuando no es seleccion numerica | (automatico) |

---

## Paso 1: Verificar Feature Flags Actuales

Puedes verificar los flags actuales desde el dashboard o via API/script:

```typescript
// En un script o API route
import { getEffectiveFeatureFlags, getGlobalFeatureFlags } from "@/lib/conversation-state"

// Ver flags globales
const globalFlags = await getGlobalFeatureFlags()
console.log("Flags globales:", globalFlags)

// Ver flags efectivos para un cliente
const clientFlags = await getEffectiveFeatureFlags("config_id_del_cliente")
console.log("Flags del cliente:", clientFlags)
```

---

## Paso 2: Activar Feature Flags (Gradual)

### Opcion A: Activar para UN cliente de prueba (recomendado)

```typescript
import { setClientFeatureFlags } from "@/lib/conversation-state"

// Activar SOLO deteccion inicial para un cliente piloto
await setClientFeatureFlags("config_id_cliente_piloto", {
  directPatientDetection: true,
  directExistingPatientFlow: false, // Mantener OFF inicialmente
  directPacienteNuevo: false,       // Mantener OFF inicialmente
})
```

### Opcion B: Activar GLOBALMENTE (para todos los clientes)

```typescript
import { setGlobalFeatureFlags } from "@/lib/conversation-state"

// Activar para TODOS los clientes sin flags especificos
await setGlobalFeatureFlags({
  directPatientDetection: true,
  directExistingPatientFlow: true,
  directPacienteNuevo: true,
})
```

---

## Paso 3: Plan de Rollout Recomendado

### Semana 1: Solo Deteccion Inicial
```typescript
await setClientFeatureFlags("cliente_piloto_1", {
  directPatientDetection: true,
})
```
- Monitorear logs: `[WHATSAPP] Iniciando deteccion de paciente`
- Verificar que muestra saludo personalizado
- Verificar que menu de opciones funciona

### Semana 2: Agregar Flujo Paciente Existente
```typescript
await setClientFeatureFlags("cliente_piloto_1", {
  directPatientDetection: true,
  directExistingPatientFlow: true,
})
```
- Monitorear: `[WHATSAPP] Procesando mensaje en flujo de paciente existente`
- Verificar seleccion de sede, turnos, confirmacion

### Semana 3: Agregar Flujo Paciente Nuevo
```typescript
await setClientFeatureFlags("cliente_piloto_1", {
  directPatientDetection: true,
  directExistingPatientFlow: true,
  directPacienteNuevo: true,
})
```
- Monitorear: `[WHATSAPP] Procesando mensaje en flujo de paciente nuevo`
- Verificar registro completo + reserva

### Semana 4: Rollout Global
```typescript
await setGlobalFeatureFlags({
  directPatientDetection: true,
  directExistingPatientFlow: true,
  directPacienteNuevo: true,
})
```

---

## Paso 4: Monitoreo

### Logs a buscar en Vercel/CloudWatch:

**Exito:**
```
[WHATSAPP] Iniciando deteccion de paciente para +5491112345678
[WHATSAPP] Deteccion iniciada, enviando mensaje
[WHATSAPP] Procesando mensaje en flujo de paciente existente
[WHATSAPP] Procesando mensaje en flujo de paciente nuevo
```

**Fallback a OpenAI (esperado para texto libre):**
```
[PATIENT-DETECTION] Non-numeric input, requires NLU
```

**Errores a investigar:**
```
[FEATURE-FLAGS] Redis no disponible
[PATIENT-DETECTION] Error in patient detection
[EXISTING-PATIENT] Error fetching turns
```

### Metricas Clave:
- Latencia promedio de respuesta (debe bajar de 2-3s a <500ms)
- Porcentaje de mensajes procesados sin OpenAI (objetivo: >80%)
- Tasa de errores en flujos determinísticos

---

## Paso 5: Rollback de Emergencia

### Si algo falla, desactivar inmediatamente:

**Para un cliente especifico:**
```typescript
import { resetClientFeatureFlags } from "@/lib/conversation-state"

// Resetea a defaults (todos OFF)
await resetClientFeatureFlags("config_id_cliente_problematico")
```

**Para TODOS los clientes (rollback global):**
```typescript
import { resetGlobalFeatureFlags } from "@/lib/conversation-state"

// Resetea flags globales a defaults
await resetGlobalFeatureFlags()
```

El rollback es instantaneo - no requiere deploy.

---

## Paso 6: Crear Script de Activacion

Puedes crear un script en `scripts/activate-sprint9.ts`:

```typescript
import { setGlobalFeatureFlags, getGlobalFeatureFlags } from "@/lib/conversation-state"

async function main() {
  const action = process.argv[2] // "enable" o "disable" o "status"
  
  if (action === "status") {
    const flags = await getGlobalFeatureFlags()
    console.log("Feature Flags Actuales:", JSON.stringify(flags, null, 2))
    return
  }
  
  if (action === "enable") {
    await setGlobalFeatureFlags({
      directPatientDetection: true,
      directExistingPatientFlow: true,
      directPacienteNuevo: true,
    })
    console.log("Sprint 9 ACTIVADO globalmente")
    return
  }
  
  if (action === "disable") {
    await setGlobalFeatureFlags({
      directPatientDetection: false,
      directExistingPatientFlow: false,
      directPacienteNuevo: false,
    })
    console.log("Sprint 9 DESACTIVADO globalmente")
    return
  }
  
  console.log("Uso: npx ts-node scripts/activate-sprint9.ts [enable|disable|status]")
}

main().catch(console.error)
```

Ejecutar:
```bash
# Ver estado actual
npx ts-node scripts/activate-sprint9.ts status

# Activar
npx ts-node scripts/activate-sprint9.ts enable

# Desactivar (rollback)
npx ts-node scripts/activate-sprint9.ts disable
```

---

## Flujo Completo del Sistema

```
Usuario escribe mensaje (sin recordatorio previo)
    |
    v
[whatsapp.tsx] Verifica feature flags
    |
    +-- directPatientDetection = false --> OpenAI asst_router (flujo actual)
    |
    +-- directPatientDetection = true
            |
            v
        [initializePatientDetection]
            |
            +-- Paciente encontrado por telefono
            |       |
            |       v
            |   Muestra saludo + turnos + menu (1-4)
            |       |
            |       +-- Usuario selecciona numero --> Backend procesa
            |       +-- Usuario escribe texto --> NLU interpreta
            |
            +-- Paciente NO encontrado
                    |
                    v
                Solicita DNI --> [newPatientFlow]
                    |
                    v
                Registra + reserva turno
```

---

## Checklist Pre-Activacion

- [ ] Verificar que Redis (Upstash) esta funcionando
- [ ] Verificar que ClinicAPI responde correctamente
- [ ] Probar con numero de telefono de prueba
- [ ] Confirmar que logs aparecen en Vercel
- [ ] Tener plan de rollback listo
- [ ] Notificar al equipo de soporte

---

## Soporte

Si encuentras problemas:
1. Revisar logs en Vercel Dashboard
2. Verificar estado de Redis en Upstash Console
3. Ejecutar rollback si es necesario
4. Documentar el error para investigacion
