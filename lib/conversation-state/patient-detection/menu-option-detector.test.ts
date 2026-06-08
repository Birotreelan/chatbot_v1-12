import { describe, it, expect } from 'vitest';
import { detectMenuOption, NEW_PATIENT_MENU } from './menu-option-detector';

describe('Menu Option Detector', () => {
  it('should detect "solicitar turno" as option 1 for new patient menu', async () => {
    const result = await detectMenuOption('solicitar turno', NEW_PATIENT_MENU, '1234567890');
    expect(result.detected).toBe(true);
    expect(result.selectedOption).toBe(1);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should detect "turno" as option 1', async () => {
    const result = await detectMenuOption('turno', NEW_PATIENT_MENU, '1234567890');
    expect(result.detected).toBe(true);
    expect(result.selectedOption).toBe(1);
  });

  it('should detect "agendar" as option 1', async () => {
    const result = await detectMenuOption('agendar', NEW_PATIENT_MENU, '1234567890');
    expect(result.detected).toBe(true);
    expect(result.selectedOption).toBe(1);
  });

  it('should detect "consulta" as option 2', async () => {
    const result = await detectMenuOption('consulta', NEW_PATIENT_MENU, '1234567890');
    expect(result.detected).toBe(true);
    expect(result.selectedOption).toBe(2);
  });

  it('should detect "información" as option 2', async () => {
    const result = await detectMenuOption('información', NEW_PATIENT_MENU, '1234567890');
    expect(result.detected).toBe(true);
    expect(result.selectedOption).toBe(2);
  });

  it('should handle case-insensitive input', async () => {
    const result = await detectMenuOption('SOLICITAR TURNO', NEW_PATIENT_MENU, '1234567890');
    expect(result.detected).toBe(true);
    expect(result.selectedOption).toBe(1);
  });

  it('should handle extra spaces', async () => {
    const result = await detectMenuOption('  solicitar turno  ', NEW_PATIENT_MENU, '1234567890');
    expect(result.detected).toBe(true);
    expect(result.selectedOption).toBe(1);
  });

  it('should not detect unrelated message', async () => {
    const result = await detectMenuOption('hola cómo estás?', NEW_PATIENT_MENU, '1234567890');
    expect(result.detected).toBeFalsy();
  });
});
