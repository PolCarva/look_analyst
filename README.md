# API de Análisis de Prendas de Ropa

Una API desarrollada en Node.js que utiliza Google Gemini para analizar imágenes de ropa y generar tags individuales optimizados para búsquedas en MercadoLibre.

## 🎯 Características

- ✅ Análisis de imágenes usando Google Gemini 2.5 Flash
- ✅ Generación de tags individuales (no descripciones largas)
- ✅ Optimizado para búsquedas en MercadoLibre
- ✅ Validación de tamaño de archivo configurable
- ✅ Soporte para múltiples formatos de imagen
- ✅ Manejo de errores robusto
- ✅ Limpieza automática de archivos temporales

## 🚀 Instalación

1. Clona el repositorio
2. Instala las dependencias:
   ```bash
   npm install
   ```

3. Configura las variables de entorno creando un archivo `.env`:
   ```env
   GEMINI_API_KEY=tu_api_key_aqui
   PORT=3000
   MAX_FILE_SIZE=8388608
   UPLOAD_DIR=uploads
   ```

4. Inicia el servidor:
   ```bash
   npm start
   ```

## 📋 Uso

### Endpoint Principal

**POST** `/analyze-clothing`

Analiza una imagen de ropa y devuelve arrays de tags individuales.

#### Parámetros

- `image`: Archivo de imagen (máximo 8MB por defecto)
- Formatos soportados: JPG, PNG, GIF, WebP

#### Ejemplo de uso con cURL

```bash
curl -X POST \
  http://lookanalyst.up.railway.app/analyze-clothing \
  -H 'Content-Type: multipart/form-data' \
  -F 'image=@ruta/a/tu/imagen.jpg'
```

#### Ejemplo de respuesta exitosa

```json
{
  "success": true,
  "clothingTags": [
    ["blazer", "gris", "estampado cuadros", "semi-largo", "tweed"],
    ["pantalón", "negro", "skinny", "denim", "ajustado"],
    ["camisa", "blanco", "algodón", "manga larga", "formal"]
  ],
  "count": 3,
  "modelUsed": "gemini-2.5-flash"
}
```

#### Ejemplo de respuesta cuando no se encuentran prendas

```json
{
  "success": true,
  "message": "No se encontraron prendas de ropa en la imagen",
  "clothingTags": [],
  "modelUsed": "gemini-2.5-flash"
}
```

## 🔧 Configuración

### Variables de Entorno

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `GEMINI_API_KEY` | API key de Google Gemini | Requerido |
| `PORT` | Puerto del servidor | 3000 |
| `MAX_FILE_SIZE` | Tamaño máximo de archivo en bytes | 8388608 (8MB) |
| `UPLOAD_DIR` | Directorio para archivos temporales | uploads |

### Formatos de Imagen Soportados

- ✅ JPG/JPEG
- ✅ PNG
- ✅ GIF
- ✅ WebP
- ❌ AVIF (no soportado por Gemini)

## 🏷️ Formato de Tags

Los tags se generan en arrays individuales para cada prenda, incluyendo:

- **Tipo de prenda**: blazer, pantalón, camisa, etc.
- **Color**: negro, blanco, azul, etc.
- **Estilo**: skinny, oversize, vintage, etc.
- **Material**: denim, algodón, cuero, etc.
- **Detalles**: estampado, rayas, bordados, etc.
- **Corte**: corto, largo, semi-largo, etc.

## 🔍 Uso con MercadoLibre

Los tags generados están optimizados para búsquedas en MercadoLibre:

```javascript
// Ejemplo de uso de los tags para búsqueda
const tags = ["blazer", "gris", "estampado cuadros", "semi-largo", "tweed"];

// Puedes usar cualquier combinación de tags
const searchQuery = tags.join(" "); // "blazer gris estampado cuadros semi-largo tweed"
// O usar tags específicos
const specificSearch = `${tags[0]} ${tags[1]}`; // "blazer gris"
```

## 🧪 Pruebas

### Interfaz Web
Abre `test.html` en tu navegador para una interfaz gráfica de prueba.

### Línea de Comandos
```bash
node test-api.js ruta/a/tu/imagen.jpg
```

## 📁 Estructura del Proyecto

```
cloth_api/
├── server.js          # Servidor principal
├── package.json       # Dependencias y scripts
├── test.html         # Interfaz web de prueba
├── test-api.js       # Script de prueba CLI
├── uploads/          # Directorio temporal (se crea automáticamente)
├── .env              # Variables de entorno (crear manualmente)
└── README.md         # Este archivo
```

## ⚠️ Limitaciones

- Tamaño máximo de archivo: Configurable (8MB por defecto)
- Solo acepta archivos de imagen (no AVIF)
- Requiere conexión a internet para usar Gemini API
- Los archivos se procesan temporalmente y se eliminan después del análisis

## 🛠️ Dependencias

- **express**: Framework web para Node.js
- **multer**: Middleware para manejo de archivos multipart/form-data
- **@google/generative-ai**: SDK oficial de Google Gemini
- **cors**: Middleware para habilitar CORS
- **dotenv**: Carga variables de entorno

## 📝 Licencia

MIT