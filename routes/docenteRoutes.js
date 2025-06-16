const express = require('express');
const router = express.Router();
const { obtenerDatosDocente } = require('../controllers/docenteController');

router.get('/:clave', obtenerDatosDocente);

module.exports = router;
