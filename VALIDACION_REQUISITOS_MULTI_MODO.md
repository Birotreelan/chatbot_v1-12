# ❓ Validación de Requisitos: Sistema Multi-Modo

## 🎯 Requisitos Funcionales - Necesito tu Feedback

### 1. **Modo de Operación del Cliente**

**Pregunta:** ¿Confirmamos estos dos modos?

```
✓ CHATBOT_FULL (Actual - sin cambios)
  - Confirmación/Cancelación automática
  - Reagendamiento de turnos
  - Búsqueda de pacientes (existentes + nuevos)
  - Chat conversacional
  - Escalamiento a agente humano
  - Múltiples consultas en el mismo flujo

✓ REMINDERS_ONLY (Nuevo - solicitado)
  - Envío de recordatorios
  - Confirmación/Cancelación simple
  - Derivación a otros canales
  - NO chatbot completo
  - NO reagendamiento
  - NO búsqueda de pacientes
```

**Mi recomendación:** Estos dos modos cubren los casos, pero quería confirmarlo contigo.

---

### 2. **Plantillas Editables**

**Pregunta:** ¿Necesitas estas 3 plantillas o hay más?

#### Plantilla 1: Recordatorio (Enviada por sistema externo)
```
¿Editable?: NO (ya existe este endpoint)
¿Quién edita?: El cliente desde su sistema externo
Ejemplo: "Tu turno el {{fecha}} a las {{hora}} con {{profesional}} en {{lugar}}"
Variables soportadas: {{fecha}}, {{hora}}, {{profesional}}, {{lugar}}, {{direccion}}
```

#### Plantilla 2: Confirmación (Respuesta del chatbot)
```
¿Editable?: SÍ ← NUEVO
¿Quién edita?: Admin/Cliente desde Dashboard
Ejemplo: "¡Perfecto! Confirmamos tu turno para {{fecha}} a {{hora}}"
Variables: {{fecha}}, {{hora}}, {{profesional}}
Mostrar?: Siempre que usuario confirme
```

#### Plantilla 3: Cancelación (Respuesta del chatbot)
```
¿Editable?: SÍ ← NUEVO
¿Quién edita?: Admin/Cliente desde Dashboard
Ejemplo: "Entendido, hemos cancelado tu turno. Si necesitas agendar: {{channels}}"
Variables: {{channels}}, {{fecha}}, {{hora}}
Mostrar?: Siempre que usuario cancele
```

#### ¿Plantilla 4: Derivación para otros casos?
```
¿Necesita?: TBD
Ejemplo: "¿Necesitas cambiar? Contáctanos: {{channels}}"
Cuándo mostrar?: Si usuario escribe algo que NO es confirmación/cancelación
```

**Mi recomendación:**

→ Implementar: Plantillas 2 y 3 (confirmación y cancelación)  
→ Opcional: Plantilla 4 (para otros casos)

**¿Estás de acuerdo? ¿Agregar/Remover alguna?**

---

### 3. **Canales de Derivación**

**Pregunta:** ¿Estos 4 canales son suficientes?

```
Canal 1: TELÉFONO
  Formato: +54 9 11 1234-5678
  Símbolo: 📱
  En template: "Llama a {{phone}}"
  ¿Editable?: SÍ
  ¿Obligatorio?: NO (checkbox)

Canal 2: EMAIL
  Formato: agendas@clinica.com.ar
  Símbolo: 📧
  En template: "Envía a {{email}}"
  ¿Editable?: SÍ
  ¿Obligatorio?: NO (checkbox)

Canal 3: WEB
  Formato: www.clinica.com.ar/agendar
  Símbolo: 🌐
  En template: "Visita {{web}}"
  ¿Editable?: SÍ
  ¿Obligatorio?: NO (checkbox)

Canal 4: WHATSAPP ALTERNATIVO
  Formato: +54 11 9876-5432
  Símbolo: 💬
  En template: "Escribe a {{whatsapp_alt}}"
  ¿Editable?: SÍ
  ¿Obligatorio?: NO (checkbox)
```

