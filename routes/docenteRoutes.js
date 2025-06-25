const express = require('express');
const router = express.Router();
const { obtenerDatosDocente,
        obtenerMateriasPorDocente,
        obtenerGruposPorMateriaDocente,
        crearActividad,
        obtenerListasCotejo,
        obtenerActividadesPorGrupo,
        obtenerMateriasCompletas  // ← AGREGAR AQUÍ
      } = require('../controllers/docenteController');

router.get('/:clave', obtenerDatosDocente);
router.get('/:clave/materias', obtenerMateriasPorDocente);
router.get('/:clave/materias-completas', obtenerMateriasCompletas);
router.get('/:clave/materia/:clvMateria/grupos', obtenerGruposPorMateriaDocente);
router.post('/crear-actividad', crearActividad);
router.get('/:claveDocente/materia/:claveMateria/listas-cotejo', obtenerListasCotejo);
router.get('/:claveDocente/materia/:claveMateria/grupo/:idGrupo/actividades', obtenerActividadesPorGrupo);

module.exports = router;