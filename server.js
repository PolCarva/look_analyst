const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

// Cargar variables de entorno
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 8 * 1024 * 1024; // 8MB por defecto
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const FRONTEND_URL = process.env.FRONTEND_URL || `https://lookanalyst.up.railway.app`;

// Configurar CORS
app.use(cors());
app.use(express.json());

// Middleware para manejar el idioma
app.use((req, res, next) => {
  const supportedLangs = ['es', 'en', 'pt', 'fr', 'it', 'de'];
  const langParam = req.query.lang?.toLowerCase();

  req.lang = supportedLangs.includes(langParam) ? langParam : 'es';
  next();
});

// Configurar Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Configurar multer para subir archivos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR);
    }
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_FILE_SIZE
  },
  fileFilter: function (req, file, cb) {
    // Verificar que sea una imagen y que no sea AVIF (no soportado por Gemini)
    if (file.mimetype.startsWith('image/') && file.mimetype !== 'image/avif') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos de imagen (JPG, PNG, GIF, WebP)'), false);
    }
  }
});

// Función para descargar imagen desde URL con técnicas anti-bot
async function downloadImageFromUrl(url) {
  try {
    // Headers más realistas para evitar bloqueos
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'image',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'cross-site',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    };

    // Si es Pinterest, usar técnicas especiales
    if (url.includes('pinimg.com') || url.includes('pinterest.com')) {
      headers['Referer'] = 'https://www.pinterest.com/';
      headers['Origin'] = 'https://www.pinterest.com';
    }

    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 45000, // 45 segundos timeout
      headers: headers,
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 400; // Aceptar redirecciones
      }
    });

    // Verificar que sea una imagen
    const contentType = response.headers['content-type'];
    if (!contentType || !contentType.startsWith('image/')) {
      throw new Error('La URL no apunta a una imagen válida');
    }

    // Crear archivo temporal
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const tempPath = path.join(UPLOAD_DIR, `url-image-${uniqueSuffix}.jpg`);
    
    // Asegurar que el directorio existe
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR);
    }

    // Guardar la imagen
    const writer = fs.createWriteStream(tempPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        resolve({
          path: tempPath,
          mimeType: contentType
        });
      });
      writer.on('error', reject);
    });

  } catch (error) {
    // Si falla con Pinterest, intentar con proxy
    if ((url.includes('pinimg.com') || url.includes('pinterest.com')) && error.response?.status === 403) {
      try {
        return await downloadWithProxy(url);
      } catch (proxyError) {
        throw new Error(`Error al descargar la imagen de Pinterest: ${error.message}. Intenta con una URL directa de imagen.`);
      }
    }
    throw new Error(`Error al descargar la imagen: ${error.message}`);
  }
}

// Función alternativa usando proxy para Pinterest
async function downloadWithProxy(url) {
  try {
    const proxyUrl = `https://dl.klickpin.com?url=${encodeURIComponent(url)}`;
    
    const response = await axios({
      method: 'GET',
      url: proxyUrl,
      responseType: 'stream',
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const tempPath = path.join(UPLOAD_DIR, `proxy-image-${uniqueSuffix}.jpg`);
    
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR);
    }

    const writer = fs.createWriteStream(tempPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        resolve({
          path: tempPath,
          mimeType: 'image/jpeg'
        });
      });
      writer.on('error', reject);
    });

  } catch (error) {
    throw new Error(`Error con proxy: ${error.message}`);
  }
}

// Función para convertir imagen a base64
function fileToGenerativePart(filePath, mimeType) {
  return {
    inlineData: {
      data: fs.readFileSync(filePath).toString('base64'),
      mimeType
    },
  };
}

