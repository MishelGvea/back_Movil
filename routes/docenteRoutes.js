const express = require('express');
const router = express.Router();
const { obtenerDatosDocente, obtenerMateriasPorDocente, obtenerGruposPorMateriaDocente} = require('../controllers/docenteController');

router.get('/:clave', obtenerDatosDocente);
router.get('/:clave/materias', obtenerMateriasPorDocente);
router.get('/:clave/materia/:clvMateria/grupos', obtenerGruposPorMateriaDocente);

module.exports = router;
