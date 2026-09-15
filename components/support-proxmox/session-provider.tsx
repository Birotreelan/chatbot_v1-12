'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

interface SessionContextType {
  sessionId: string | null;
  getAuthHeaders: () => Record<string, string>;
  appendSessionToUrl: (url: string) => string;
}

const SessionContext = createContext<SessionContextType>({
  sessionId: null,
  getAuthHeaders: () => ({}),
  appendSessionToUrl: (url) => url,
});

export function useSession() {
  return useContext(SessionContext);
}

interface SessionProviderProps {
  children: ReactNode;
  initialSessionId?: string | null;
}

export function SessionProvider({ children, initialSessionId }: SessionProviderProps) {
  const searchParams = useSearchParams();
  const urlSessionId = searchParams.get('_sid');
  
  // Priorizar el sessionId de la URL (para Safari), luego el inicial del servidor
  const [sessionId, setSessionId] = useState<string | null>(urlSessionId || initialSessionId || null);

  useEffect(() => {
    // Si hay un _sid en la URL, guardarlo en sessionStorage para persistirlo
    if (urlSessionId) {
      sessionStorage.setItem('sso_session_id', urlSessionId);
      setSessionId(urlSessionId);
    } else {
      // Intentar recuperar de sessionStorage si no está en URL
      const stored = sessionStorage.getItem('sso_session_id');
      if (stored && !sessionId) {
        setSessionId(stored);
      }
    }
  }, [urlSessionId, sessionId]);

  // Función para obtener headers de autenticación (para Safari)
  const getAuthHeaders = (): Record<string, string> => {
    if (sessionId) {
      return { 'X-Session-Id': sessionId };
    }
    return {};
  };

  // Función para agregar el sessionId a una URL (para navegación en Safari)
  const appendSessionToUrl = (url: string): string => {
    if (!sessionId) return url;
    
    try {
      const urlObj = new URL(url, window.location.origin);
      // Solo agregar _sid si la URL es del mismo origen y es una ruta de support
      if (urlObj.pathname.startsWith('/support') || urlObj.pathname.startsWith('/api/support')) {
        if (!urlObj.searchParams.has('_sid')) {
          urlObj.searchParams.set('_sid', sessionId);
        }
      }
      return urlObj.toString();
    } catch {
      return url;
    }
  };

  return (
    <SessionContext.Provider value={{ sessionId, getAuthHeaders, appendSessionToUrl }}>
      {children}
    </SessionContext.Provider>
  );
}
