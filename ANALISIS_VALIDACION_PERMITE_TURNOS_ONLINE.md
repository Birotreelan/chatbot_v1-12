# Análisis: Validación de `Permite_Turnos_Online` en Flujo de Agendamiento

## Estado Actual: ❌ NO IMPLEMENTADO

### Resumen Ejecutivo

**Problema:** El sistema **NO valida actualmente** si una obra social permite turnos online (`Permite_Turnos_Online: false/true`) antes de iniciar el flujo de agendamiento.

**Impacto:** 
- Pacientes pueden avanzar en el flujo de agendamiento de obras sociales que NO permiten turnos online
- Se desperdician recursos buscando turnos que nunca se podrán agendar
- Experiencia de usuario negativa

---

## Análisis Detallado

### 1. API y Datos Disponibles

✅ **Endpoint disponible:** `get_obras_sociales`

**Respuesta de ejemplo (anexo del usuario):**
```json
{
  "obras_sociales": [
    {
      "Id": "bbc56352-13a6-11f0-915d-d85ed30205a2",
      "Nombre": "PAMI CASEROS",
      "Razon_Social": "PAMI",
      "Permite_Turnos_Online": false,
      "Permite_Turnos_Online_Texto": "No"
    }
  ],
  "total_encontradas": 10,
  "busqueda_realizada": "pami"
}
```

**Campo crítico:** `Permite_Turnos_Online` (boolean)

---

### 2. Flujo de Paciente Nuevo - ANÁLISIS ACTUAL

**Archivo:** `lib/conversation-state/new-patient/new-patient-flow-integration.ts`

#### Fase: `handleObraSocialPhase` (línea ~321)

```typescript
async function handleObraSocialPhase(
  phone: string,
  userMessage: string,
  clientId: string,
  state: NewPatientFlowState
): Promise<NewPatientResult> {
  // ... código ...
  
  const result = await validarObraSocial(clientId, input)
  
  if (result.exito && result.datos.total_encontradas === 1) {
    const obraSocial = result.datos.obras_sociales[0]
    
    state.obraSocialId = obraSocial.id
    state.obraSocialNombre = obraSocial.nombre
    state.obraSocialValidada = true  // ❌ Se marca como validada sin verificar Permite_Turnos_Online
    
    // ... continúa al siguiente paso ...
  }
}
```

**❌ PROBLEMA:** No se verifica `obraSocial.permite_turnos_online`

---

### 3. Flujo de Paciente Existente - ANÁLISIS ACTUAL

**Archivo:** `lib/conversation-state/existing-patient/existing-patient-flow-integration.ts`

⚠️ **Nota:** El flujo de paciente existente NO solicita obra social en el paso de validación. En cambio:
1. La obra social viene en el objeto `paciente` desde `get_paciente` API call
2. Se obtiene del campo `Deudor_Nombre` o similar
3. **NO valida** si esa obra social permite turnos online

---

### 4. API Function - `validarObraSocial` 

**Archivo:** `lib/api-tools/api-functions.ts` (línea ~423)

```typescript
export async function validarObraSocial(
  clienteId: string,
  busqueda: string,
  useCache = true,
): Promise<
  ApiResponse<{
    obras_sociales: Array<{
      id: string
      nombre: string
      razon_social: string
      permite_turnos_online: boolean  // ✅ Se mapea correctamente
      permite_turnos_online_texto: string
    }>
    total_encontradas: number
    busqueda_realizada: string
  }>
> {
  const resultado = await fetchProxyApi<any>(clienteId, "get_obras_sociales", { busqueda }, useCache)

  if (resultado.exito && resultado.datos) {
    const obrasSocialesMapeadas = Array.isArray(rawObrasSociales) 
      ? rawObrasSociales.map((os: any) => ({
          id: os.Id || os.id || os.Deudor_Id || os.deudor_id,
          nombre: os.Nombre || os.nombre || os.Descripcion || os.descripcion || os.Razon_Social || os.razon_social,
          razon_social: os.Razon_Social || os.razon_social || os.Nombre || os.nombre,
          permite_turnos_online: os.Permite_Turnos_Online ?? os.permite_turnos_online ?? true,  // ✅ Se mapea correctamente
          permite_turnos_online_texto: os.Permite_Turnos_Online_Texto || os.permite_turnos_online_texto || '',
        }))
      : []
    
    return {
      exito: true,
      datos: {
        obras_sociales: obrasSocialesMapeadas,
        total_encontradas: resultado.datos.total_encontradas || obrasSocialesMapeadas.length,
        busqueda_realizada: resultado.datos.busqueda_realizada || busqueda,
      },
    }
  }
}
```