**Preguntas:**
- ¿Necesitas más canales? (ej: WhatsApp Business Link, Instagram, etc.)
- ¿Quieres QR para web/whatsapp?
- ¿Cómo quieres que aparezcan en el mensaje?

**Mi recomendación:** Estos 4 canales cubren 95% de casos. Es expandible si necesitas más.

---

### 4. **Detección de Intención del Usuario**

**Pregunta:** ¿Estos patrones de detección son suficientes?

```
INTENCIÓN 1: CONFIRMACIÓN
├─ Regex: "sí|s\b|confirmo|voy|ahi estoy|perfecto|ok|listo|está bien|dale|yendo"
├─ Acción: Responder con plantilla de confirmación
├─ Registro métrica: reminder_confirmed
└─ Ejemplo: "Confirmo!" → "¡Perfecto! Confirmamos tu turno..."

INTENCIÓN 2: CANCELACIÓN
├─ Regex: "no\b|cancelo|no puedo|no voy|no voy a poder|no iré|no llego"
├─ Acción: Responder con plantilla de cancelación + derivación
├─ Registro métrica: reminder_cancelled
└─ Ejemplo: "No puedo ir" → "Entendido. Si necesitas agendar: 📱 Teléfono..."

INTENCIÓN 3: DESPEDIDA (Silencio)
├─ Regex: "gracias|chau|adiós|hasta luego|gracias chau|listo|bye"
├─ Acción: NO RESPONDER (silencio)
├─ Registro métrica: reminder_silence
└─ Ejemplo: "Gracias, chau" → ✗ No responder

INTENCIÓN 4: OTRAS CONSULTAS
├─ Ejemplo: "¿Cuál es la dirección?", "¿Dónde es?", "¿Con quién es?"
├─ Acción: Derivar a otros canales
├─ Registro métrica: reminder_derivation
└─ Respuesta: "¿Necesitas más información? Contáctanos..."
```

**Preguntas:**
- ¿Faltan palabras clave para detección?
- ¿Necesitas más intenciones (ej: "Consulta médica", "Duda sobre especialidad")?
- ¿Quieres NLU (OpenAI) como fallback si no hay regex match?

**Mi recomendación:** Regex para estos 4 casos. OpenAI como fallback es OPCIONAL.

---

### 5. **Opciones Avanzadas de Comportamiento**

**Pregunta:** ¿Necesitas estas opciones?

```
OPCIÓN 1: Auto-confirmar al responder
├─ ¿Qué hace?: Si usuario responde algo (cualquier cosa), 
│              se considera confirmación automática
├─ Casilla: ☑ Confirmar automáticamente al responder
├─ Valor por defecto: TRUE
├─ Caso de uso: Cliente quiere máxima confirmación
└─ Riesgo: Usuario dice "Hola" y se confirma como "sí"

OPCIÓN 2: Rechazar mensajes fuera de ventana 24h
├─ ¿Qué hace?: Ignorar mensajes que lleguen >24h después del recordatorio
├─ Casilla: ☑ Rechazar mensajes fuera de ventana 24h
├─ Valor por defecto: FALSE
├─ Caso de uso: Cliente quiere evitar confirmaciones tardías
└─ Respuesta: "Disculpa, esta ventana de confirmación expiró"

OPCIÓN 3: Silencio si responden con despedida
├─ ¿Qué hace?: No responder si usuario dice "Gracias, chau", etc.
├─ Casilla: ☑ Silencio si responden con despedida
├─ Valor por defecto: TRUE
├─ Caso de uso: No molestar al usuario con respuesta a su despedida
└─ Comportamiento: Registrar métrica pero NO enviar respuesta
```

**Preguntas:**
- ¿Necesitas otras opciones avanzadas?
- ¿El default (TRUE/FALSE) es correcto?
- ¿Necesitas trazabilidad de cuándo se activaron estas opciones?

**Mi recomendación:** Estas 3 opciones cubren casos comunes. Es fácil agregar más.

