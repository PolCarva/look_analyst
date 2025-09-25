const fs = require('fs');
const FormData = require('form-data');
const fetch = require('node-fetch');

// Función para probar la API
async function testAPI(imagePath) {
  try {
    // Verificar que el archivo existe
    if (!fs.existsSync(imagePath)) {
      console.error('❌ El archivo de imagen no existe:', imagePath);
      return;
    }

    // Crear FormData
    const form = new FormData();
    form.append('image', fs.createReadStream(imagePath));

    console.log('🚀 Enviando imagen a la API...');
    console.log('📁 Archivo:', imagePath);
    console.log('📏 Tamaño:', (fs.statSync(imagePath).size / 1024 / 1024).toFixed(2) + ' MB');

    // Enviar request
    const response = await fetch('http://localhost:3000/analyze-clothing', {
      method: 'POST',
      body: form,
      headers: form.getHeaders()
    });

    const result = await response.json();

    if (result.success) {
      console.log('\n✅ Análisis exitoso!');
      console.log('👕 Prendas encontradas:', result.count);
      console.log('\n🏷️  Tags generados:');
      
      result.clothingTags.forEach((tag, index) => {
        console.log(`${index + 1}. ${tag}`);
      });

      if (result.message) {
        console.log('\n📝 Mensaje:', result.message);
      }
    } else {
      console.log('\n❌ Error en el análisis:');
      console.log('Error:', result.error);
      if (result.details) {
        console.log('Detalles:', result.details);
      }
    }

  } catch (error) {
    console.error('\n💥 Error de conexión:', error.message);
    console.log('💡 Asegúrate de que el servidor esté ejecutándose en http://localhost:3000');
  }
}

// Función para probar el endpoint de información
async function testInfoEndpoint() {
  try {
    console.log('🔍 Probando endpoint de información...');
    const response = await fetch('http://localhost:3000/');
    const result = await response.json();
    
    console.log('\n📋 Información de la API:');
    console.log('Nombre:', result.message);
    console.log('Versión:', result.version);
    console.log('Endpoints disponibles:');
    Object.entries(result.endpoints).forEach(([endpoint, description]) => {
      console.log(`  ${endpoint}: ${description}`);
    });
  } catch (error) {
    console.error('❌ Error al obtener información:', error.message);
  }
}

// Función principal
async function main() {
  console.log('🧪 Iniciando pruebas de la API de Análisis de Prendas\n');

  // Probar endpoint de información
  await testInfoEndpoint();
  
  console.log('\n' + '='.repeat(50) + '\n');

  // Verificar argumentos de línea de comandos
  const imagePath = process.argv[2];
  
  if (!imagePath) {
    console.log('💡 Uso: node test-api.js <ruta-a-imagen>');
    console.log('📝 Ejemplo: node test-api.js ./mi-imagen.jpg');
    console.log('\n⚠️  Asegúrate de tener una imagen de ropa para probar');
    return;
  }

  // Probar análisis de imagen
  await testAPI(imagePath);
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  main();
}

module.exports = { testAPI, testInfoEndpoint };
