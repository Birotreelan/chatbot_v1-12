# 📋 Resumen Ejecutivo: Sistema Multi-Modo de Clientes

## 🎯 Propuesta en 30 Segundos

Actualmente todos los clientes tienen acceso al **chatbot completo** (confirmación, cancelación, reagendamiento, pacientes nuevos).

**Necesidad:** Permitir clientes que SOLO quieren:
- ✓ Enviar recordatorios de turnos
- ✓ Recibir confirmación/cancelación
- ✓ Derivar a otros canales (teléfono, email, web)
- ✗ NO quieren chatbot completo

**Solución:** Agregar campo `clientMode` a cada configuración:
- `CHATBOT_FULL` → Funcionalidad actual (sin cambios)
- `REMINDERS_ONLY` → Nuevo modo limitado (derivación, recordatorios, básico)

---

## 📊 Impacto

| Aspecto | Descripción | Esfuerzo |
|---------|-------------|---------|
| **Arquit Impacto Código** | Crear 2 archivos nuevos + modificar 6 existentes | ⭐⭐ Bajo |
| **Complejidad** | No hay cambios en OpenAI/NLU existentes | ⭐⭐ Bajo |
| **Retrocompatibilidad** | Completamente backward-compatible | ✓ Sí |
| **Breaking Changes** | Ninguno | ✓ No |
| **Timeline** | 5-7 días (implementación + QA) | ⭐⭐⭐ Medio |
| **Testing** | ~40 tests (5 existentes + 35 nuevos) | ⭐⭐ Bajo |

---

## 🔄 Decisión en el Router

```
┌─ Mensaje llega ─────────────────────────────────────────┐
│                                                          │
├─ Obtener config + clientMode ──────────────────────────┤
│                                                          │
├─ if (clientMode === "REMINDERS_ONLY") ┐                │
│   ├─ Usar reminder-mode-handler        │  ← NUEVO       │
│   ├─ NO pasa a flujos normales         │                │
│   └─ RETORNA                           │                │
│                                         │                │
│   if (clientMode === "CHATBOT_FULL") ──┼─ EXISTENTE    │
│   ├─ Usa flujos normales               │  (sin cambios)  │
│   └─ OpenAI + feature flags            │                │
│                                         │                │
└─────────────────────────────────────────────────────────┘
```

---

## 💾 Estructura de Datos

### Configuración Original (CHATBOT_FULL)
```json
{
  "id": "cfg_123",
  "clientMode": "CHATBOT_FULL",
  "phoneNumberId": "123456789",
  "escalationPhoneNumber": "+54 11 1234-5678"
}
```

### Configuración Nueva (REMINDERS_ONLY)
```json
{
  "id": "cfg_456",
  "clientMode": "REMINDERS_ONLY",
  "phoneNumberId": "987654321",
  "reminderConfig": {
    "reminderTemplate": "Tu turno el {{fecha}} a {{hora}}...",
    "confirmationResponseTemplate": "¡Perfecto! Confirmamos...",
    "cancellationResponseTemplate": "Entendido, hemos cancelado...",
    "derivationChannels": {
      "phone": "+54 9 11 1234-5678",
      "email": "agendas@clinica.com.ar",
      "web": "www.clinica.com.ar/agendar"
    },
    "autoConfirmOnReply": true,
    "silenceOnFarewell": true
  }
}
```

---

## 🛠 Archivos a Crear/Modificar

### ✨ NUEVOS (700 líneas)
| Archivo | Líneas | Descripción |
|---------|--------|-------------|
| `lib/conversation-state/reminder-mode-handler.ts` | 300 | Detector de intención + constructor de respuesta |
| `components/dashboard/reminder-mode-config.tsx` | 400 | UI para editar templates y canales |

### 📝 MODIFICADOS (200 líneas)
| Archivo | Cambios | Líneas |
|---------|---------|--------|
| `lib/types.ts` | Agregar `clientMode`, `reminderConfig` | +40 |
| `lib/conversation-state/types.ts` | Agregar `ReminderModeContext` | +30 |
| `lib/whatsapp.tsx` | Verificar modo antes de flujos | +20 |
| `components/dashboard/whatsapp-config-form.tsx` | Selector de modo | +40 |
| `app/api/dashboard/configs/update/route.ts` | Validar modo | +15 |
| `lib/db.tsx` | Adaptación opcional | +5 |

