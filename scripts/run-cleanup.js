// Script para ejecutar la limpieza de conversaciones antiguas en Redis/Upstash
// Este script hace una llamada POST a la API de limpieza

const API_URL = 'http://localhost:3000/api/admin/cleanup-redis';

async function runCleanup() {
  console.log('Iniciando limpieza de conversaciones mayores a 30 días...\n');
  
  try {
    console.log(`[v0] Llamando a API: ${API_URL}`);
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const result = await response.json();
    
    console.log('\n✅ Limpieza completada exitosamente\n');
    console.log('Estadísticas:');
    console.log(`  - Claves totales al inicio: ${result.stats.totalKeysAtStart}`);
    console.log(`  - Conversaciones totales: ${result.stats.totalConversations}`);
    console.log(`  - Conversaciones eliminadas: ${result.stats.deletedConversations}`);
    console.log(`  - Mensajes eliminados: ${result.stats.deletedMessages}`);
    console.log(`  - Contactos eliminados: ${result.stats.deletedContacts}`);
    
    if (result.stats.errors && result.stats.errors.length > 0) {
      console.log('\n⚠️ Errores durante la limpieza:');
      result.stats.errors.forEach((error) => console.log(`  - ${error}`));
    }
    
    console.log('\nLimpieza finalizada.');
    
  } catch (error) {
    console.error('❌ Error durante la limpieza:');
    console.error(error);
    process.exit(1);
  }
}

runCleanup();
