const express = require('express');
const router = express.Router();

const {
  obtenerDatosAlumno,
  cambiarContrasena,
  editarPerfil,
  obtenerActividadesPorAlumno
} = require('../controllers/alumnoController');

// Obtener datos del alumno
router.get('/:matricula', obtenerDatosAlumno);

// Cambiar contraseña
router.put('/cambiar-contrasena/:matricula', cambiarContrasena);

// Obtener actividades por alumno y materia
router.get('/actividades/:matricula/:materia', obtenerActividadesPorAlumno);

module.exports = router;
