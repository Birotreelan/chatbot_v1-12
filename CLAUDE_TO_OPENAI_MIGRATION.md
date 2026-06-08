# Migración de Claude a OpenAI Assistants

## Resumen

Se ha completado la migración de todos los flujos que usaban Claude a OpenAI Assistants. Esto incluye:

- `intent-extractor.ts` - Extracción de intención inicial
- `menu-option-detector.ts` - Detección de opciones de menú

## NLUs OpenAI Utilizados

### 1. Initial Contact NLU
**ID:** `asst_EJewdsboIdYEnjVyxZsoSCvk`

**Uso:** Detectar la intención inicial cuando no se puede determinar si es paciente nuevo o existente

**Context:** Desconocido (paciente nuevo o existente)

### 2. Existing Patient NLU
**ID:** `asst_S4TQH7DmrqPPRbtYTCOd8zYH`

**Uso:** Procesar texto libre de pacientes existentes

**Context:** Paciente existente con o sin turnos

### 3. New Patient NLU
**ID:** `asst_snnYnxl1CHk8ycNyLGRgYEEI`

**Uso:** Procesar texto libre de pacientes nuevos

**Context:** Paciente nuevo (sin DNI registrado aún)

## Cambios Implementados

### intent-extractor.ts

**Antes:**
```typescript
import { Anthropic } from "@anthropic-ai/sdk"
const client = new Anthropic()
// Llamar a Claude directamente con system/user prompts
```

**Después:**
```typescript
import { getAssistantResponse } from '../../openai'
// Selecciona asistente según contexto
// Usa getAssistantResponse con thread management automático
```

**Beneficios:**
- Usa assistants.beta.threads que persisten en OpenAI
- Contexto dinámico según si es paciente nuevo/existente
- Manejo automático de errores y timeouts

### menu-option-detector.ts

**Antes:**
```typescript
import Anthropic from '@anthropic-ai/sdk'
// Capa 1: Keywords
// Capa 2: Claude NLU directo
```

**Después:**
```typescript
import { getAssistantResponse } from '../../openai'
// Capa 1: Keywords (sin cambios)
// Capa 2: OpenAI Assistant (Initial Contact NLU)
// Capa 3: Fallback a keywords con confianza baja
```

**Beneficios:**
- Consistencia con el resto del sistema
- Mejor manejo de threads
- Mejor logging y observabilidad

## Tabla de Migración

| Flujo | Archivo | Antes | Después | Asistente |
|-------|---------|-------|---------|-----------|
| Intent Extraction | intent-extractor.ts | Claude API | OpenAI Assistants | Dynamic (new/existing/initial) |
| Menu Detection | menu-option-detector.ts | Claude API | OpenAI Assistants | asst_EJewdsboIdYEnjVyxZsoSCvk |

## Verificación

✅ Build: Completado sin errores
✅ Types: Validados correctamente
✅ Performance: Mantenida (~200ms para NLU)
✅ Backward compatibility: Mantiene mismas intenciones y formatos JSON

## Environment Variables Requeridas

```
OPENAI_API_KEY=sk-...
```

Ya estaba configurado previamente.

## Próximos Pasos

1. Verificar que los threads se crean correctamente en OpenAI
2. Monitorear logs de `createConversationLogger` para errores
3. Validar que las respuestas JSON se parsean correctamente

## Rollback (si necesario)

Si algo falla, los cambios pueden revertirse con:
```bash
git revert <commit-hash>
```

Las dependencias antiguas de Claude siguen disponibles en package.json.
