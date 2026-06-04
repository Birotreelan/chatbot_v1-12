# Guía de Testing - Validación Permite_Turnos_Online

## ⚙️ Pre-requisitos

1. **Variable de Entorno Configurada:**
   ```
   ESCALATION_PHONE_NUMBER=+54 9 11 6123 4567
   ```
   
   Si no está configurada, la prueba seguirá funcionando pero mostrará `[NÚMERO DE DERIVACIÓN]`

2. **Build exitoso:**
   ```bash
   cd /vercel/share/v0-project
   pnpm run build
   ```

3. **Servidor ejecutándose:**
   ```bash
   pnpm run dev
   ```

---

## 🧪 Casos de Prueba

### TEST 1: Paciente Nuevo - Obra Social CON Permisos (1 resultado)

**Objetivo:** Verificar que continúa normalmente cuando `permite_turnos_online: true`

**Pasos:**
1. Enviar mensaje inicial para iniciar flujo de paciente nuevo
2. Cuando pida obra social, escribir: `"OSDE"`
3. Confirmar que API devuelve `permite_turnos_online: true`

**Resultado Esperado:**
```
✅ Sistema continúa al paso de sedes
✅ Se muestra lista de sedes disponibles
✅ Estado guardado correctamente en Redis
```

**Verificación en Logs:**
```
[INFO] Obra social validated | obraSocialId: ... | nombre: OSDE
[INFO] Transitioning to sedes selection | sedesCount: X
```

---

### TEST 2: Paciente Nuevo - Obra Social SIN Permisos (1 resultado)

**Objetivo:** Verificar que se muestra derivación cuando `permite_turnos_online: false`

**Pasos:**
1. Iniciar flujo de paciente nuevo
2. Cuando pida obra social, escribir: `"PAMI"` (suponiendo que PAMI retorna `false`)
3. Verificar el mensaje de respuesta

**Resultado Esperado:**
```
❌ Flujo se detiene
✅ Se muestra mensaje de derivación con número de teléfono
✅ No se guarda obra social en estado (flujo termina)
✅ Se registra en logs como rechazo
```

**Verificación en Logs:**
```
[WARN] Obra social no permite turnos online | obraSocialId: ... | nombre: PAMI
```

**Mensaje Esperado:**
```
Gracias [NOMBRE]. Lamentablemente, PAMI no está habilitada 
para agendar turnos por este medio.

Para agendar tu turno, por favor contactanos al: *+54 9 11 6123 4567*
```

---

### TEST 3: Paciente Nuevo - Múltiples Obras Sociales, Selecciona CON Permisos

**Objetivo:** Verificar validación cuando hay múltiples opciones y user selecciona una válida

**Pasos:**
1. Iniciar flujo de paciente nuevo
2. Cuando pida obra social, escribir: `"Swiss"` (que retorna múltiples opciones)
3. Seleccionar opción `1` (suponiendo que `Swiss Medical` tiene `permite_turnos_online: true`)
4. Verificar que continúa al siguiente paso

**Resultado Esperado:**
```
✅ Se muestra list de opciones (1. Swiss Medical, 2. Swiss Medical Plus)
✅ User selecciona opción
✅ Obra social se valida correctamente
✅ Continúa al paso de sedes
```

**Verificación en Logs:**
```
[INFO] Multiples obras sociales encontradas | count: 2
[INFO] Obra social seleccionada por numero | numero: 1 | nombre: Swiss Medical
[INFO] Transitioning to sedes selection
```

---

### TEST 4: Paciente Nuevo - Múltiples Obras Sociales, Selecciona SIN Permisos

**Objetivo:** Verificar que rechaza cuando selecciona obra social sin permisos

**Pasos:**
1. Iniciar flujo de paciente nuevo
2. Escribir: `"Swiss"` (múltiples opciones)
3. Seleccionar opción que tiene `permite_turnos_online: false`

**Resultado Esperado:**
```
❌ Se muestra mensaje de derivación
✅ Flujo se detiene en fase de selección
✅ No continúa a sedes
```

**Verificación en Logs:**
```
[WARN] Obra social seleccionada no permite turnos online | nombre: [nombre]
```

---

### TEST 5: Paciente Existente - Obra Social CON Permisos

**Objetivo:** Verificar que paciente existente continúa si obra social permite turnos

**Pasos:**
1. Iniciar flujo de paciente existente (vía DNI o teléfono conocido)
2. Sistema detecta: `obra_social: "OSDE"` con `permite_turnos_online: true`
3. Verificar que muestra sedes

**Resultado Esperado:**
```
✅ Se valida obra social en initializeExistingPatientFlow
✅ Se muestra mensaje de bienvenida + sedes
✅ Usuario puede seleccionar sede
```

