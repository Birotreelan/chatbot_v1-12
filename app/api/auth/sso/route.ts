import { NextRequest, NextResponse } from 'next/server';
import { validateSSOToken } from '@/lib/sso';
import { createSession } from '@/lib/auth';
import { nanoid } from 'nanoid';
import type { SessionData } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    // Obtener el token SSO de los query parameters
    const ssoToken = request.nextUrl.searchParams.get('sso_token');

    if (!ssoToken) {
      return NextResponse.json(
        { error: 'Token SSO requerido' },
        { status: 400 }
      );
    }

    // Obtener IP del cliente (considerar proxies)
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';

    // Obtener User-Agent
    const userAgent = request.headers.get('user-agent') || '';

    // Validar el token SSO
    const validationResult = await validateSSOToken(ssoToken, clientIp, userAgent);

    if (!validationResult.valid || !validationResult.payload) {
      console.warn('[SSO] Validación fallida:', validationResult.error);
      return NextResponse.json(
        { error: validationResult.error || 'Token no válido' },
        { status: 401 }
      );
    }

    const { cliente_id, email, name } = validationResult.payload;

    // Crear sesión con los datos del token SSO
    const sessionData: SessionData = {
      userId: `sso_${cliente_id}_${nanoid(8)}`,
      username: email || `cliente_${cliente_id}`,
      role: 'support_agent',
      tenantId: cliente_id,
      displayName: name || email || `Cliente ${cliente_id}`,
    };

    await createSession(sessionData);

    // Redirigir a /support sin el token en la URL
    return NextResponse.redirect(new URL('/support', request.url), {
      status: 302,
    });
  } catch (error) {
    console.error('[SSO] Error en validación:', error);
    return NextResponse.json(
      { error: 'Error al procesar el token SSO' },
      { status: 500 }
    );
  }
}