// Endpoint específico para Pinterest
app.post('/download', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL de Pinterest requerida'
      });
    }

    // Validar que sea una URL de Pinterest
    const pinterestRegex = /^https:\/\/((\w+\.)?pinterest\.(com|co\.uk|de|fr|it|es|nl|se|ch|co\.in|br|au|at|cl|jp|ru|ie|ca|mx|nz|pt|ph)\/.+|pin\.it\/.+)/;
    if (!pinterestRegex.test(url)) {
      return res.status(400).json({
        success: false,
        error: 'URL inválida. Debe ser una URL de Pinterest válida.'
      });
    }

    // Extraer la imagen de Pinterest
    const imageData = await extractPinterestImage(url);
    
    if (!imageData) {
      return res.status(404).json({
        success: false,
        error: 'No se pudo extraer la imagen de Pinterest'
      });
    }

    // Analizar la imagen con Gemini
    const analysisResult = await analyzeImageWithGemini(imageData.path, imageData.mimeType);
    
        // Limpiar archivo temporal
        fs.unlinkSync(imageData.path);

    res.json({
      success: true,
      ...analysisResult,
      sourceUrl: url
    });

  } catch (error) {
    console.error('Error en endpoint Pinterest:', error);
        // Limpiar archivo temporal en caso de error
        if (imageData && fs.existsSync(imageData.path)) {
          fs.unlinkSync(imageData.path);
        }
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      details: error.message
    });
  }
});

// Función para extraer imagen de Pinterest
async function extractPinterestImage(pinterestUrl) {
  try {
    // Headers específicos para Pinterest (como KlickPin)
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"'
    };

    // Primero obtener la página de Pinterest
    const pageResponse = await axios({
      method: 'GET',
      url: pinterestUrl,
      headers: headers,
      timeout: 30000,
      maxRedirects: 5
    });

    const html = pageResponse.data;
    
    // Buscar la URL de la imagen principal del pin con múltiples estrategias
    let imageUrl = null;
    
    // Estrategia 1: Buscar en meta tags (más confiable)
    const metaImageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
    if (metaImageMatch) {
      imageUrl = metaImageMatch[1];
      console.log('Imagen encontrada en meta og:image:', imageUrl);
    }
    
    // Estrategia 2: Buscar en JSON-LD structured data
    if (!imageUrl) {
      const jsonLdMatch = html.match(/"image":\s*"([^"]*i\.pinimg\.com[^"]*\.(jpg|jpeg|png|webp|gif))"/i);
      if (jsonLdMatch) {
        imageUrl = jsonLdMatch[1];
        console.log('Imagen encontrada en JSON-LD:', imageUrl);
      }
    }
    
    // Estrategia 3: Buscar imágenes con clases específicas de Pinterest
    if (!imageUrl) {
      const classMatch = html.match(/<img[^>]*class="[^"]*(?:PcK|QLY|Rym|XiG|ojN|p6V)[^"]*"[^>]*src="([^"]*i\.pinimg\.com[^"]*\.(jpg|jpeg|png|webp|gif))"/i);
      if (classMatch) {
        imageUrl = classMatch[1];
        console.log('Imagen encontrada por clases Pinterest:', imageUrl);
      }
    }
    
    // Estrategia 4: Buscar imágenes con data-testid específicos
    if (!imageUrl) {
      const testIdMatch = html.match(/<img[^>]*data-testid="[^"]*pin-image[^"]*"[^>]*src="([^"]*i\.pinimg\.com[^"]*\.(jpg|jpeg|png|webp|gif))"/i);
      if (testIdMatch) {
        imageUrl = testIdMatch[1];
        console.log('Imagen encontrada por data-testid:', imageUrl);
      }
    }
    
    // Estrategia 5: Buscar la imagen más grande disponible (por tamaño en URL)
    if (!imageUrl) {
      const allImages = html.match(/https:\/\/i\.pinimg\.com\/[^"'\s]+\.(jpg|jpeg|png|webp|gif)/gi);
      if (allImages && allImages.length > 0) {
        // Ordenar por tamaño (736x, 564x, etc.) y tomar la más grande
        const sortedImages = allImages.sort((a, b) => {
          const sizeA = a.match(/\/(\d+)x/);
          const sizeB = b.match(/\/(\d+)x/);
          return (sizeB ? parseInt(sizeB[1]) : 0) - (sizeA ? parseInt(sizeA[1]) : 0);
        });
        imageUrl = sortedImages[0];
        console.log('Imagen encontrada por tamaño (más grande):', imageUrl);
      }
    }
    
    // Estrategia 6: Buscar en atributos data-src (lazy loading)
    if (!imageUrl) {
      const dataSrcMatch = html.match(/data-src="(https:\/\/i\.pinimg\.com\/[^"]+\.(jpg|jpeg|png|webp|gif))"/i);
      if (dataSrcMatch) {
        imageUrl = dataSrcMatch[1];
        console.log('Imagen encontrada en data-src:', imageUrl);
      }
    }
    
    if (!imageUrl) {
      console.log('HTML recibido (primeros 2000 chars):', html.substring(0, 2000)); // Debug
      throw new Error('No se encontró URL de imagen principal en la página de Pinterest');
    }
    
    console.log('URL de imagen principal encontrada:', imageUrl); // Debug
    
    // Descargar la imagen
    const imageResponse = await axios({
      method: 'GET',
      url: imageUrl,
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.pinterest.com/',
        'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });

    // Crear archivo temporal
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const tempPath = path.join(UPLOAD_DIR, `pinterest-${uniqueSuffix}.jpg`);
    
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR);
    }

    const writer = fs.createWriteStream(tempPath);
    imageResponse.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        resolve({
          path: tempPath,
          mimeType: 'image/jpeg',
          originalUrl: imageUrl
        });
      });
      writer.on('error', reject);
    });

  } catch (error) {
    throw new Error(`Error extrayendo imagen de Pinterest: ${error.message}`);
  }
}

