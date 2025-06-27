const express = require('express');
const router = express.Router();
const { obtenerDatosDocente,
        obtenerMateriasPorDocente,
        obtenerGruposPorMateriaDocente,
        crearActividad,
        obtenerListasCotejo,
        obtenerActividadesPorGrupo,
        obtenerMateriasCompletas,  // ← AGREGAR AQUÍ
        cambiarContrasenaDocente,
        obtenerPerfilDocente,
        // ===============================================
        // NUEVAS FUNCIONES AGREGADAS DESDE EL PRIMER ARCHIVO
        // ===============================================
        obtenerEquiposPorGrupo,
        obtenerAlumnosPorGrupo,
        simularEquiposAleatorios,
        obtenerActividadesConEquiposPorGrupo,
        crearActividadCompleta
      } = require('../controllers/docenteController');

// ===============================================
// RUTAS EXISTENTES (SIN MODIFICAR)
// ===============================================
router.get('/:clave', obtenerDatosDocente);
router.get('/:clave/materias', obtenerMateriasPorDocente);
router.get('/:clave/materias-completas', obtenerMateriasCompletas);
router.get('/:clave/materia/:clvMateria/grupos', obtenerGruposPorMateriaDocente);
router.post('/crear-actividad', crearActividad);
router.get('/:claveDocente/materia/:claveMateria/listas-cotejo', obtenerListasCotejo);
router.get('/:claveDocente/materia/:claveMateria/grupo/:idGrupo/actividades', obtenerActividadesPorGrupo);

// Cambiar contraseña del docente
// POST /api/docente/cambiar-contrasena
// Body: { usuario: "0098", contrasenaActual: "actual123", nuevaContrasena: "nueva456" }
router.post('/cambiar-contrasena', cambiarContrasenaDocente);

// Obtener perfil completo del docente con materias
// POST /api/docente/perfil
// Body: { clave: "0098" }
router.post('/perfil', obtenerPerfilDocente);

// ===============================================
// RUTAS AGREGADAS DESDE EL PRIMER ARCHIVO
// ===============================================

// Rutas para manejo de equipos
router.get('/:claveDocente/materia/:claveMateria/grupo/:idGrupo/equipos', obtenerEquiposPorGrupo);
router.get('/:claveDocente/materia/:claveMateria/grupo/:idGrupo/alumnos', obtenerAlumnosPorGrupo);
router.post('/simular-equipos-aleatorios', simularEquiposAleatorios);

// Crear actividad completa (con equipos si es necesario)
router.post('/crear-actividad-completa', crearActividadCompleta);

// Actividades con equipos por grupo
router.get('/:claveDocente/materia/:claveMateria/grupo/:idGrupo/actividades-equipos', obtenerActividadesConEquiposPorGrupo);

module.exports = router;