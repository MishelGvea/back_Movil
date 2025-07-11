const express = require('express');
const router = express.Router();

const {
  obtenerParcialesDisponibles,
  obtenerGruposDisponibles,
  obtenerPeriodosDisponibles,
  obtenerMateriasConDatos,
  previsualizarConcentrado,
  previsualizarDetallado,
  generarConcentradoExcel,
  generarDetalladoExcel,
  generarConcentradoPDF,
  generarDetalladoPDF
} = require('../controllers/reportesController');

// Filtros dinámicos
router.get('/filtros/parciales/:claveDocente/:claveMateria', obtenerParcialesDisponibles);
router.get('/filtros/grupos/:claveDocente/:claveMateria', obtenerGruposDisponibles);
router.get('/filtros/periodos/:claveDocente/:claveMateria', obtenerPeriodosDisponibles);
router.get('/filtros/materias/:claveDocente', obtenerMateriasConDatos);

// Vista previa
router.post('/vista-previa/concentrado', previsualizarConcentrado);
router.post('/vista-previa/detallado', previsualizarDetallado);

// Exportar Excel
router.post('/excel/concentrado', generarConcentradoExcel);
router.post('/excel/detallado', generarDetalladoExcel);

// Exportar PDF
router.post('/pdf/concentrado', generarConcentradoPDF);
router.post('/pdf/detallado', generarDetalladoPDF);

module.exports = router;