// Función para analizar imagen con Gemini
async function analyzeImageWithGemini(imagePath, mimeType) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
    Analiza esta imagen y identifica todas las prendas de ropa que veas. 
    Para cada prenda encontrada, genera tags individuales separados por comas que incluyan:
    - Tipo de prenda (pantalón, remera, campera, blazer, etc.)
    - Color principal (negro, blanco, azul, etc.)
    - Estilo (baggy, oversize, vintage, clásico, etc.)
    - Material cuando sea evidente (denim, cuero, algodón, etc.)
    - Detalles especiales (estampado, rayas, bordados, etc.)
    - Longitud/corte (corto, largo, semi-largo, etc.)

    Responde ÚNICAMENTE con una lista numerada de arrays de tags, uno por línea, en el siguiente formato:
    1: [tag1, tag2, tag3, tag4, tag5]
    2: [tag1, tag2, tag3, tag4, tag5]
    etc.

    Ejemplo de respuesta:
    1: [blazer, gris, estampado cuadros, semi-largo, tweed]
    2: [pantalón, negro, skinny, denim, ajustado]

    Si no encuentras prendas de ropa, responde: "No se encontraron prendas de ropa en la imagen."
    IMPORTANTE: responde TODO en el idioma "${req.lang}".
    `;

    const imagePart = fileToGenerativePart(imagePath, mimeType);
    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();
    const workingModel = "gemini-2.5-flash";

    // Procesar la respuesta para extraer los arrays de tags
    const lines = text.split('\n').filter(line => line.trim());
    const clothingTags = [];

    lines.forEach(line => {
      const match = line.match(/^\d+:\s*\[(.+)\]$/);
      if (match) {
        const tags = match[1].split(',').map(tag => tag.trim());
        clothingTags.push(tags);
      }
    });

    if (clothingTags.length === 0) {
      return {
        message: "No se encontraron prendas de ropa en la imagen",
        clothingTags: [],
        count: 0,
        modelUsed: workingModel,
        rawResponse: text
      };
    }

    return {
      clothingTags: clothingTags,
      count: clothingTags.length,
      modelUsed: workingModel,
      rawResponse: text
    };

  } catch (error) {
    throw new Error(`Error analizando imagen: ${error.message}`);
  }
}

// Endpoint principal para análisis de prendas
app.post('/analyze-clothing', upload.single('image'), async (req, res) => {
  try {
    let imagePath, mimeType, isFromUrl = false;

    // Verificar si se envió una URL en lugar de un archivo
    if (!req.file && req.body.imageUrl) {
      try {
        const downloadedImage = await downloadImageFromUrl(req.body.imageUrl);
        imagePath = downloadedImage.path;
        mimeType = downloadedImage.mimeType;
        isFromUrl = true;
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: error.message
        });
      }
    } else if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Debe enviar una imagen (archivo o URL).'
      });
    } else {
      imagePath = req.file.path;
      mimeType = req.file.mimetype;
    }

    // Usar el modelo más reciente disponible
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
    Analiza esta imagen y identifica todas las prendas de ropa que veas. 
    Para cada prenda encontrada, genera tags individuales separados por comas que incluyan:
    - Tipo de prenda (pantalón, remera, campera, blazer, etc.)
    - Color principal (negro, blanco, azul, etc.)
    - Estilo (baggy, oversize, vintage, clásico, etc.)
    - Material cuando sea evidente (denim, cuero, algodón, etc.)
    - Detalles especiales (estampado, rayas, bordados, etc.)
    - Longitud/corte (corto, largo, semi-largo, etc.)

    Responde ÚNICAMENTE con una lista numerada de arrays de tags, uno por línea, en el siguiente formato:
    1: [tag1, tag2, tag3, tag4, tag5]
    2: [tag1, tag2, tag3, tag4, tag5]
    etc.

    Ejemplo de respuesta:
    1: [blazer, gris, estampado cuadros, semi-largo, tweed]
    2: [pantalón, negro, skinny, denim, ajustado]

    Si no encuentras prendas de ropa, responde: "No se encontraron prendas de ropa en la imagen."
    IMPORTANTE: responde TODO en el idioma "${req.lang}".
    `;

    const imagePart = fileToGenerativePart(imagePath, mimeType);

    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();
    const workingModel = "gemini-2.5-flash";

    // Limpiar archivo temporal
    fs.unlinkSync(imagePath);

    // Procesar la respuesta para extraer los arrays de tags
    const lines = text.split('\n').filter(line => line.trim());
    const clothingTags = [];

    lines.forEach(line => {
      const match = line.match(/^\d+:\s*\[(.+)\]$/);
      if (match) {
        // Dividir por comas y limpiar espacios
        const tags = match[1].split(',').map(tag => tag.trim());
        clothingTags.push(tags);
      }
    });

    // Si no se encontraron prendas
    if (clothingTags.length === 0) {
      return res.json({
        success: true,
        message: "No se encontraron prendas de ropa en la imagen",
        clothingTags: [],
        modelUsed: workingModel,
        rawResponse: text
      });
    }

    res.json({
      success: true,
      clothingTags: clothingTags,
      count: clothingTags.length,
      modelUsed: workingModel,
      rawResponse: text
    });

  } catch (error) {
    console.error('Error al analizar la imagen:', error);
    
    // Limpiar archivo temporal en caso de error
    if (imagePath && fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

    res.status(500).json({
      success: false,
      error: 'Error interno del servidor al analizar la imagen',
      details: error.message
    });
  }
});

