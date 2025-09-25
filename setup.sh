#!/bin/bash

echo "🚀 Configurando API de Análisis de Prendas de Ropa"
echo "=================================================="

# Verificar si Node.js está instalado
if ! command -v node &> /dev/null; then
    echo "❌ Node.js no está instalado. Por favor instala Node.js primero."
    echo "   Visita: https://nodejs.org/"
    exit 1
fi

# Verificar versión de Node.js
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 14 ]; then
    echo "❌ Se requiere Node.js versión 14 o superior. Versión actual: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) detectado"

# Instalar dependencias
echo "📦 Instalando dependencias..."
npm install

if [ $? -eq 0 ]; then
    echo "✅ Dependencias instaladas correctamente"
else
    echo "❌ Error al instalar dependencias"
    exit 1
fi

# Crear directorio de uploads
echo "📁 Creando directorio de uploads..."
mkdir -p uploads

echo ""
echo "🎉 ¡Configuración completada!"
echo ""
echo "📋 Para usar la API:"
echo "   1. Inicia el servidor: npm start"
echo "   2. El servidor estará disponible en: http://localhost:3000"
echo "   3. Usa el endpoint: POST http://localhost:3000/analyze-clothing"
echo ""
echo "🧪 Para probar la API:"
echo "   node test-api.js <ruta-a-imagen>"
echo ""
echo "📚 Para más información, consulta el README.md"
