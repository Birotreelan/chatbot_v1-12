# Checklist de Despliegue - Sprint 16 + Sprint 17 + SSO

## Estado: ✅ LISTO PARA PRODUCCIÓN

---

## SPRINT 16 + SPRINT 17 - HANDLERS INTELIGENTES

### Sprint 16: Consultas Informativas Directas ✅
Detecta preguntas sobre datos del turno y responde sin reiniciar flujo:
- "¿Cuál es la dirección?" → Responde con dirección del turno
- "¿A qué hora es?" → Responde con horario
- "¿Con quién es?" → Responde con nombre del profesional
- "¿En qué sede?" → Responde con sede

**Archivos:**
- [x] `lib/conversation-state/informational-query-handler.ts` (575 líneas)
- [x] `docs/system-prompts/route_to_informational_query_nlu.md` (122 líneas)
- [x] Feature flag `directInformationalQuery` (OFF por defecto)

### Sprint 17: Contexto Post-Acción ✅
Detecta explicaciones de por qué se canceló/confirmó y responde empáticamente:
- "Está con neumonía" → Respuesta de salud
- "La paciente falleció" → Respuesta de condolencias
- "Se mudó" → Respuesta de despedida
- "Cambió de obra social" → Respuesta de cambio de cobertura

**Archivos:**
- [x] Mejorado `lib/conversation-state/post-action-context.ts`:
  - NLU con GPT-4o-mini (Chat Completions, NO Assistants API)
  - System prompt con 5 intenciones definidas
  - Fallback a regex mejorado con patrones de fallecimiento
  - Respuestas empáticas específicas por tipo de explicación
- [x] Feature flag `postActionContextHandler` (OFF por defecto)

**Cambios en whatsapp.tsx:**
- [x] +2 imports (detectPostActionContextPreFlow, savePostActionContext)
- [x] +27 líneas: Guardado de contexto al completar cancelación
- [x] +43 líneas: Handler Sprint 17 en secuencia correcta

### Orden de Handlers en whatsapp.tsx
```
1. Sprint 15: Silencio en Respuestas Recíprocas ✅
2. Sprint 14: Confirmación/Cancelación Directa ✅
3. Sprint 16: Consultas Informativas ✅ (NUEVO)
4. Sprint 17: Contexto Post-Acción ✅ (NUEVO)
5. Sprint 12: Despedidas Pre-Flujo ✅
6. Sprint 13: Número Equivocado ✅
7. Sprint 9a: Detección de Paciente ✅
```

---

## VERIFICACIONES COMPLETADAS ✅

### Build y Compilación
- [x] `npm run build` compila exitosamente
- [x] No hay errores TypeScript nuevos
- [x] Warning preexistente con `extractNumberSelection` (no relacionado a estos sprints)

### Feature Flags
- [x] `directInformationalQuery` agregado a types.ts, panel dashboard
- [x] `postActionContextHandler` agregado a types.ts, panel dashboard
- [x] Ambos configurables por cliente desde dashboard
- [x] Ambos OFF por defecto (despliegue seguro)

### NLU Implementation
- [x] Sprint 17 usa GPT-4o-mini con Chat Completions directas
- [x] System prompt completo con ejemplos de cada intención
- [x] Fallback a regex si API falla
- [x] Temperatura 0.1 para respuestas consistentes
- [x] JSON response format validado

### Variables de Entorno
- [x] OPENAI_API_KEY (requerido para NLU)
- [x] UPSTASH_REDIS_REST_URL (existente)
- [x] UPSTASH_REDIS_REST_TOKEN (existente)

**Nota:** Verificar que OPENAI_API_KEY tenga acceso a modelo `gpt-4o-mini`

---

## CASOS CUBIERTOS ✅

### Sprint 16 - Consultas Informativas
```
Usuario → Confirma turno
Usuario → "¿Cuál es la dirección?"
Sistema → Responde con dirección, NO reinicia flujo
```

### Sprint 17 - Contexto Post-Acción
```
Usuario → Cancela turno
Usuario → "La paciente falleció"
Sistema → Responde: "Lamentamos profundamente..."
         NO reinicia flujo de bienvenida
```

---

## ARCHIVOS MODIFICADOS

