import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock del cliente de OpenAI: evita llamadas reales a la API en los tests.
// Cada test que necesite ejercitar la capa de IA configura el valor de retorno
// con createMock.mockResolvedValueOnce(...).
const createMock = vi.fn();
vi.mock('@/lib/openai', () => ({
  openai: {
    chat: {
      completions: {
        create: (...args: unknown[]) => createMock(...args),
      },
    },
  },
}));

import { detectMenuOption, NEW_PATIENT_MENU } from './menu-option-detector';

function mockAIResponse(selectedOption: number | null, confidence = 0.9) {
  createMock.mockResolvedValueOnce({
    choices: [
      {
        message: {
          content: JSON.stringify({ selectedOption, confidence, reasoning: 'mock' }),
        },
      },
    ],
  });
}

describe('Menu Option Detector', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  // ── Actualizados el 7/9/2026 ──────────────────────────────────────────────
  //
  // Estos tests afirmaban que UNA sola keyword alcanza para detectar la opción.
  // Eso dejó de ser cierto el 18/8/2026, cuando el umbral de la capa rápida se
  // subió de 0.60 a 0.90 a propósito: con 0.60, "Y el otro ta. Bien" matcheaba
  // la keyword "otro" y se interpretaba como "cancelar y solicitar turno nuevo"
  // (caso Felipe, tel. 1161995183). Los tests quedaron desactualizados y nadie
  // lo notó porque no había config ni script de vitest para correrlos.
  //
  // Lo que se verifica ahora es el comportamiento REAL y buscado: con 1 keyword
  // la capa gratis se abstiene y el mensaje baja a la capa de IA. No es una
  // regresión — es la protección funcionando.

  it('con 1 sola keyword la capa rápida se abstiene y delega en la IA', async () => {
    mockAIResponse(1, 0.9);
    const result = await detectMenuOption('solicitar turno', NEW_PATIENT_MENU, '1234567890');
    expect(result.detected).toBe(true);
    expect(result.selectedOption).toBe(1);
    // La clave: la decisión la tomó la IA, no el matcheo de keywords.
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('"turno" solo no alcanza para la capa rápida (sin IA no se detecta)', async () => {
    const result = await detectMenuOption('turno', NEW_PATIENT_MENU, '1234567890', false);
    expect(result.detected).toBe(false);
  });

  it('"agendar" solo no alcanza para la capa rápida (sin IA no se detecta)', async () => {
    const result = await detectMenuOption('agendar', NEW_PATIENT_MENU, '1234567890', false);
    expect(result.detected).toBe(false);
  });

  it('should resolve "consulta" as option 3 via AI fallback (1 sola keyword, bajo el umbral determinístico)', async () => {
    // Corregido 26/8/2026: 'consulta' es keyword de la opción 3 ("Realizar otra
    // consulta"), no de la 2 ("Solicitar turno para un familiar") — el test
    // original esperaba 2 y ya fallaba antes de este cambio, sin relación con el
    // fallback de IA agregado hoy. Además, 1 sola keyword da 0.75 de confianza
    // (bajo el umbral de 0.90), y el label completo no es suficientemente
    // parecido para la capa 1.5 — por eso este caso depende de la IA.
    mockAIResponse(3, 0.9);
    const result = await detectMenuOption('consulta', NEW_PATIENT_MENU, '1234567890');
    expect(result.detected).toBe(true);
    expect(result.selectedOption).toBe(3);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('should resolve "información" as option 3 via AI fallback', async () => {
    mockAIResponse(3, 0.85);
    const result = await detectMenuOption('información', NEW_PATIENT_MENU, '1234567890');
    expect(result.detected).toBe(true);
    expect(result.selectedOption).toBe(3);
  });

  // Mayúsculas y espacios de más: lo que se prueba es que la normalización
  // funcione, o sea que estas variantes se comporten IGUAL que el texto limpio
  // (que con 1 keyword baja a la capa de IA — ver los tests de arriba).
  it('should handle case-insensitive input', async () => {
    mockAIResponse(1, 0.9);
    const result = await detectMenuOption('SOLICITAR TURNO', NEW_PATIENT_MENU, '1234567890');
    expect(result.detected).toBe(true);
    expect(result.selectedOption).toBe(1);
  });

  it('should handle extra spaces', async () => {
    mockAIResponse(1, 0.9);
    const result = await detectMenuOption('  solicitar turno  ', NEW_PATIENT_MENU, '1234567890');
    expect(result.detected).toBe(true);
    expect(result.selectedOption).toBe(1);
  });

  it('should not detect unrelated message', async () => {
    // useAIFallback: false — evita una llamada real a OpenAI en el test; las capas
    // gratis (keywords + label exacto/aproximado) alcanzan para probar este caso.
    const result = await detectMenuOption('hola cómo estás?', NEW_PATIENT_MENU, '1234567890', false);
    expect(result.detected).toBeFalsy();
  });

  it('should not detect unrelated message even when AI fallback runs and returns null', async () => {
    mockAIResponse(null, 0);
    const result = await detectMenuOption('hola cómo estás?', NEW_PATIENT_MENU, '1234567890');
    expect(result.detected).toBeFalsy();
  });

  it('should detect exact button label text even without matching keywords (sin IA)', async () => {
    // Caso Rebeca (tel. 1123127066, 26/8/2026): escribir el texto exacto del botón
    // debe reconocerse por la capa de label exacto/aproximado, sin necesidad de IA.
    const result = await detectMenuOption('Realizar otra consulta', NEW_PATIENT_MENU, '1234567890', false);
    expect(result.detected).toBe(true);
    expect(result.selectedOption).toBe(3);
    expect(result.confidence).toBe(1);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('should fall back gracefully if the AI call throws (ej. sin API key / error de red)', async () => {
    createMock.mockRejectedValueOnce(new Error('network error'));
    const result = await detectMenuOption('mensaje ambiguo sin relación', NEW_PATIENT_MENU, '1234567890');
    expect(result.detected).toBe(false);
  });
});
