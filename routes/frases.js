const express = require('express');
const router = express.Router();
const { 
  obtenerFraseMotivacional, 
  obtenerTodasFrases,
  obtenerEstadisticasFrases 
} = require('../controllers/frasesController');

// 🎯 Ruta principal: GET /api/frases/motivacional
// Parámetros opcionales:
// - ?usuario=123 (para personalizar por usuario)
// - ?tipo=random (para frase completamente aleatoria)
router.get('/motivacional', obtenerFraseMotivacional);

// 📚 Ruta para obtener todas las frases: GET /api/frases/todas
router.get('/todas', obtenerTodasFrases);

// 📊 Ruta de estadísticas: GET /api/frases/estadisticas
router.get('/estadisticas', obtenerEstadisticasFrases);

// 🧪 Ruta de prueba: GET /api/frases/test
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'API de frases funcionando correctamente',
    endpoints: [
      'GET /api/frases/motivacional',
      'GET /api/frases/todas',
      'GET /api/frases/estadisticas',
      'GET /api/frases/test'
    ],
    timestamp: new Date().toISOString()
  });
});

module.exports = router;