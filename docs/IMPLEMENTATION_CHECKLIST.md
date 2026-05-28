# Checklist de Implementación - Sprint 8: Reagendamiento Determinístico

## Fase 1: Verificación ✅ (YA COMPLETADO)

- [x] Crear handler determinístico (`reschedule-flow-handler.ts`)
- [x] Crear templates de mensajes (`reschedule-templates.ts`)
- [x] Crear integración (`reschedule-flow-integration.ts`)
- [x] Crear prompt OpenAI reducido (`route_to_reagendamiento_nlu.md`)
- [x] Crear documentación de integración
- [x] Actualizar memoria del proyecto

**Archivos creados:** 5 archivos + 2 documentos
**Líneas de código:** ~1,200 líneas
**Estado:** Listo para integración

---

## Fase 2: Integración en whatsapp.tsx 🔄 (PRÓXIMO PASO)

### 2.1 Agregar imports

**Ubicación:** Al inicio de `lib/whatsapp.tsx` con los otros imports

```typescript
import {
  startRescheduleFlow,
  processRescheduleMessage,
  isRescheduleFlowActive,
  type RescheduleProcessResult,
} from "./conversation-state/reschedule-flow-integration"
```

**Estado:** ⏳ Pendiente

---

### 2.2 Configurar feature flag en types.ts

**Archivo:** `lib/conversation-state/types.ts`

```typescript
export interface FeatureFlags {
  // ... flags existentes ...
  directReagendamiento: boolean  // ← AGREGAR
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  // ... defaults existentes ...
  directReagendamiento: false,   // ← AGREGAR (desactivado por defecto)
}
```

**Estado:** ⏳ Pendiente

---

### 2.3 Reemplazar sección de reagendamiento en processIndividualMessage()

**Ubicación:** `lib/whatsapp.tsx` línea ~1375-1487

**Acción:** Reemplazar todo el bloque `if (routeToReagendamiento && functionArgs)` con el código en `docs/RESCHEDULE_DETERMINISTIC_INTEGRATION.md` (sección "2. Reemplazar sección de reagendamiento")

**Cambio principal:**
- ANTES: Crea nuevo thread OpenAI, llama a `getAssistantResponse()`
- DESPUES: Valida feature flag, busca turnos, llama a `startRescheduleFlow()`

**Estado:** ⏳ Pendiente

---

### 2.4 Agregar interceptor de flujo activo

**Ubicación:** `lib/whatsapp.tsx` línea ~1550+ (antes del procesamiento normal OpenAI)

**Código a agregar:**
```typescript
// ============================================================================
// INTERCEPTAR SI ESTAMOS EN FLUJO DE REAGENDAMIENTO DETERMINÍSTICO
// ============================================================================
const flags = await getEffectiveFeatureFlags(config.id)

if (flags.directReagendamiento) {
  const inRescheduleFlow = await isRescheduleFlowActive(userPhoneNumber, config.id)
  
  if (inRescheduleFlow) {
    console.log(`[WHATSAPP] 🔄 Usuario en flujo de reagendamiento, procesando con handler determinístico`)
    
    const rescheduleResult = await processRescheduleMessage(
      userMessage,
      value.metadata.phone_number_id,
      config.accessToken,
      userPhoneNumber,
      config.id,
      config.cliente_id
    )

    if (rescheduleResult.handled) {
      console.log(`[WHATSAPP] ✅ Mensaje procesado por flujo determinístico`)
      await updateWhatsAppStats(config.id, { messagesProcessed: 1 })
      return
    } else if (rescheduleResult.fallbackToOpenAI) {
      console.log(`[WHATSAPP] ⚠️ Fallback a OpenAI para NLU`)
      userMessage = `[RESCHEDULE_FALLBACK]${JSON.stringify(rescheduleResult.fallbackContext)}[/RESCHEDULE_FALLBACK]\n\n${userMessage}`
    }
  }
}
```

**Estado:** ⏳ Pendiente

---

## Fase 3: Configuración de Feature Flag 🎯

### 3.1 Verificar que dashboard existe

**Archivo:** `app/dashboard/feature-flags/page.tsx`

- [x] Ya existe (creado en sprint anterior)
- [ ] Necesita actualización si no muestra `directReagendamiento`

**Acción:** Si no está en el dashboard, editar la UI para incluir nuevo toggle

**Estado:** ⏳ Por verificar

---

### 3.2 Activar flag para cliente de prueba

**Método:** Via dashboard
1. Ir a `/dashboard/feature-flags`
2. Buscar cliente de prueba
3. Activar toggle `directReagendamiento`
4. Guardar

**O via API:**
```bash
curl -X POST http://localhost:3000/api/dashboard/feature-flags \
  -H "Content-Type: application/json" \
  -d '{
    "flags": {
      "directReagendamiento": true
    },
    "clienteIds": ["cliente_prueba_id"]
  }'
```

**Estado:** ⏳ Pendiente (después de integración)

---

## Fase 4: Testing 🧪

### 4.1 Logs del flujo

**Comandos de monitoreo:**

```bash
# Ver todos los logs de reagendamiento
tail -f logs/*.log | grep "RESCHEDULE"

# Ver selecciones resueltas directo (sin OpenAI)
grep "Selection resuelto" logs/*.log

# Ver fallbacks a OpenAI (deben ser <25%)
grep "fallback_to_openai" logs/*.log

# Ver errores
grep "ERROR.*RESCHEDULE" logs/*.log
```

**Estado:** ⏳ Pendiente (después de integración)

---

### 4.2 Pruebas manuales

