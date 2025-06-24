const express = require('express');
const router = express.Router();
const { obtenerDatosDocente, obtenerMateriasPorDocente, obtenerGruposPorMateriaDocente,crearActividad,obtenerListasCotejo} = require('../controllers/docenteController');

router.get('/:clave', obtenerDatosDocente);
router.get('/:clave/materias', obtenerMateriasPorDocente);
router.get('/:clave/materia/:clvMateria/grupos', obtenerGruposPorMateriaDocente);
router.post('/crear-actividad', crearActividad);
router.get('/:claveDocente/materia/:claveMateria/listas-cotejo', obtenerListasCotejo);



module.exports = router;
