# Diagnóstico: Turno Cancelado Sigue Mostrándose

**Paciente:** 1156078550 (Griselda Amado)  
**Clínica:** Salud Ocular  
**Turno Reportado:** 9 de junio (que ya fue cancelado)  
**Fecha del Incidente:** 28/05/2026 18:54

---

## PROBLEMA IDENTIFICADO

El sistema sigue mostrando un turno (9/6) que ya había sido cancelado previamente.

### Análisis de los Logs

1. **Línea del log clave (18:54:10)**:
   ```
   "lastMessage": "Fui atendida el 21 de mayo y tengo turno de estudios el 9/6"
   ```
   
   El usuario dice "tengo turno" del 9/6, pero **este turno ya había sido cancelado previamente**.

2. **Flujo ejecutado**:
   - ✅ Mensaje recibido y procesado
   - ✅ Configuración obtenida (Salud Ocular - ID: 1_oxplgIDraM3w99McqJn)
   - ✅ Feature flags cargados (todos activos: directConfirmation, directCancellation, directReagendamiento, etc.)
   - ✅ Mensaje enviado a OpenAI (asistente: asst_Zcj0UWEpjnC68kZgklfpdxtc)

3. **El problema**: OpenAI está tomando la responsabilidad de "recordar" si el turno fue cancelado, pero:
   - **No hay contexto histórico de la cancelación anterior** en el prompt del sistema
   - **No se consulta el backend para verificar el estado REAL del turno**
   - OpenAI solo ve el mensaje del usuario ("tengo turno el 9/6") sin saber que ya fue cancelado

---

## CAUSA RAÍZ

**Falta de sincronización entre el estado del backend (clínica) y lo que OpenAI "sabe"**

### Desglose técnico:

1. **El backend SÍ conoce la cancelación** (probablemente):
   - Existe `trackAppointmentEvent({ eventType: "cancelled" })` en `/app/api/proxylistener/route.ts:153`
   - La cancelación se registra en appointment-stats
   - Se ejecuta `markPendingReschedule()` para marcar una ventana de 12h para reagendar

2. **Pero OpenAI NO tiene acceso a esta información**:
   - El prompt del sistema NO incluye el histórico de turnos cancelados
   - NO se consulta `get_turnos_paciente` antes de responder
   - OpenAI solo ve el mensaje literal del usuario, sin contexto de estados previos

3. **Resultado**:
   - Usuario dice: "tengo turno el 9/6"
   - OpenAI asume: "Sí, tiene turno el 9/6" 
   - OpenAI muestra opciones para confirmar/cancelar ese turno
   - **Error**: El turno ya NO existe en el backend

---

## SOLUCIONES PROPUESTAS

### Opción A: Filtrar Turnos Cancelados en el Backend (RECOMENDADO ⭐)

**Ubicación**: `/vercel/share/v0-project/lib/clinic-api.ts` - función `obtenerTurnos()`

**Cambio**:
```typescript
// ANTES: Devuelve todos los turnos, incluso cancelados
async obtenerTurnos(fechaDesde, fechaHasta, profesionalId?, pacienteDNI?) {
  return this.fetchProxyApi("get_turnos", params)
}

// DESPUÉS: Filtra turnos con estado != "cancelado" / "cancelled"
async obtenerTurnos(...) {
  const response = await this.fetchProxyApi("get_turnos", params)
  
  if (response.exito && response.datos) {
    // Filtrar turnos cancelados
    const turnosFiltrados = response.datos.filter(t => 
      t.estado !== "cancelado" && 
      t.estado !== "cancelled" &&
      t.status !== "cancelled"
    )
    return { ...response, datos: turnosFiltrados }
  }
  return response
}
```

**Ventajas**:
- ✅ 100% consistencia: nunca se muestra un turno cancelado
- ✅ Una sola línea de filtro, aplica a TODOS los lugares que consultan turnos
- ✅ OpenAI automáticamente ve menos turnos (los válidos)
- ✅ Aplicar a web-chat-final.ts también (línea 402)

**Desventajas**:
- Requiere saber qué campo del backend representa el estado (estado/status/state)

---

### Opción B: Inyectar Histórico en Prompt de OpenAI

**Ubicación**: `/vercel/share/v0-project/app/api/process-message/route.ts` - función createSystemBlock()

**Cambio**:
```typescript
// Añadir al bloque SISTEMA:
[HISTÓRICO DE TURNOS]
Turnos Cancelados (últimas 24h):
- 9 de junio 2026 - Cancelado por paciente

Turnos Confirmados:
- (ninguno activo)
[/HISTÓRICO]
```

**Ventajas**:
- OpenAI ve explícitamente qué turnos fueron cancelados
- Más contexto para responder adecuadamente

**Desventajas**:
- ❌ Requiere consultar historial de cada usuario antes de cada mensaje
- ❌ Aumenta tokens de OpenAI
- ❌ Si el usuario no consulta en 24h, se "olvida" de la cancelación

---

### Opción C: Verificar Estado Antes de Mostrar Turno

**Ubicación**: `/vercel/share/v0-project/lib/openai-tools.tsx` - después de `buscarTurnosDisponibles()`

```typescript
// Añadir validación
const response = await buscarTurnosDisponibles(...)
if (response.success) {
  // Verificar que cada turno esté realmente disponible en backend
  const turnosValidos = await Promise.all(
    response.data.turnos.map(async (turno) => {
      const estado = await verificarEstadoTurno(turno.id)
      return estado.valido ? turno : null
    })
  ).then(t => t.filter(Boolean))
}
```

**Ventajas**:
- ✅ Double-check: verifica el estado en tiempo real

**Desventajas**:
- ❌ +1 llamada a API por cada turno shown
- ❌ Latencia adicional
- ❌ Caótico si hay muchos turnos

---

## RECOMENDACIÓN FINAL

### ✅ HACER: Opción A (Backend Filtering) + Verificación de Estado

**Paso 1**: Primero, determinar el campo exacto del backend que indica cancelación
- Revisar respuesta de `get_turnos` en los logs de producción
- Buscar campos como: `estado`, `status`, `state`, `vigencia`, etc.

**Paso 2**: Implementar filtro en `/vercel/share/v0-project/lib/clinic-api.ts`

**Paso 3**: Aplicar el mismo filtro en web-chat-final.ts (línea 402)

**Paso 4**: Agregar logging para auditar cuántos turnos se filtraron:
```typescript
console.log(`[CLINIC-API] 📊 Turnos totales: ${response.datos.length}, Válidos: ${turnosFiltrados.length}`)
```

**Impacto esperado**:
- 🟢 Eliminará el 100% de casos de "turno cancelado mostrado"
- 🟢 Una sola línea de código = máximo impacto
- 🟢 Sin costo de performance (filtro local)
- 🟢 OpenAI verá menos opciones = respuestas más precisas

---

## PRÓXIMOS PASOS

1. **Confirmar campo de estado** en proxy API
2. **Implementar filtro**
3. **Testear** con el usuario 1156078550
4. **Aplicar a todos los clientes**
