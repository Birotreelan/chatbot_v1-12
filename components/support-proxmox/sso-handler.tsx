'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export function SSOHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ssoToken = searchParams.get('sso_token');

  useEffect(() => {
    if (ssoToken) {
      // Redirigir al endpoint de SSO para procesarlo
      router.push(`/api/auth/sso?sso_token=${encodeURIComponent(ssoToken)}`);
    }
  }, [ssoToken, router]);

  if (ssoToken) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600"></div>
          <p className="text-gray-600">Autenticando con SSO...</p>
        </div>
      </div>
    );
  }

  return null;
}
