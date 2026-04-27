import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    console.log('[CLEANUP] Iniciando limpieza de conversaciones mayores a 30 días...');
    
    const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
    const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!UPSTASH_URL || !UPSTASH_TOKEN) {
      return NextResponse.json(
        { error: 'Variables de entorno de Upstash no configuradas' },
        { status: 500 }
      );
    }

    // Función para hacer llamadas a Upstash REST API
    const upstashCall = async (command: string[]) => {
      const response = await fetch(UPSTASH_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${UPSTASH_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(command),
      });

      if (!response.ok) {
        console.error('[CLEANUP] Error en llamada Upstash:', response.statusText);
        throw new Error(`Upstash error: ${response.statusText}`);
      }

      return response.json();
    };

    // Obtener todas las claves
    console.log('[CLEANUP] Obteniendo todas las claves de Redis...');
    const keysResponse = await upstashCall(['KEYS', '*']);
    const allKeys = keysResponse.result || [];
    console.log(`[CLEANUP] Total de claves encontradas: ${allKeys.length}`);

    // Filtrar conversaciones y obtener sus timestamps
    const conversationKeys = allKeys.filter((key: string) => key.startsWith('conversation:'));
    console.log(`[CLEANUP] Total de conversaciones: ${conversationKeys.length}`);

    if (conversationKeys.length === 0) {
      return NextResponse.json({
        message: 'No hay conversaciones para limpiar',
        stats: { totalKeys: allKeys.length },
      });
    }

    // Calcular la fecha de 30 días atrás
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    console.log(`[CLEANUP] Límite de 30 días: ${new Date(thirtyDaysAgo).toISOString()}`);

    let deletedConversations = 0;
    let deletedMessages = 0;
    let deletedContacts = 0;
    let errors: string[] = [];

    // Procesar cada conversación
    for (const conversationKey of conversationKeys) {
      try {
        // Obtener la lista de mensajes
        const messagesResponse = await upstashCall(['LRANGE', conversationKey, '0', '-1']);
        const messages = messagesResponse.result || [];

        if (messages.length === 0) continue;

        // Parsear el primer y último mensaje para obtener timestamps
        let conversationOld = false;
        
        try {
          // Intentar con el último mensaje primero (más reciente)
          const lastMessage = messages[messages.length - 1];
          if (lastMessage) {
            const parsed = JSON.parse(lastMessage);
            const messageTimestamp = parsed.timestamp || parsed.createdAt;
            if (messageTimestamp && new Date(messageTimestamp).getTime() < thirtyDaysAgo) {
              conversationOld = true;
              console.log(`[CLEANUP] Conversación antigua encontrada: ${conversationKey}`);
            }
          }
        } catch (parseError) {
          // Si no se puede parsear, asumimos que es antigua
          conversationOld = true;
        }

        // Si la conversación es antigua, eliminarla
        if (conversationOld) {
          // Eliminar conversación
          await upstashCall(['DEL', conversationKey]);
          deletedConversations++;
          deletedMessages += messages.length;

          // Eliminar contactos asociados (si existen)
          // Extrae el número de teléfono del nombre de la clave
          const phoneMatch = conversationKey.match(/conversation:(\+?[\d]+)/);
          if (phoneMatch) {
            const phone = phoneMatch[1];
            const contactKey = `contact:${phone}`;
            try {
              await upstashCall(['DEL', contactKey]);
              deletedContacts++;
            } catch (err) {
              // Ignorar si el contacto no existe
            }
          }
        }
      } catch (error) {
        const errorMsg = `Error procesando ${conversationKey}: ${String(error)}`;
        console.error(`[CLEANUP] ${errorMsg}`);
        errors.push(errorMsg);
      }
    }

    console.log('[CLEANUP] Limpieza completada');
    console.log(`[CLEANUP] - Conversaciones eliminadas: ${deletedConversations}`);
    console.log(`[CLEANUP] - Mensajes eliminados: ${deletedMessages}`);
    console.log(`[CLEANUP] - Contactos eliminados: ${deletedContacts}`);

    return NextResponse.json({
      message: 'Limpieza completada exitosamente',
      stats: {
        totalKeysAtStart: allKeys.length,
        totalConversations: conversationKeys.length,
        deletedConversations,
        deletedMessages,
        deletedContacts,
        errors: errors.length > 0 ? errors : undefined,
      },
    });

  } catch (error) {
    console.error('[CLEANUP] Error general:', error);
    return NextResponse.json(
      { 
        error: 'Error durante la limpieza',
        details: String(error),
      },
      { status: 500 }
    );
  }
}