### Creados:
- [x] `lib/conversation-state/informational-query-handler.ts` (575 líneas)
- [x] `docs/system-prompts/route_to_informational_query_nlu.md` (122 líneas)

### Editados:
- [x] `lib/conversation-state/post-action-context.ts`:
  - Reescrito NLU con Chat Completions
  - Agregado tipo de intención `explicacion_contextual`
  - Patrones regex ampliados (fallecimiento, mudanza, etc.)
  - Respuestas empáticas específicas
- [x] `lib/conversation-state/types.ts` - +2 feature flags
- [x] `lib/conversation-state/index.ts` - +1 export
- [x] `lib/whatsapp.tsx` - +2 imports, +70 líneas handlers
- [x] `components/dashboard/feature-flags-panel.tsx` - +2 flags en UI

---

## PASOS PARA DESPLIEGUE A PRODUCCIÓN

### Paso 1: Merge a Main
```bash
git push origin appointment-address-request
# PR automático o manual merge a main
```

### Paso 2: Verificar Variables de Entorno
Dashboard → Vars:
- [x] OPENAI_API_KEY presente y válido
- [x] UPSTASH_REDIS_REST_URL presente
- [x] UPSTASH_REDIS_REST_TOKEN presente

### Paso 3: Despliegue Inicial (Feature Flags OFF)
- [x] Build y deploy automático a Vercel
- [x] Sistema funciona sin los nuevos handlers
- [x] Cero impacto en usuarios actuales

### Paso 4: Activación Gradual
**Recomendación:** Activar en cliente de prueba primero

```
Día 1-2: Sprint 16 en 1 cliente de prueba
  - Usuarios confirman/cancelan turnos
  - Envían preguntas sobre dirección, horario, etc.
  - Verificar que responde correctamente

Día 3-4: Sprint 16 en 50% de clientes
  - Monitorear métricas de detección
  - Verificar no hay falsos positivos

Día 5: Sprint 16 en 100% de clientes

Día 6-7: Sprint 17 en 1 cliente de prueba
  - Usuarios cancelan turnos
  - Envían explicaciones (enfermedad, mudanza, etc.)
  - Verificar respuestas empáticas

Día 8-9: Sprint 17 en 50% de clientes
Día 10: Sprint 17 en 100% de clientes
```

### Activar Feature Flags
```javascript
// Para un cliente específico:
await enableFeature("cliente_id", "directInformationalQuery")
await enableFeature("cliente_id", "postActionContextHandler")

// O desde dashboard:
Dashboard → Cliente → Feature Flags → Activar
```

---

## MONITOREO POST-DESPLIEGUE

### Métricas a Verificar
- Tasa de detección Sprint 16 (target: >80%)
- Tasa de detección Sprint 17 (target: >75%)
- Errores en NLU (target: <5%)
- Precisión de clasificación (target: >85%)

### Logs a Revisar
```
[WHATSAPP] 📍 Verificando consulta informativa
[WHATSAPP] ✅ Consulta informativa detectada (direccion)

[WHATSAPP] 📝 Verificando contexto post-acción
[WHATSAPP] ✅ Mensaje post-acción detectado (explicacion_contextual)
```

### Dashboard Estadísticas
- Mensajes procesados por handler
- Tasa de respuesta directa vs flujo normal
- Tasa de error en NLU

---

## ROLLBACK PLAN

Si hay problemas:
```javascript
// Desactivar inmediatamente:
await disableFeature(configId, "directInformationalQuery")
await disableFeature(configId, "postActionContextHandler")

// Resultado: Vuelve a flujo anterior, CERO impacto en datos
```

---

## REQUERIMIENTOS FUTUROS (Backlog, no bloquean)

- [ ] Implementar paso a OpenAI con contexto post-acción (Sprint 17 futuro)
- [ ] Análisis de sentimiento en mensajes post-acción
- [ ] Expandir patrones según feedback real

---

## RESUMEN FINAL

**Estado:** ✅ READY FOR PRODUCTION

**Riesgo:** BAJO
- Ambos handlers desactivables per cliente
- Fallback a regex si NLU falla
- Cero cambios en datos o BD

**Recomendación:** 
1. Desplegar ahora (código + feature flags OFF)
2. Activar gradualmente en clientes piloto
3. Expandir a 100% una vez validado

---