// Endpoint principal - Información de la API
app.get('/', (req, res) => {
  res.json({
    message: 'API de Análisis de Prendas de Ropa',
    version: '1.0.0',
    description: 'Analiza imágenes de ropa y genera tags individuales para búsquedas en MercadoLibre',
    endpoints: {
      'GET /docs': 'Documentación completa de la API',
      'GET /test': 'Frontend de prueba interactivo',
      'POST /analyze-clothing': 'Analiza imágenes de ropa',
      'POST /download': 'Analiza imágenes de Pinterest'
    },
    documentation: `${FRONTEND_URL}/docs`,
    frontend: `${FRONTEND_URL}/test`
  });
});

    // Endpoint para servir el frontend de prueba
    app.get('/test', (req, res) => {
      res.sendFile(path.join(__dirname, 'test.html'));
    });

    // Endpoint de documentación HTML
    app.get('/docs', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API de Análisis de Prendas - Documentación</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f8f9fa;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .content {
            background: white;
            padding: 2rem;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        
        h1 {
            color: #2c3e50;
            border-bottom: 3px solid #3498db;
            padding-bottom: 0.5rem;
            margin-bottom: 1.5rem;
            font-size: 2rem;
        }
        
        h2 {
            color: #34495e;
            border-bottom: 2px solid #ecf0f1;
            padding-bottom: 0.3rem;
            margin: 2rem 0 1rem 0;
            font-size: 1.5rem;
        }
        
        h3 {
            color: #34495e;
            margin: 1.5rem 0 1rem 0;
            font-size: 1.3rem;
        }
        
        p {
            margin-bottom: 1rem;
            text-align: justify;
        }
        
        ul {
            margin: 1rem 0 1rem 2rem;
        }
        
        li {
            margin-bottom: 0.5rem;
        }
        
        code {
            background-color: #f1f3f4;
            border: 1px solid #dadce0;
            border-radius: 4px;
            padding: 0.2rem 0.4rem;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.9rem;
            color: #d73a49;
        }
        
        pre {
            background-color: #1e1e1e;
            color: #d4d4d4;
            padding: 1.5rem;
            border-radius: 8px;
            overflow-x: auto;
            margin: 1rem 0;
            border-left: 4px solid #007acc;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        
        pre code {
            background: none;
            border: none;
            padding: 0;
            color: inherit;
            font-size: 0.9rem;
        }
        
        .method {
            background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
            color: white;
            padding: 0.3rem 0.8rem;
            border-radius: 6px;
            font-weight: 600;
            display: inline-block;
            margin: 0.5rem 0;
        }
        
        .url {
            background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
            color: white;
            padding: 0.3rem 0.8rem;
            border-radius: 6px;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.9rem;
            display: inline-block;
            margin: 0.5rem 0;
        }
        
        .error {
            background: #fdf2f2;
            border-left: 4px solid #e74c3c;
            padding: 1rem;
            margin: 1rem 0;
            border-radius: 0 8px 8px 0;
        }
        
        .success {
            background: #f0f9ff;
            border-left: 4px solid #3498db;
            padding: 1rem;
            margin: 1rem 0;
            border-radius: 0 8px 8px 0;
        }
        
        .footer {
            text-align: center;
            margin-top: 3rem;
            padding: 2rem;
            background-color: #1e1e1e;
            color: white;
            border-radius: 10px;
        }
        
        .footer a {
            color: #3498db;
            text-decoration: none;
        }
        
        .footer a:hover {
            text-decoration: underline;
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 10px;
            }
            
            .content {
                padding: 1rem;
            }
            
            h1 {
                font-size: 1.8rem;
            }
            
            pre {
                padding: 1rem;
                font-size: 0.8rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="content">
            <h1>API de Análisis de Prendas de Ropa</h1>
            <p>Analiza imágenes de ropa y genera tags individuales para cada prenda encontrada.</p>
            <p><strong>Versión:</strong> 1.0.0</p>
    
    <h2>Endpoint Principal</h2>
    <p><span class="method">POST</span> <span class="url">/analyze-clothing</span></p>
    <p>Analiza una imagen de ropa y devuelve arrays de tags individuales para cada prenda.</p>
    
    <h3>Parámetros</h3>
    <ul>
        <li><strong>image:</strong> Archivo de imagen (máximo <strong>${Math.round(MAX_FILE_SIZE / (1024 * 1024))}MB</strong>)</li>
        <li><strong>imageUrl:</strong> URL de imagen (alternativa al archivo)</li>
        <li><strong>Formatos soportados:</strong> JPG, PNG, GIF, WebP</li>
        <li><strong>No soportado:</strong> AVIF</li>
        <li><strong>Nota:</strong> Para URLs de Pinterest, usar el endpoint específico <code>/download</code></li>
    </ul>
    
    <h3>Ejemplo con cURL - Archivo</h3>
    <pre>curl -X POST \\
  https://lookanalyst.up.railway.app/analyze-clothing \\
  -H 'Content-Type: multipart/form-data' \\
  -F 'image=@ruta/a/tu/imagen.jpg'</pre>
    
    <h3>Ejemplo con cURL - URL</h3>
    <pre>curl -X POST \\
  https://lookanalyst.up.railway.app/analyze-clothing \\
  -H 'Content-Type: application/json' \\
  -d '{"imageUrl": "https://example.com/imagen.jpg"}'</pre>
    
    <h3>Ejemplo con JavaScript (Fetch) - Archivo</h3>
    <pre>const formData = new FormData();
formData.append('image', fileInput.files[0]);

const response = await fetch('https://lookanalyst.up.railway.app/analyze-clothing', {
  method: 'POST',
  body: formData
});

const data = await response.json();
console.log(data);</pre>
    
    <h3>Ejemplo con JavaScript (Fetch) - URL</h3>
    <pre>const response = await fetch('https://lookanalyst.up.railway.app/analyze-clothing', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    imageUrl: 'https://example.com/imagen.jpg'
  })
});

const data = await response.json();
console.log(data);</pre>
    
    <h2>Endpoint Específico para Pinterest</h2>
    <p><span class="method" style="background: linear-gradient(135deg, #e60023 0%, #ad001a 100%);">POST</span> <span class="url">/download</span></p>
    <p>Analiza una imagen de Pinterest extrayéndola directamente de la URL de la página usando técnicas avanzadas de scraping.</p>
    
    <h3>Características</h3>
    <ul>
        <li><strong>Scraping inteligente:</strong> Utiliza 6 estrategias diferentes para encontrar la imagen principal</li>
        <li><strong>Meta tags:</strong> Busca en og:image para máxima confiabilidad</li>
        <li><strong>JSON-LD:</strong> Extrae datos estructurados de la página</li>
        <li><strong>Clases específicas:</strong> Identifica elementos con clases de Pinterest</li>
        <li><strong>Data-testid:</strong> Busca identificadores de prueba específicos</li>
        <li><strong>Imagen más grande:</strong> Selecciona automáticamente la imagen de mayor resolución</li>
        <li><strong>Lazy loading:</strong> Maneja imágenes con carga diferida</li>
    </ul>
    
    <h3>Parámetros</h3>
    <ul>
        <li><strong>url:</strong> URL completa del pin de Pinterest (soporta múltiples dominios)</li>
    </ul>
    
    <h3>URLs soportadas</h3>
    <ul>
        <li><code>https://www.pinterest.com/pin/123456789/</code></li>
        <li><code>https://pin.it/abc123</code></li>
        <li><code>https://pinterest.com/pin/123456789/</code></li>
        <li><code>https://pinterest.co.uk/pin/123456789/</code></li>
        <li>Y otros dominios regionales de Pinterest</li>
    </ul>
    
    <h3>Ejemplo con cURL - Pinterest</h3>
    <pre>curl -X POST \\
  https://lookanalyst.up.railway.app/download \\
  -H 'Content-Type: application/json' \\
  -d '{"url": "https://www.pinterest.com/pin/5348093303823893/"}'</pre>
    
    <h3>Ejemplo con JavaScript (Fetch) - Pinterest</h3>
    <pre>const response = await fetch('https://lookanalyst.up.railway.app/download', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    url: 'https://www.pinterest.com/pin/5348093303823893/'
  })
});