**Caso 1: Selección numérica directa**
- Usuario recibe lista: "1. Lun 16, 2. Mar 17, 3. Mié 18"
- Responde: "2"
- Esperado: Muestra confirmación del turno 2 sin llamar OpenAI
- Log: "Selection resuelto directo: turno 2"

**Caso 2: Selección por descripción**
- Usuario recibe lista de turnos
- Responde: "El del miércoles a las 10"
- Esperado: OpenAI interpreta → Backend encuentra turno → Confirmación
- Log: "fallback_to_openai" → respuesta exitosa

**Caso 3: Confirmación**
- Usuario ve confirmación: "Confirmas? 1. Si, 2. No"
- Responde: "Si" o "Dale"
- Esperado: Reserva ejecutada sin OpenAI
- Log: "Confirmación directa"

**Caso 4: Rechazo**
- Usuario ve confirmación
- Responde: "No, otro"
- Esperado: Vuelve a lista de turnos
- Log: "Rechazo, volviendo a selección"

**Caso 5: Abandono**
- Usuario en confirmación responde: "Chau"
- Esperado: Cierra flujo, mensaje de despedida
- Log: "Usuario abandona flujo"

**Estado:** ⏳ Pendiente (después de testing fase 4.1)

---

## Fase 5: Monitoreo en Producción 📊

### 5.1 Métricas a monitorear

**Diariamente durante 1 semana:**
- Número de reagendamientos completados
- % de fallbacks a OpenAI (objetivo: <25%)
- Promedio de mensajes por reagendamiento (objetivo: 4-6)
- Tasa de errores (objetivo: 0%)
- Tiempo promedio (objetivo: <2 seg)

**Estado:** ⏳ Pendiente

---

### 5.2 Alertas

```yaml
# Alertas a configurar:
- Si fallbacks > 30% (error en selection-extractor)
- Si errores > 2% (error en handler)
- Si tiempo promedio > 3 seg (problema OpenAI fallback)
- Si tasa incompletitud > 5% (usuarios abandonando)
```

**Estado:** ⏳ Pendiente

---

## Fase 6: Rollback (si es necesario) 🔙

**Si hay problemas:**

1. **Via feature flag (1 segundo):**
   - Dashboard → feature-flags
   - Desactivar `directReagendamiento`
   - Guardar
   - Listo (vuelve a OpenAI viejo)

2. **Via código:**
   - Revert del commit de integración
   - Redeploy

**Tiempo de rollback:** <1 min

---

## Fase 7: Expansión a más clientes 🚀

### 7.1 Criterios para expandir

- [x] 0 errores en primera semana
- [x] <20% fallbacks a OpenAI
- [x] UX positiva (sin quejas)
- [x] Costo reducido verificado

**Estado:** ⏳ Por verificar (después de monitoring)

---

### 7.2 Plan de expansión

1. Semana 1: 1 cliente piloto
2. Semana 2: 3 clientes
3. Semana 3: 10 clientes
4. Semana 4+: Todos (gradualmente)

**Estado:** ⏳ Pendiente

---

## Checklist Final

### Previo a integración
- [ ] Leer `docs/RESCHEDULE_DETERMINISTIC_INTEGRATION.md` completo
- [ ] Revisar `lib/conversation-state/reschedule-flow-handler.ts` (entender fases)
- [ ] Revisar `lib/conversation-state/reschedule-flow-integration.ts` (entender API)
- [ ] Revisar prompt nuevo en `docs/system-prompts/route_to_reagendamiento_nlu.md`

### Integración
- [ ] Agregar imports en `whatsapp.tsx`
- [ ] Agregar feature flag en `types.ts`
- [ ] Reemplazar sección de reagendamiento (1375-1487)
- [ ] Agregar interceptor de flujo activo (~1550)
- [ ] Compilar sin errores TypeScript
- [ ] Probar en local

### Deploy
- [ ] Push a rama feature
- [ ] PR review
- [ ] Merge
- [ ] Deploy a staging
- [ ] Testing en staging
- [ ] Deploy a producción
- [ ] Activar flag para cliente piloto

### Monitoreo
- [ ] Monitorear logs por 7 días
- [ ] Registrar métricas
- [ ] Evaluar expansión
- [ ] Documentar lecciones aprendidas

---

## Notas Importantes

**NO olvides:**
1. El feature flag está OFF por defecto (seguro)
2. Fallback a OpenAI es automático si selection-extractor no resuelve
3. El prompt viejo sigue disponible (legacy)
4. Fácil de rollback si es necesario

**Recuerda:**
- Ver logs: grep "RESCHEDULE-FLOW\|RESCHEDULE-INTEGRATION"
- Ver errors: grep "ERROR.*RESCHEDULE"
- Dashboard feature-flags para activar/desactivar

---

## Documentos de Referencia

| Documento | Propósito | Ubicación |
|-----------|----------|-----------|
| RESCHEDULE_DETERMINISTIC_INTEGRATION.md | Guía paso-a-paso | `docs/` |
| SPRINT_8_SUMMARY.md | Resumen ejecutivo | `docs/` |
| reschedule-flow-handler.ts | Handler determinístico | `lib/conversation-state/` |
| reschedule-flow-integration.ts | API de integración | `lib/conversation-state/` |
| route_to_reagendamiento_nlu.md | Prompt OpenAI nuevo | `docs/system-prompts/` |

---

**Estado General:** 🟡 **80% Completado** (Falta integración en whatsapp.tsx)

**Próxima acción:** Integración en whatsapp.tsx según RESCHEDULE_DETERMINISTIC_INTEGRATION.md