**Verificación en Logs:**
```
[INFO] Initializing existing patient flow | patientId: ...
[INFO] Final patient data for flow | ... obraSocialNombre: OSDE
[INFO] Flow initialized | sedesCount: X
```

---

### TEST 6: Paciente Existente - Obra Social SIN Permisos

**Objetivo:** Verificar que rechaza inmediatamente si obra social no permite turnos

**Pasos:**
1. Iniciar flujo de paciente existente con `obra_social: "PAMI"` (suponiendo que retorna `false`)
2. Verificar el mensaje de respuesta
3. Confirmar que no muestra sedes

**Resultado Esperado:**
```
❌ Flujo se detiene al inicializar
✅ Se muestra mensaje de derivación sin mostrar sedes
✅ No se crea estado de flujo en Redis (o se marca como rechazado)
✅ Se registra en logs como rechazo
```

**Verificación en Logs:**
```
[WARN] Obra social de paciente existente no permite turnos online | obraSocialNombre: PAMI
```

**Mensaje Esperado:**
```
Hola [NOMBRE]. Lamentablemente, tu obra social (PAMI) 
no está habilitada para agendar turnos por este medio.

Para agendar tu turno, por favor contactanos al: *+54 9 11 6123 4567*
```

---

### TEST 7: Error de API - Obra Social no Responde

**Objetivo:** Verificar fallback permisivo cuando API falla

**Pasos:**
1. Simular que endpoint de obras sociales retorna error
2. User intenta agendar
3. Verificar que continúa (fallback permisivo)

**Resultado Esperado:**
- **Paciente Nuevo:** Asume `permite_turnos_online: true` y continúa
- **Paciente Existente:** Registra warning pero continúa

**Verificación en Logs:**
```
[ERROR] Error validating obra social | error: [error message]
[WARN] Error validating obra social for existing patient
```

---

### TEST 8: Variable de Entorno No Configurada

**Objetivo:** Verificar que no bloquea si falta `ESCALATION_PHONE_NUMBER`

**Pasos:**
1. Remover/comentar `ESCALATION_PHONE_NUMBER` del `.env`
2. Ejecutar test donde una obra social rechace turnos
3. Verificar que muestra placeholder

**Resultado Esperado:**
```
✅ Se muestra mensaje con placeholder
✅ Mensaje: "Para agendar tu turno, por favor contactanos al: *[NÚMERO DE DERIVACIÓN]*"
✅ Flujo se detiene normalmente (no hay error)
```

---

## 🔍 Verificación de Logs

Ejecutar durante pruebas:
```bash
# Ver logs en tiempo real
tail -f /vercel/share/v0-project/logs/*.log | grep -E "(obra_social|permiteTurnos|existe_patient_init)"
```

O usar el dashboard si está disponible.

---

## 📊 Checklist de Verificación

- [ ] TEST 1: Nueva obra social CON permisos (1 resultado) - ✅
- [ ] TEST 2: Nueva obra social SIN permisos (1 resultado) - ✅
- [ ] TEST 3: Múltiples opciones, selecciona CON permisos - ✅
- [ ] TEST 4: Múltiples opciones, selecciona SIN permisos - ✅
- [ ] TEST 5: Paciente existente CON permisos - ✅
- [ ] TEST 6: Paciente existente SIN permisos - ✅
- [ ] TEST 7: Error de API (fallback) - ✅
- [ ] TEST 8: Variable de entorno no configurada - ✅
- [ ] Build sin errores - ✅
- [ ] Todos los logs esperados aparecen - ✅

---

## 🚀 Flujo de Verificación Rápida

Si quieres verificar los cambios rápidamente:

```bash
# 1. Verificar que el build compiló sin errores
cd /vercel/share/v0-project
pnpm run build

# 2. Verificar imports correctos
grep -r "validarObraSocial" lib/conversation-state/ --include="*.ts"

# 3. Verificar que los cambios se aplicaron
grep -A 5 "permite_turnos_online === false" lib/conversation-state/new-patient/new-patient-flow-integration.ts

# 4. Verificar la interfaz fue actualizada
grep -A 2 "interface ObraSocialOption" lib/conversation-state/shared/types.ts
```

**Salida Esperada:**
```
✅ Import found: validarObraSocial
✅ Validation logic present in both files
✅ ObraSocialOption includes permite_turnos_online field
```

---

## 📝 Notas Importantes

1. **Fallback Permisivo:** Si algo falla en la validación, el sistema permite avanzar (no bloquea por error)

2. **Logging:** Se registran eventos de rechazo para auditoría y debugging

3. **Redis:** El estado NO se persiste cuando se rechaza por obra social (flujo termina sin guardar)

4. **Número de Derivación:** Viene de `ESCALATION_PHONE_NUMBER` - debe estar configurado para mostrarse correctamente

5. **API Llamadas:** Usa la función `validarObraSocial()` que ya estaba implementada - no crea nuevas llamadas a API