---

## 🔒 Seguridad y Permisos

**Pregunta:** ¿Quién debe poder editar estas configuraciones?

```
ROL 1: Super Admin (soporte técnico Birotreelan)
├─ ¿Puede editar modo?: SÍ
├─ ¿Puede editar templates?: SÍ
├─ ¿Puede editar canales?: SÍ
└─ ¿Puede ver stats?: SÍ

ROL 2: Support Agent (agente de soporte)
├─ ¿Puede editar modo?: NO (solo su cliente)
├─ ¿Puede editar templates?: SÍ (solo su cliente)
├─ ¿Puede editar canales?: SÍ (solo su cliente)
└─ ¿Puede ver stats?: SÍ (solo su cliente)

ROL 3: Cliente (usuario final)
├─ ¿Puede editar modo?: ¿? TBD
├─ ¿Puede editar templates?: ¿? TBD
├─ ¿Puede editar canales?: ¿? TBD
└─ ¿Puede ver stats?: ¿? TBD
```

**Preguntas:**
- ¿Quieres que los clientes puedan autoconfigurar o solo soporte?
- ¿Necesitas auditoría de quién cambió qué y cuándo?

**Mi recomendación:** Por ahora solo soporte técnico. Escalable a clientes después.

---

## 📊 Métricas y Analytics

**Pregunta:** ¿Necesitas estas métricas?

```
MÉTRICA 1: reminder_sent
├─ ¿Qué registra?: Plantilla enviada
├─ Datos: timestamp, phoneNumber, template_name
└─ Dashboard: Gráfico de recordatorios enviados por día

MÉTRICA 2: reminder_confirmed
├─ ¿Qué registra?: Usuario confirmó
├─ Datos: timestamp, phoneNumber, userMessage, responseTime
└─ Dashboard: % de confirmaciones vs recordatorios

MÉTRICA 3: reminder_cancelled
├─ ¿Qué registra?: Usuario canceló
├─ Datos: timestamp, phoneNumber, userMessage, reason
└─ Dashboard: % de cancelaciones vs recordatorios

MÉTRICA 4: reminder_derivation
├─ ¿Qué registra?: Usuario derivado a otro canal
├─ Datos: timestamp, phoneNumber, channels_shown, which_channel_selected
└─ Dashboard: Qué canales son más usados

MÉTRICA 5: reminder_silence
├─ ¿Qué registra?: No respondimos (despedida)
├─ Datos: timestamp, phoneNumber, userMessage
└─ Dashboard: % de despedidas

MÉTRICA 6: reminder_other
├─ ¿Qué registra?: Otra intención (consulta de dirección, etc.)
├─ Datos: timestamp, phoneNumber, userMessage, action_taken
└─ Dashboard: Consultas más frecuentes
```

**Preguntas:**
- ¿Necesitas más dimensiones de análisis?
- ¿Quieres comparativa CHATBOT_FULL vs REMINDERS_ONLY?
- ¿Quieres ROI (costo vs confirmaciones)?

---

## 🧪 Testing y Validación

**Pregunta:** ¿Cómo quieres validar esto?

```
TESTING NIVEL 1: Unit Tests (Backend)
├─ Test detección de confirmación (10 casos)
├─ Test detección de cancelación (10 casos)
├─ Test detección de despedida (5 casos)
├─ Test construcción de templates (5 casos)
├─ Test derivación con múltiples canales (5 casos)
└─ Total: 35 tests ✓

TESTING NIVEL 2: Integration Tests
├─ Test flujo completo: envío → confirmación → respuesta
├─ Test flujo completo: envío → cancelación → respuesta + derivación
├─ Test flujo completo: envío → despedida → silencio
├─ Test cambio de modo CHATBOT_FULL ↔ REMINDERS_ONLY
└─ Total: 4 tests ✓

TESTING NIVEL 3: Manual (QA)
├─ Enviar recordatorio de verdad
├─ Responder con confirmación
├─ Responder con cancelación
├─ Responder con despedida
├─ Responder fuera de ventana 24h
├─ Testear derivación con múltiples canales
└─ Total: 6 escenarios ✓

TESTING NIVEL 4: Beta con Cliente Real
├─ Hacer público a 1-2 clientes de prueba
├─ Recopilar feedback
├─ Hacer ajustes
├─ Lanzar a otros clientes
└─ Duración: 1-2 semanas
```

