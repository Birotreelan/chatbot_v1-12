# TESTING GUIDE - Sprint 16 + Sprint 17

## Cómo Testear los Nuevos Handlers Antes de Desplegar

---

## TEST 1: Sprint 16 - Consultas Informativas

### Escenario de Prueba
1. Cliente tiene turno confirmado para mañana
2. Cliente recibe recordatorio del turno
3. Cliente pregunta sobre la dirección

### Pasos
```
1. Habilitar feature flag en cliente de prueba:
   Dashboard → Cliente de Prueba → Feature Flags
   ✓ Activar "Consultas informativas directas"

2. Ir a WhatsApp con cliente de prueba

3. Confirmar un turno (si no lo tiene):
   - Responder "1" a recordatorio
   - Confirmar asistencia

4. Enviar pregunta sobre dirección:
   "Me podes pasar la dirección?"
   
5. ESPERADO:
   ✅ Responde: "El turno es en Calle 56, Sede SALUD OCULAR CALLAO"
   ✅ NO reinicia flujo de bienvenida
   ✅ NO pide DNI nuevamente

6. Enviar otras preguntas (verificar cada una):
   a) "¿A qué hora es?"
      ✅ Responde: "El turno es a las 09:40"
   
   b) "¿Con quién es?"
      ✅ Responde: "Tu turno es con Angaut, Guillermo"
   
   c) "¿En qué sede?"
      ✅ Responde: "Tu turno es en la sede SALUD OCULAR CALLAO"
   
   d) "¿Qué día es?"
      ✅ Responde: "Tu turno es el lunes, 1 de junio de 2026"
```

### Validaciones ✅
- [ ] Responde directamente con información del turno
- [ ] Usa datos del turno confirmado
- [ ] No reinicia flujo
- [ ] No pide datos nuevamente

---

## TEST 2: Sprint 17 - Contexto Post-Acción

### Escenario A: Explicación por Enfermedad
```
1. Habilitar feature flag:
   Dashboard → Cliente de Prueba → Feature Flags
   ✓ Activar "Contexto post-acción"

2. En WhatsApp:
   - Recibir recordatorio de turno
   - Responder "2" (no reagendar)
   - Cancelar turno

3. Sistema responde:
   "La cancelación fue procesada correctamente."
   "¿Querés reagendar en otra fecha?"

4. Responder "2" (No quiero reagendar)

5. AHORA el nuevo handler:
   Enviar: "Está con fiebre"
   
6. ESPERADO:
   ✅ Responde: "Entendemos. Esperamos que se mejore pronto..."
   ✅ NO reinicia flujo de bienvenida
   ✅ NO pide DNI nuevamente
   ✅ NO pregunta "¿En qué te podemos ayudar?"
```

### Escenario B: Fallecimiento (CASO CRÍTICO)
```
1. Feature flag activado (como arriba)

2. En WhatsApp:
   - Cancelar turno (ver pasos Escenario A)
   - Responder "2" (No quiero reagendar)

3. Enviar: "La paciente falleció el 23 de mayo"

4. ESPERADO:
   ✅ Responde: "Lamentamos profundamente la pérdida..."
   ✅ Tone: Empático, respetuoso
   ✅ NO reinicia flujo
   ✅ NO muestra opciones de turnos
```

### Escenario C: Mudanza
```
1. Feature flag activado

2. En WhatsApp:
   - Cancelar turno
   - Responder "2" (No quiero reagendar)

3. Enviar: "Se mudó a otra ciudad"

4. ESPERADO:
   ✅ Responde: "Les deseamos lo mejor en esta nueva etapa..."
```

### Escenario D: Cambio de Cobertura
```
1. Feature flag activado

2. En WhatsApp:
   - Cancelar turno
   - Responder "2" (No quiero reagendar)

3. Enviar: "Cambié de obra social"

4. ESPERADO:
   ✅ Responde: "Gracias por informarnos..."
```

