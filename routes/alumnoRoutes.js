const express = require('express');
const router = express.Router();

const { obtenerDatosAlumno, cambiarContrasena, editarPerfil } = require('../controllers/alumnoController');

// Obtener datos del alumno
router.get('/:matricula', obtenerDatosAlumno);

// Cambiar contraseña
router.put('/cambiar-contrasena/:matricula', cambiarContrasena);


module.exports = router;