---

## 📈 Métricas a Registrar

**Modo REMINDERS_ONLY:**
```
reminder_sent:{phoneNumber}           # Plantilla enviada
reminder_confirmed:{phoneNumber}      # Usuario confirmó
reminder_cancelled:{phoneNumber}      # Usuario canceló
reminder_derivation:{phoneNumber}     # Usuario derivado
reminder_silence:{phoneNumber}        # No se respondió (despedida)
reminder_other:{phoneNumber}          # Otra intención
```

---

## 🎯 Fases de Implementación

### **Fase 1: Backend Base (2 días)**
```
✓ Agregar tipos en lib/types.ts + conversation-state/types.ts
✓ Crear reminder-mode-handler.ts
✓ Integrar en whatsapp.tsx (verificación de modo)
✓ Tests unitarios del handler
```

### **Fase 2: Dashboard (2 días)**
```
✓ Crear componente ReminderModeConfig
✓ Integrar en formulario de WhatsAppConfigForm
✓ API de actualización de config
✓ Vista previa de templates
```

### **Fase 3: Testing & QA (1-2 días)**
```
✓ Test manual de ambos modos
✓ Test de derivación con canales múltiples
✓ Test de templates personalizados
✓ Test de edge cases (usuario fuera de ventana, etc.)
```

### **Fase 4: Deployment (1 día)**
```
✓ Migración de datos (si aplica)
✓ Deploy a staging
✓ Deploy a producción
✓ Monitoreo post-deploy
```

---

## 🔐 Consideraciones Importantes

### Seguridad
- ✓ Validación de permisos: solo el cliente puede editar su configuración
- ✓ Sanitización de templates: escapar caracteres especiales
- ✓ Rate limiting: aplicar a ambos modos
- ✓ Auditoría: registrar cambios en templates

### Performance
- ✓ Redis cache para configs (hit rate esperado >95%)
- ✓ Regex compiladas para detección de intención (O(1))
- ✓ No hay impacto en OpenAI (no se invoca en modo recordatorios)
- ✓ Latencia esperada: <100ms por mensaje

### Escalabilidad
- ✓ Soporta 10,000+ clientes (con/sin modo recordatorios)
- ✓ Soporta 100,000+ mensajes/día
- ✓ No requiere cambios en infraestructura

---

## 📊 Configuraciones Editables por Cliente

### Templates
1. **Plantilla de Recordatorio**
   - Variables: `{{fecha}}`, `{{hora}}`, `{{profesional}}`, `{{lugar}}`
   - Ejemplo: "Tu turno el 10/06 a las 14:00 con Dra. María"

2. **Plantilla de Confirmación**
   - Variables: `{{fecha}}`, `{{hora}}`, `{{profesional}}`
   - Ejemplo: "¡Perfecto! Confirmamos tu turno para 10/06 a 14:00"

3. **Plantilla de Cancelación**
   - Variables: `{{channels}}`
   - Ejemplo: "Entendido. Si necesitas agendar: 📱 Teléfono: ..."

### Canales de Derivación
- ☑ Teléfono (formato: +54 11 1234-5678)
- ☑ Email (formato: agendas@clinica.com.ar)
- ☑ Web (formato: www.clinica.com.ar/agendar)
- ☑ WhatsApp alternativo (formato: +54 11 9876-5432)

### Opciones de Comportamiento
- ☑ Confirmar automáticamente al responder
- ☑ Rechazar mensajes fuera de ventana 24h
- ☑ Silencio si responden con despedida

---

## 🚀 Flujo de Usuario (Configuración)

```
1. Admin accede a Dashboard
   ↓
2. Selecciona cliente a editar
   ↓
3. Ve selector: "Modo de Operación"
   ├─ ◉ Chatbot Completo (default)
   └─ ○ Solo Recordatorios
   ↓
4. Si selecciona "Solo Recordatorios":
   ├─ Formulario de Templates (3 campos)
   ├─ Checkboxes de Canales (4 opciones)
   ├─ Opciones avanzadas (3 toggles)
   └─ Vista previa de mensaje
   ↓
5. Guarda cambios
   ↓
6. ✓ Config actualizada en Redis
```

