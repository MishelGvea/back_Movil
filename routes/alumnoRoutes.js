const express = require('express');
const router = express.Router();
const { obtenerDatosAlumno, cambiarContrasena, editarPerfil, obtenerActividadesPorAlumno, obtenerCalificacionesHistoricas } = require('../controllers/alumnoController');

// Obtener datos del alumno
router.get('/:matricula', obtenerDatosAlumno);

// Cambiar contraseña
router.put('/cambiar-contrasena/:matricula', cambiarContrasena);

// Obtener actividades por alumno
// Cambiar la ruta para incluir el parámetro de materia
router.get('/actividades/:matricula/:materia', obtenerActividadesPorAlumno);

// Agregar esta línea en alumnoRoutes.js
router.get('/calificaciones/:matricula', obtenerCalificacionesHistoricas);

module.exports = router;