**Preguntas:**
- ¿Tienes clientes listos para beta?
- ¿Necesitas otros escenarios de testing?
- ¿Quieres load testing (100+ mensajes simultáneamente)?

---

## 🚀 Roadmap y Timeline

**Mi estimación:**

```
SEMANA 1:
├─ Día 1-2: Backend base
│  ├─ Tipos + reminder-mode-handler.ts + tests
│  └─ Integración en whatsapp.tsx
│
├─ Día 3-4: Dashboard
│  ├─ ReminderModeConfig component
│  ├─ Integración en formulario
│  └─ API de actualización
│
└─ Día 5: QA inicial

SEMANA 2:
├─ Día 1: Testing exhaustivo
├─ Día 2: Fixes y ajustes
├─ Día 3: Deploy a staging
├─ Día 4: Testing en staging
└─ Día 5: Deploy a producción

TOTAL: 10 días hábiles (2 semanas)
```

**¿Te parece realistic? ¿Necesitas cambios?**

---

## 💭 Decisiones Pendientes

Por favor, ayúdame a resolver estas:

1. **¿Necesitas soporte para múltiples idiomas?**
   - Templates en español solamente
   - Templates en español + inglés + portugués
   - Sistema genérico para cualquier idioma

2. **¿Necesitas webhook para eventos de recordatorios?**
   - Ej: "Cuando usuario confirma, webhook POST a tu sistema"
   - Útil para integración con tu ERP

3. **¿Necesitas auto-escalamiento a agente humano?**
   - Si usuario responde algo que no entiende el handler
   - Derivar a agente en lugar de derivación de canales

4. **¿Necesitas plantillas de "sin respuesta"?**
   - Ej: Usuario no responde en 24h → recordatorio #2
   - O cambiar comportamiento (automáticamente "confirmar")

5. **¿Necesitas A/B testing de templates?**
   - Testear 2 templates diferentes y ver cuál tiene mejor confirmación
   - Analytics de variant A vs B

6. **¿Necesitas cambiar modo por porcentaje?**
   - Ej: 10% de usuarios en REMINDERS_ONLY, 90% en CHATBOT_FULL
   - Para rollout gradual

---

## 📋 Checklist de Validación

Antes de comenzar la implementación, confirma:

- [ ] ✓ 2 modos (CHATBOT_FULL + REMINDERS_ONLY) → CORRECTO
- [ ] ✓ 3 plantillas (confirmación, cancelación, derivación) → ¿AGREGAR MÁS?
- [ ] ✓ 4 canales (teléfono, email, web, whatsapp) → ¿COMPLETO?
- [ ] ✓ Detección de intención (4 casos) → ¿SUFICIENTE?
- [ ] ✓ Opciones avanzadas (3 toggles) → ¿NECESITAS MÁS?
- [ ] ✓ Métricas (6 tipos) → ¿AGREGAR/CAMBIAR?
- [ ] ✓ Seguridad y permisos → CLARO
- [ ] ✓ Timeline (2 semanas) → ¿REALISTA?

---

## 📞 ¿LISTO?

Una vez que confirmes estos puntos, puedo comenzar la implementación de inmediato.

**Necesito tu feedback en:**
1. Templates (¿Agregar/Cambiar?)
2. Canales (¿Suficientes?)
3. Opciones avanzadas (¿Necesitas más?)
4. Decisiones pendientes (responder las 6)
5. Timeline (¿2 semanas es OK?)

---

**Fecha:** 10/06/2024  
**Estado:** Esperando tu feedback  
**Documentos completos:** 3 archivos
