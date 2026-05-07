# Historial de Implementaciones - Panel de Atención al Cliente

## [2026-05-07] Bloqueo Atómico para Asignación de Sesiones

### Problema
En un sistema con múltiples agentes, existía una **race condition** en la asignación de sesiones:
- Dos agentes podían ver la misma sesión pendiente
- Ambos hacían click simultáneamente
- Sin sincronización, ambos podían tomar la misma sesión (la última escritura ganaba)

### Solución Implementada
Se agregó un **mecanismo de lock atómico** usando Redis:

```typescript
// Clave de lock: human_support:lock:{sessionId}
// Operación: SET con NX (solo si no existe) + EX (expiración 30s)
const lockAcquired = await redis.set(lockKey, lockValue, {
  NX: true,  // Solo establece si la clave no existe
  EX: 30,    // Expira automáticamente en 30 segundos
})
```

### Archivo Modificado
- `/lib/human-support.ts` - Función `assignSessionToAgent()`
  - Antes: Lectura sin sincronización → Escritura
  - Después: Lock atómico → Lectura → Verificación → Escritura → Liberar lock

- `/app/api/support/actions/route.ts` - Función `handleAssign()`
  - Agregado detección de race condition (HTTP 409)
  - Cliente puede detectar si otra persona tomó la sesión

### Garantías de Seguridad
✅ Solo un agente puede tomar una sesión  
✅ Si dos intentan simultáneamente, uno gana y otro recibe error 409  
✅ El lock se libera automáticamente en 30s si el proceso falla  
✅ Los logs diferencia entre "lock no adquirido" (409) y otros errores  

### Comportamiento en Frontend
1. Agente A toma sesión #123 ✅
2. Agente B intenta tomar #123 (simultáneamente)
3. Agente B recibe: `{ success: false, reason: "race_condition" }`
4. Panel de Agente B actualiza lista automáticamente
5. Sesión #123 ya no aparece en pendientes

### Próximas Optimizaciones (Opcional)
- [ ] Actualización en tiempo real (Server-Sent Events) en lugar de polling cada 10s
- [ ] Notificación visual al agente cuando pierde una carrera
- [ ] Estadísticas de "sesiones perdidas" por race condition
