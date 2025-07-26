const express = require('express');
const router = express.Router();

// ✅ IMPORTS ACTUALIZADOS - Solo las funciones nuevas
const {
  obtenerParcialesDisponibles,
  obtenerGruposDisponibles,
  obtenerPeriodosDisponibles,
  obtenerMateriasConDatos,
  previsualizarReporte,        // ✅ Nueva función única
  generarReporteExcel,         // ✅ Nueva función única
  generarReportePDF            // ✅ Nueva función única
} = require('../controllers/reportesController');

// ===============================================
// 🔍 RUTAS PARA FILTROS DINÁMICOS (Sin cambios)
// ===============================================
router.get('/filtros/parciales/:claveDocente/:claveMateria', obtenerParcialesDisponibles);
router.get('/filtros/grupos/:claveDocente/:claveMateria', obtenerGruposDisponibles);
router.get('/filtros/periodos/:claveDocente/:claveMateria', obtenerPeriodosDisponibles);
router.get('/filtros/materias/:claveDocente', obtenerMateriasConDatos);

// ===============================================
// 📊 RUTAS SIMPLIFICADAS PARA REPORTES
// ===============================================

// ✅ Vista previa única (reemplaza las 2 anteriores)
router.post('/preview', previsualizarReporte);

// ✅ Exportación Excel única (reemplaza las 2 anteriores)
router.post('/excel', generarReporteExcel);

// ✅ Exportación PDF única (reemplaza las 2 anteriores)
router.post('/pdf', generarReportePDF);

// ❌ RUTAS ELIMINADAS (ya no se usan):
// router.post('/vista-previa/concentrado', previsualizarConcentrado);
// router.post('/vista-previa/detallado', previsualizarDetallado);
// router.post('/excel/concentrado', generarConcentradoExcel);
// router.post('/excel/detallado', generarDetalladoExcel);
// router.post('/pdf/concentrado', generarConcentradoPDF);
// router.post('/pdf/detallado', generarDetalladoPDF);

module.exports = router;