const data = await response.json();
console.log(data);</pre>
    
    <h2>Respuestas</h2>
    
    <h3>Éxito - Con prendas encontradas</h3>
    <div class="success">
        <strong>Status:</strong> 200 OK<br>
        <strong>Content-Type:</strong> application/json
    </div>
    <pre>{
  "success": true,
  "clothingTags": [
    ["blazer", "gris", "estampado cuadros", "semi-largo", "tweed"],
    ["pantalón", "negro", "skinny", "denim", "ajustado"],
    ["camisa", "blanco", "algodón", "manga larga", "formal"]
  ],
  "count": 3,
  "modelUsed": "gemini-2.5-flash"
}</pre>
    
    <h3>Éxito - Sin prendas encontradas</h3>
    <div class="success">
        <strong>Status:</strong> 200 OK<br>
        <strong>Content-Type:</strong> application/json
    </div>
    <pre>{
  "success": true,
  "message": "No se encontraron prendas de ropa en la imagen",
  "clothingTags": [],
  "modelUsed": "gemini-2.5-flash"
}</pre>
    
    <h2>Errores</h2>
    
    <h3>Archivo demasiado grande</h3>
    <div class="error">
        <strong>Status:</strong> 400 Bad Request<br>
        <strong>Content-Type:</strong> application/json
    </div>
    <pre>{
  "success": false,
  "error": "El archivo es demasiado grande. El tamaño máximo permitido es ${Math.round(MAX_FILE_SIZE / (1024 * 1024))}MB."
}</pre>
    
    <h3>Formato de archivo no soportado</h3>
    <div class="error">
        <strong>Status:</strong> 400 Bad Request<br>
        <strong>Content-Type:</strong> application/json
    </div>
    <pre>{
  "success": false,
  "error": "Solo se permiten archivos de imagen (JPG, PNG, GIF, WebP)"
}</pre>
    
    <h3>URL de imagen inválida</h3>
    <div class="error">
        <strong>Status:</strong> 400 Bad Request<br>
        <strong>Content-Type:</strong> application/json
    </div>
    <pre>{
  "success": false,
  "error": "Error al descargar la imagen: [detalles del error]"
}</pre>
    
    <h3>URL de Pinterest inválida</h3>
    <div class="error">
        <strong>Status:</strong> 400 Bad Request<br>
        <strong>Content-Type:</strong> application/json
    </div>
    <pre>{
  "success": false,
  "error": "URL inválida. Debe ser una URL de Pinterest válida."
}</pre>
    
    <h3>No se pudo extraer imagen de Pinterest</h3>
    <div class="error">
        <strong>Status:</strong> 404 Not Found<br>
        <strong>Content-Type:</strong> application/json
    </div>
    <pre>{
  "success": false,
  "error": "No se pudo extraer la imagen de Pinterest"
}</pre>
    
    <h3>Error de scraping de Pinterest</h3>
    <div class="error">
        <strong>Status:</strong> 500 Internal Server Error<br>
        <strong>Content-Type:</strong> application/json
    </div>
    <pre>{
  "success": false,
  "error": "Error interno del servidor",
  "details": "Error extrayendo imagen de Pinterest: [detalles específicos]"
}</pre>
    
    <h3>Error interno del servidor</h3>
    <div class="error">
        <strong>Status:</strong> 500 Internal Server Error<br>
        <strong>Content-Type:</strong> application/json
    </div>
    <pre>{
  "success": false,
  "error": "Error interno del servidor",
  "details": "Descripción del error específico"
}</pre>
    
    <h2>Formato de Tags</h2>
    <p>Cada prenda se analiza y genera un array con los siguientes tipos de tags:</p>
    <ul>
        <li><strong>Tipo de prenda:</strong> blazer, pantalón, camisa, etc.</li>
        <li><strong>Color:</strong> negro, blanco, azul, gris, etc.</li>
        <li><strong>Estilo:</strong> skinny, oversize, vintage, clásico, etc.</li>
        <li><strong>Material:</strong> denim, algodón, cuero, lana, etc.</li>
        <li><strong>Detalles:</strong> estampado, rayas, bordados, etc.</li>
        <li><strong>Corte:</strong> corto, largo, semi-largo, ajustado, etc.</li>
    </ul>
    
    <h2>Ejemplo de Uso</h2>
    <p>Los tags generados pueden usarse para búsquedas y filtros:</p>
    <pre>// Ejemplo de uso de los tags
