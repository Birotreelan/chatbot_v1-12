import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { getConfigByClienteId } from './db';

export interface SSOTokenPayload {
  cliente_id: string;
  exp: number;
  iat: number;
  fingerprint: string;
  email?: string;
  name?: string;
}

export interface SSOValidationResult {
  valid: boolean;
  error?: string;
  payload?: SSOTokenPayload;
}

/**
 * Decodifica y parsea el payload del token SSO
 */
function decodePayload(payloadBase64: string): SSOTokenPayload | null {
  try {
    const decoded = Buffer.from(payloadBase64, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch (error) {
    return null;
  }
}

/**
 * Valida la firma HMAC-SHA256 del token
 */
function verifySignature(
  payloadBase64: string,
  signature: string,
  secret: string
): boolean {
  try {
    const derivedSecret = createHash('sha256')
      .update(secret)
      .digest('hex');

    const expectedSignature = createHmac('sha256', derivedSecret)
      .update(payloadBase64)
      .digest('hex');

    // Comparación timing-safe para evitar ataques de timing
    return timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(signature)
    );
  } catch (error) {
    return false;
  }
}

/**
 * Valida el fingerprint del cliente
 */
function verifyFingerprint(
  clientFingerprint: string,
  clientIp: string,
  userAgent: string
): boolean {
  try {
    const computedFingerprint = createHash('sha256')
      .update(`${clientIp}${userAgent}`)
      .digest('hex');

    return timingSafeEqual(
      Buffer.from(clientFingerprint),
      Buffer.from(computedFingerprint)
    );
  } catch (error) {
    return false;
  }
}

/**
 * Valida la expiración del token
 */
function isTokenExpired(expirationTime: number): boolean {
  return Date.now() > expirationTime * 1000;
}

/**
 * Valida que el cliente exista y esté activo
 */
async function isClienteActive(clienteId: string): Promise<boolean> {
  try {
    const config = await getConfigByClienteId(clienteId);
    return config !== null;
  } catch (error) {
    console.error('[SSO] Error validating cliente:', error);
    return false;
  }
}

/**
 * Valida completamente un token SSO
 */
export async function validateSSOToken(
  ssoToken: string,
  clientIp: string,
  userAgent: string
): Promise<SSOValidationResult> {
  // Validar formato básico del token
  if (!ssoToken || typeof ssoToken !== 'string') {
    return { valid: false, error: 'Token inválido' };
  }

  const parts = ssoToken.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Formato de token incorrecto' };
  }

  const [payloadBase64, signature] = parts;

  // Decodificar payload
  const payload = decodePayload(payloadBase64);
  if (!payload) {
    return { valid: false, error: 'No se pudo decodificar el payload' };
  }

  // Validar que tenga los campos requeridos
  if (!payload.cliente_id || !payload.exp || !payload.fingerprint) {
    return { valid: false, error: 'Token incompleto' };
  }

  // Validar expiración
  if (isTokenExpired(payload.exp)) {
    return { valid: false, error: 'Token expirado' };
  }

  // Validar fingerprint
  if (!verifyFingerprint(payload.fingerprint, clientIp, userAgent)) {
    return { valid: false, error: 'Fingerprint no válido' };
  }

  // Validar firma
  const secret = process.env.TREELAN_BOT_SECRET;
  if (!secret) {
    return { valid: false, error: 'Configuración de servidor incompleta' };
  }

  if (!verifySignature(payloadBase64, signature, secret)) {
    return { valid: false, error: 'Firma de token no válida' };
  }

  // Validar que el cliente exista y esté activo
  const clienteExists = await isClienteActive(payload.cliente_id);
  if (!clienteExists) {
    return { valid: false, error: 'Cliente no existe o está inactivo' };
  }

  return { valid: true, payload };
}