---

## 📋 Checklist de Implementación

### Backend
- [ ] Agregar campos a `WhatsAppConfig` en `types.ts`
- [ ] Crear tipos `ReminderModeContext` en `conversation-state/types.ts`
- [ ] Crear `lib/conversation-state/reminder-mode-handler.ts`
- [ ] Crear función `detectIntentionInReminderMode()`
- [ ] Crear función `buildReminderResponse()`
- [ ] Integrar verificación de modo en `whatsapp.tsx`
- [ ] Extender `app/api/dashboard/configs/update/route.ts`
- [ ] Crear tests para reminder handler (35 tests)
- [ ] Actualizar `lib/db.tsx` si es necesario

### Dashboard
- [ ] Crear componente `ReminderModeConfig`
- [ ] Agregar selector de modo en `WhatsAppConfigForm`
- [ ] Integrar componente de configuración
- [ ] Vista previa de mensaje
- [ ] Botón de prueba (envío de demo)
- [ ] Validaciones de formulario
- [ ] UI responsive para mobile

### Testing
- [ ] Test confirmación (regex + template)
- [ ] Test cancelación (regex + template + derivación)
- [ ] Test despedida (silencio)
- [ ] Test derivación con múltiples canales
- [ ] Test variables en templates
- [ ] Test usuario fuera de ventana 24h
- [ ] Test edge cases (emojis, caracteres especiales)
- [ ] Test integración end-to-end

### Documentation
- [ ] README de modo recordatorios
- [ ] Guía de configuración para clientes
- [ ] Ejemplos de templates
- [ ] FAQ de preguntas comunes

---

## 💡 Casos de Uso

### Cliente 1: Consultorio Dermatología (REMINDERS_ONLY)
```
- Envía recordatorio automático 24h antes
- Usuario confirma → "Perfecto, te vemos el 10/06"
- Usuario cancela → "Si necesitas agendar: Llama 0800..."
- Derivación a teléfono + web
- NO quiere chatbot (simple y directo)
```

### Cliente 2: Clínica Central (CHATBOT_FULL)
```
- Envía recordatorio automático 24h antes
- Usuario confirma/cancela automáticamente
- Usuario puede reagendar ("Cambiar a otra fecha")
- Usuario nuevo puede agendar sin estar registrado
- Chatbot responde preguntas sobre dirección, hora, etc.
- Escalamiento a agente humano
```

---

## 🎓 Training Requerido

| Rol | Contenido |
|-----|-----------|
| **Soporte Técnico** | Cómo explicar los 2 modos a clientes |
| **Account Manager** | Beneficios del modo recordatorios (simple, barato) |
| **Admin/DevOps** | Cómo migrar clientes entre modos |
| **QA** | Casos de test para ambos modos |

---

## 📞 Próximos Pasos

1. **✓ Aprobación de arquitectura** (ahora)
2. **→ Feedback sobre templates y canales** (tu respuesta)
3. **→ Comenzar Fase 1: Backend** (si apruebas)
4. **→ Crear PRs con tests** (1-2 días)
5. **→ Review + merge** (1 día)
6. **→ Deploy a staging** (1 día)
7. **→ QA final** (1 día)
8. **→ Deploy a producción** (1 día)

---

## ❓ Preguntas para Ti

1. ¿Apruebas la arquitectura general?
2. ¿Necesitas otros templates además de los 3 (recordatorio, confirmación, cancelación)?
3. ¿Necesitas otros canales además de teléfono, email, web, WhatsApp?
4. ¿Quieres campos adicionales en `reminderConfig`?
5. ¿Hay clientes listos para testear esto en beta?
6. ¿Necesitas migraciones de clientes existentes?

---

## 📚 Documentos Relacionados

- `ANALISIS_CLIENTES_RECORDATORIOS_LIMITADOS.md` → Análisis técnico detallado
- `DIAGRAMAS_VISUALES_CLIENTE_RECORDATORIOS.md` → Diagramas y ejemplos
- `ARCHITECTURE_DIAGRAM.md` → Arquitectura general del sistema

---

**Última actualización:** 10/06/2024  
**Versión:** 1.0  
**Estado:** En revisión