### Validaciones ✅
- [ ] Detecta explicación contextual
- [ ] Responde empáticamente según tipo
- [ ] No reinicia flujo
- [ ] No pide datos nuevamente
- [ ] TTL de contexto (2 horas) funciona correctamente

---

## TEST 3: Casos Negativos (Sin Feature Flags)

### Escenario: Feature Flags OFF
```
1. Desactivar ambos feature flags:
   Dashboard → Cliente de Prueba → Feature Flags
   ✓ Desactivar "Consultas informativas directas"
   ✓ Desactivar "Contexto post-acción"

2. Realizar TEST 1 y TEST 2 nuevamente

3. ESPERADO (comportamiento anterior):
   ✅ Pregunta "¿Cuál es la dirección?" → Reinicia flujo
   ✅ Mensaje "Está con fiebre" → Reinicia flujo
   ✅ Todo vuelve al comportamiento anterior
```

### Validación: Rollback Funciona ✅
- [ ] Feature flags pueden desactivarse sin errores
- [ ] Sistema vuelve a comportamiento anterior
- [ ] Cero impacto en datos

---

## TEST 4: NLU Robustez

### Escenario: Variaciones de Lenguaje (Sprint 17)
```
1. Feature flag "Contexto post-acción" activado

2. Cancelar turno y responder "No quiero reagendar"

3. Enviar VARIACIONES de explicación:

a) Variación de ENFERMEDAD:
   "Me enfermé"
   ✅ Detecta: explicacion_contextual
   ✅ Responde: empática de salud

b) Variación de FALLECIMIENTO:
   "Murió el paciente"
   ✅ Detecta: explicacion_contextual
   ✅ Responde: condolencias

c) Variación de MUDANZA:
   "Ya no vivo en Buenos Aires"
   ✅ Detecta: explicacion_contextual
   ✅ Responde: despedida

d) Variación AMBIGUA:
   "Tengo un problema"
   ✅ Detecta: explicacion_contextual
   ✅ Responde: genérica

e) NUEVA ACCIÓN (no debe responder como post-acción):
   "Quiero sacar otro turno"
   ✅ Detecta: nueva_accion
   ✅ Continúa flujo normal
   ✅ NO responde como post-acción
```

### Validación: NLU Funciona ✅
- [ ] Detecta variaciones de lenguaje
- [ ] Distingue entre intenciones
- [ ] Fallback a regex funciona si NLU falla

---

## TEST 5: Edge Cases

### Edge Case 1: TTL del Contexto (2 horas)
```
1. Cancelar turno
2. Esperar 2 horas 1 minuto
3. Enviar "Está con fiebre"

ESPERADO:
✅ Contexto expiró
✅ Reinicia flujo de bienvenida (comportamiento anterior)
```

### Edge Case 2: Múltiples Turnos
```
1. Usuario con 2 turnos próximos
2. Cancelar primer turno
3. Enviar pregunta "¿Cuál es la dirección?"

ESPERADO (Sprint 16):
✅ Responde con dirección del turno que ACABA de cancelar
✅ NO ambigüedad con segundo turno
```

### Edge Case 3: Mensaje Muy Largo
```
1. Cancelar turno
2. Enviar mensaje largo con múltiples explicaciones:
   "Estoy con fiebre desde ayer, me duele la cabeza, 
    además me tengo que mudar a otra ciudad, 
    así que no puedo ir al turno"

ESPERADO (Sprint 17):
✅ NLU clasifica como: explicacion_contextual
✅ Responde empáticamente
✅ NO error por tamaño de mensaje
```

---

## TEST 6: Integración con Otros Handlers