✅ **Buena noticia:** La API ya mapea correctamente `Permite_Turnos_Online` a `permite_turnos_online`

---

### 5. Búsqueda de Turnos - ANÁLISIS ACTUAL

**Archivo:** `lib/conversation-state/shared/turnos-handler.ts`

**Función:** `searchTurnosAcumulativo` (línea ~44)

```typescript
export async function searchTurnosAcumulativo(
  clientId: string,
  params: {
    sedeId: string
    pacienteDNI?: string
    obraSocialId?: string  // Viene el ID pero no se valida el "permite_turnos_online"
    profesionalId?: string
    especialidadId?: string
  },
  phoneNumber: string
): Promise<...>
```

❌ **No hay validación** de si la obra social permite turnos online

---

## Solución Recomendada

### Cambios Necesarios (Paciente Nuevo)

#### 1. **`handleObraSocialPhase` - new-patient-flow-integration.ts**

```typescript
async function handleObraSocialPhase(...): Promise<NewPatientResult> {
  // ... código existente ...
  
  if (result.exito && result.datos.total_encontradas === 1) {
    const obraSocial = result.datos.obras_sociales[0]
    
    // ✅ NUEVO: Validar si permite turnos online
    if (!obraSocial.permite_turnos_online) {
      // Rechazar la obra social
      state.attempts += 1
      state.lastInvalidInput = input
      await saveFlowState(phone, state)
      
      return {
        handled: true,
        message: `Lamentablemente, ${obraSocial.nombre} no está habilitada para agendar turnos a través de este canal.\n\nPor favor, comunicate directamente al teléfono de la clínica para solicitar tu turno.`,
      }
    }
    
    // Resto del código (validación actual)
    state.obraSocialId = obraSocial.id
    state.obraSocialNombre = obraSocial.nombre
    state.obraSocialValidada = true
    // ...
  }
}
```

---

### Cambios Necesarios (Paciente Existente)

#### 2. **Validar obra social al iniciar flujo**

**Archivo:** `lib/conversation-state/existing-patient/existing-patient-flow-integration.ts`

```typescript
export async function handleExistingPatientMessage(
  phone: string,
  userMessage: string,
  clientId: string,
  escalationPhoneNumber?: string
): Promise<ExistingPatientResult> {
  // ... código ...
  
  // ✅ NUEVO: Al obtener datos del paciente, validar obra social
  if (pacienteData && pacienteData.Deudor_Nombre) {
    const obraResult = await validarObraSocial(clientId, pacienteData.Deudor_Nombre)
    
    if (obraResult.exito && obraResult.datos.total_encontradas === 1) {
      const obra = obraResult.datos.obras_sociales[0]
      
      if (!obra.permite_turnos_online) {
        return {
          handled: true,
          message: `Hola ${pacienteData.Nombre}. Lamentablemente, ${obra.nombre} no está habilitada para agendar turnos por este medio.\n\nPor favor, llamá al teléfono de la clínica.`,
        }
      }
    }
  }
}
```

---

## Matriz de Decisión

| Escenario | Acción Actual | Acción Propuesta |
|-----------|---------------|------------------|
| **Obra social existe + `permite_turnos_online: true`** | Continúa flujo | ✅ Continúa flujo |
| **Obra social existe + `permite_turnos_online: false`** | ❌ Continúa flujo (ERROR) | ❌ Rechaza e informa |
| **Obra social no existe** | Pide reintentar | ✅ Pide reintentar |
| **Obra social es "Particular"** | Continúa flujo | ✅ Continúa flujo |

---

## Implementación - Checklist

- [ ] Validar `permite_turnos_online` en `handleObraSocialPhase` (paciente nuevo)
- [ ] Validar `permite_turnos_online` al buscar paciente existente
- [ ] Usar `escalationPhoneNumber` en mensaje de rechazo
- [ ] Probar con obras sociales que NO permiten turnos online (ej: PAMI)
- [ ] Actualizar memoria del usuario con esta implementación

---

## Archivos a Modificar

1. **`lib/conversation-state/new-patient/new-patient-flow-integration.ts`**
   - Función: `handleObraSocialPhase`
   - Línea: ~354

2. **`lib/conversation-state/existing-patient/existing-patient-flow-integration.ts`**
   - Función: `handleExistingPatientMessage` (si existe)
   - O crear validación al iniciar flujo

3. **`lib/conversation-state/new-patient/new-patient-templates.ts`** (opcional)
   - Agregar template para mensaje de rechazo de obra social

---

## Referencias

- API Response: campo `Permite_Turnos_Online` (boolean)
- API Function: `validarObraSocial()` - ya mapea el campo correctamente
- Estado del flujo: `obraSocialValidada` debe incluir validación de `permite_turnos_online`
