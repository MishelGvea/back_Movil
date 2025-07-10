const fs = require('fs');
const path = require('path');

// Cargar frases desde el archivo JSON
const cargarFrases = () => {
  try {
    const frasesPath = path.join(__dirname, '../db/frases.json');
    const frasesData = fs.readFileSync(frasesPath, 'utf8');
    const { frases } = JSON.parse(frasesData);
    return frases;
  } catch (error) {
    console.error('❌ Error al cargar frases:', error);
    // Fallback en caso de error
    return [
      {
        texto: "La educación es el arma más poderosa para cambiar el mundo",
        autor: "Nelson Mandela"
      }
    ];
  }
};

// Función para generar seed basado en fecha (mismo día = misma frase)
const obtenerSeedDelDia = (usuario = '') => {
  const fecha = new Date();
  const año = fecha.getFullYear();
  const mes = fecha.getMonth();
  const dia = fecha.getDate();
  
  // Crear un seed único por día + usuario (opcional)
  return (año * 365 + mes * 31 + dia + usuario.length);
};

// Función de random con seed (determinístico)
const randomConSeed = (seed, max) => {
  const x = Math.sin(seed) * 10000;
  return Math.floor((x - Math.floor(x)) * max);
};

// 🎯 ENDPOINT PRINCIPAL: Obtener frase motivacional
const obtenerFraseMotivacional = async (req, res) => {
  try {
    console.log('🎯 Solicitando frase motivacional...');
    
    // Obtener parámetros opcionales
    const { usuario, tipo } = req.query;
    
    // Cargar todas las frases
    const frases = cargarFrases();
    
    if (!frases || frases.length === 0) {
      return res.status(500).json({ 
        error: 'No se pudieron cargar las frases motivacionales' 
      });
    }

    let fraseSeleccionada;

    if (tipo === 'random') {
      // Completamente aleatorio (cada llamada diferente)
      const indiceAleatorio = Math.floor(Math.random() * frases.length);
      fraseSeleccionada = frases[indiceAleatorio];
    } else {
      // Por defecto: misma frase por día por usuario
      const seed = obtenerSeedDelDia(usuario || '');
      const indice = randomConSeed(seed, frases.length);
      fraseSeleccionada = frases[indice];
    }

    console.log(`✅ Frase seleccionada: "${fraseSeleccionada.texto.substring(0, 30)}..."`);

    // Respuesta exitosa
    res.json({
      success: true,
      frase: fraseSeleccionada,
      metadata: {
        totalFrases: frases.length,
        fecha: new Date().toISOString().split('T')[0],
        tipo: tipo || 'diaria'
      }
    });

  } catch (error) {
    console.error('❌ Error en endpoint de frases:', error);
    
    // Respuesta de fallback
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      frase: {
        texto: "La educación es el arma más poderosa para cambiar el mundo",
        autor: "Nelson Mandela"
      }
    });
  }
};

// 📊 ENDPOINT ADICIONAL: Obtener todas las frases
const obtenerTodasFrases = async (req, res) => {
  try {
    const frases = cargarFrases();
    
    res.json({
      success: true,
      frases: frases,
      total: frases.length
    });

  } catch (error) {
    console.error('❌ Error al obtener todas las frases:', error);
    res.status(500).json({ 
      success: false,
      error: 'Error al obtener frases' 
    });
  }
};

// 📊 ENDPOINT ADICIONAL: Obtener estadísticas de frases
const obtenerEstadisticasFrases = async (req, res) => {
  try {
    const frases = cargarFrases();
    
    // Calcular estadísticas
    const autores = [...new Set(frases.map(f => f.autor))];
    const autorMasFrases = autores.reduce((prev, curr) => {
      const countPrev = frases.filter(f => f.autor === prev).length;
      const countCurr = frases.filter(f => f.autor === curr).length;
      return countCurr > countPrev ? curr : prev;
    });

    res.json({
      success: true,
      estadisticas: {
        totalFrases: frases.length,
        totalAutores: autores.length,
        autorConMasFrases: autorMasFrases,
        promedioLongitud: Math.round(
          frases.reduce((sum, f) => sum + f.texto.length, 0) / frases.length
        ),
        ultimaActualizacion: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error al obtener estadísticas:', error);
    res.status(500).json({ 
      success: false,
      error: 'Error al obtener estadísticas' 
    });
  }
};

module.exports = {
  obtenerFraseMotivacional,
  obtenerTodasFrases,
  obtenerEstadisticasFrases
};