### Escenario: Sprint 16 + 17 + Sprint 15 + Sprint 14
```
El sistema debe respetar el orden de handlers:

1. Sprint 15 (Silencio en respuestas recíprocas)
   - Si usuario responde "Igualmente" a despedida del bot
   ✅ NO responde nada

2. Sprint 14 (Confirmación/Cancelación Directa)
   - Si usuario responde "1" o "2" a pregunta directa
   ✅ Procesa como confirmación/cancelación

3. Sprint 16 (Consultas Informativas)
   - Si usuario pregunta sobre dirección después de confirmar
   ✅ Responde directamente

4. Sprint 17 (Contexto Post-Acción)
   - Si usuario explica por qué después de cancelar
   ✅ Responde empáticamente

5. Sprint 12 (Despedidas Pre-Flujo)
   - Si usuario dice "chau" al inicio
   ✅ Despide sin reiniciar

6. Sprint 13 (Número Equivocado)
   - Si usuario enviamensaje confuso al inicio
   ✅ Detecta como número equivocado

7. Sprint 9a (Detección de Paciente)
   - Si nada anterior se aplica
   ✅ Flujo normal de detección
```

---

## CHECKLIST FINAL DE TESTING

### Antes de Desplegar a 100%

#### Sprint 16 Tests
- [ ] Pregunta dirección → Responde directamente
- [ ] Pregunta horario → Responde directamente
- [ ] Pregunta profesional → Responde directamente
- [ ] Pregunta fecha → Responde directamente
- [ ] Pregunta sede → Responde directamente
- [ ] Feature flag OFF → Vuelve al flujo anterior
- [ ] Sin appointmentContext → Flujo normal

#### Sprint 17 Tests
- [ ] Explicación enfermedad → Responde de salud
- [ ] Explicación fallecimiento → Responde condolencias
- [ ] Explicación mudanza → Responde despedida
- [ ] Explicación cobertura → Responde cambio
- [ ] Variaciones de lenguaje → Detecta correctamente
- [ ] TTL 2 horas → Contexto expira correctamente
- [ ] Feature flag OFF → Vuelve al flujo anterior
- [ ] Sin postActionContext → Flujo normal

#### Integration Tests
- [ ] Orden de handlers respetado
- [ ] No conflictos con otros sprints
- [ ] Logs correctos en Vercel
- [ ] Métricas en dashboard actualizadas

---

## SCRIPT DE TESTING RÁPIDO

```bash
# Para ejecutar tests automatizados (si existen):
npm run test:sprint16
npm run test:sprint17

# Para logs en tiempo real:
# Dashboard → Vercel Logs → Filtrar por [WHATSAPP]
```

---

## DOCUMENTO PARA CLIENTES

Cuando despliegues a cliente final, usa este template:

```
Estimado [Cliente],

Hemos optimizado el chatbot de turnos con 2 nuevas mejoras:

1. CONSULTAS INFORMATIVAS DIRECTAS
   - Los pacientes pueden preguntar "¿Cuál es la dirección?" después de confirmar
   - El sistema responde directamente sin reiniciar la conversación
   
2. CONTEXTO POST-ACCIÓN
   - Cuando un paciente explica por qué cancela ("Está enfermo", "Se mudó", etc.)
   - El sistema responde con empatía en lugar de reiniciar

Ambas mejoras mejoran la experiencia del usuario.

¿Querés activarlas?
- Sí: Activamos hoy
- No: Se mantiene comportamiento actual
```

---

## Soporte y Escalation

Si algo no funciona durante testing:

1. **Verificar logs:**
   ```
   Vercel Dashboard → Logs
   Filtrar por: [WHATSAPP]
   Buscar: detectInformationalQueryPreFlow o detectPostActionContextPreFlow
   ```

2. **Common Issues:**
   - "No se detecta consulta informativa" → Verificar que hay appointmentContext
   - "No se detecta contexto post-acción" → Verificar TTL no expiró
   - "NLU falla constantemente" → Verificar OPENAI_API_KEY configurada

3. **Rollback Inmediato:**
   ```javascript
   Dashboard → Feature Flags → Desactivar
   Resultado: Vuelve a comportamiento anterior
   ```
