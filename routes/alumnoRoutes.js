const express = require('express');
const router = express.Router();

const {
  obtenerDatosAlumno,
  cambiarContrasena,
  editarPerfil,
  obtenerActividadesPorAlumno,
  obtenerCalificacionesHistoricas, 
  obtenerDetalleActividad,
  obtenerActividadesEntregadas,    
  obtenerActividadEntregada
} = require('../controllers/alumnoController');

// Obtener datos del alumno
router.get('/:matricula', obtenerDatosAlumno);

// Cambiar contraseña
router.put('/cambiar-contrasena/:matricula', cambiarContrasena);

// Obtener actividades por alumno y materia
router.get('/actividades/:matricula/:materia', obtenerActividadesPorAlumno);

// Obtener calificaciones históricas
router.get('/calificaciones/:matricula', obtenerCalificacionesHistoricas);

// Obtener detalle de actividad
router.get('/actividad/:matricula/:idActividad', obtenerDetalleActividad);

// Obtener lista de actividades entregadas del alumno
router.get('/actividades-entregadas/:matricula', obtenerActividadesEntregadas);

// Obtener detalle de actividad entregada/calificada
router.get('/actividad-entregada/:matricula/:idActividad', obtenerActividadEntregada);

module.exports = router;
