const express = require('express');
const router = express.Router();
const { obtenerDatosAlumno } = require('../controllers/alumnoController');

router.get('/:matricula', obtenerDatosAlumno);

module.exports = router;