const tags = ["blazer", "gris", "estampado cuadros", "semi-largo", "tweed"];

// Puedes usar cualquier combinación de tags
const searchQuery = tags.join(" "); // "blazer gris estampado cuadros semi-largo tweed"

// O usar tags específicos
const specificSearch = \`\${tags[0]} \${tags[1]}\`; // "blazer gris"</pre>
    
    <h2>Frontend de Prueba</h2>
    <p>Accede al frontend interactivo en <code>GET /test</code> para probar ambos endpoints:</p>
    <p><strong>URL:</strong> <a href="${FRONTEND_URL}test" target="_blank">${FRONTEND_URL}test</a></p>
    <ul>
        <li><strong>Subida de archivos:</strong> Drag & drop o selección manual</li>
        <li><strong>URLs generales:</strong> Análisis directo de URLs de imagen</li>
        <li><strong>Pinterest específico:</strong> Formulario dedicado con validación</li>
        <li><strong>Botón de pegar:</strong> Pegado automático desde portapapeles</li>
        <li><strong>Barra de progreso:</strong> Indicador visual para Pinterest</li>
        <li><strong>Resultados visuales:</strong> Tags organizados por prenda</li>
    </ul>
    
    <h2>Características Técnicas</h2>
    <ul>
        <li><strong>Modelo:</strong> Gemini 2.5 Flash para análisis rápido y preciso</li>
        <li><strong>Scraping:</strong> 6 estrategias de extracción para máxima compatibilidad</li>
        <li><strong>Limpieza automática:</strong> Archivos temporales eliminados después del uso</li>
        <li><strong>CORS habilitado:</strong> Compatible con frontends en diferentes dominios</li>
        <li><strong>Validación robusta:</strong> Verificación de formatos y URLs</li>
        <li><strong>Manejo de errores:</strong> Respuestas detalladas para debugging</li>
    </ul>
    
        </div>
        
        <div class="footer">
            <p>🧥 <strong>API de Análisis de Prendas</strong> - Desarrollada con Node.js y Google Gemini AI</p>
            <p>Base URL: <code>${FRONTEND_URL}</code></p>
            <p><a href="/">← Volver al endpoint principal</a> | <a href="/test">🧪 Frontend de prueba</a></p>
        </div>
    </div>
</body>
</html>
  `;
  
  res.send(html);
});

// Middleware para manejar errores de multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      const maxSizeMB = Math.round(MAX_FILE_SIZE / (1024 * 1024));
      return res.status(400).json({
        success: false,
        error: `El archivo es demasiado grande. El tamaño máximo permitido es ${maxSizeMB}MB.`
      });
    }
  }
  
  if (error.message.includes('Solo se permiten archivos de imagen')) {
    return res.status(400).json({
      success: false,
      error: 'Solo se permiten archivos de imagen (JPG, PNG, GIF, WebP)'
    });
  }

  res.status(500).json({
    success: false,
    error: 'Error interno del servidor',
    details: error.message
  });
});



// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en https://lookanalyst.up.railway.app`);
  console.log(`📸 Endpoint: POST https://lookanalyst.up.railway.app/analyze-clothing`);
});

module.exports = app;
