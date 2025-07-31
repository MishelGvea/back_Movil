const express = require('express');
const router = express.Router();

const {
  // Datos personales
  obtenerDatosDocente,
  obtenerPerfilDocente,
  cambiarContrasenaDocente,

  // Materias y periodos
  obtenerMateriasPorDocente,
  obtenerMateriasCompletas,
  obtenerPeriodoActual,
  obtenerPeriodosDocente,
  obtenerMateriasCompletasPorPeriodo,

  // 🆕 Componentes CRUD (ponderaciones) - NUEVAS FUNCIONES
  obtenerComponentesPorMateria,
  crearComponente,
  modificarComponente,
  eliminarComponente,
  validarSumaComponentes,
  obtenerComponentesParaDropdown,
  validarComplecionParcial,
  validarParcial, // 🆕 AGREGAR ESTA IMPORTACIÓN
  obtenerEstadisticasGeneralesDocente,
  clonarComponentesParcial,

  // Grupos y actividades
  obtenerGruposPorMateriaDocente,
  obtenerListasCotejo,
  obtenerActividadesPorGrupo,
  obtenerEstadisticasGrupo,
  crearActividad,
  crearActividadCompletaConComponente,

  // Equipos
  obtenerEquiposPorGrupo,
  obtenerAlumnosPorGrupo,
  simularEquiposAleatorios,
  obtenerActividadesConEquiposPorGrupo,

  // Calificaciones
  obtenerDatosActividad,
  obtenerCriteriosActividad,
  obtenerAlumnosParaCalificar,
  obtenerEquiposParaCalificar,
  obtenerCalificacionesAlumno,
  obtenerCalificacionesEquipo,
  guardarCalificacionesAlumno,
  guardarCalificacionesEquipo,

  // Observaciones
  guardarObservacionAlumno,
  guardarObservacionEquipo,
  obtenerObservacionAlumno,
  obtenerObservacionEquipo,
  obtenerCalificacionesIntegrantesEquipo,
  obtenerComparativaEquipoIndividual,

  // Procedimientos almacenados
  obtenerConcentradoFinal,
  obtenerCalificacionesActividad,
  obtenerEstadisticasCentroControl
} = require('../controllers/docenteController');

// =========================================
// RUTAS GENERALES
// =========================================
router.get('/:clave', obtenerDatosDocente);
router.post('/perfil', obtenerPerfilDocente);
router.post('/cambiar-contrasena', cambiarContrasenaDocente);

// =========================================
// MATERIAS Y PERIODOS
// =========================================
router.get('/:clave/materias', obtenerMateriasPorDocente);
router.get('/:clave/materias-completas', obtenerMateriasCompletas);
router.get('/periodo-actual', obtenerPeriodoActual);
router.get('/:clave/periodos', obtenerPeriodosDocente);
router.get('/:clave/materias-periodo/:periodo', obtenerMateriasCompletasPorPeriodo);

// =========================================
// 🆕 COMPONENTES CRUD - NUEVAS RUTAS
// =========================================
// Obtener componentes por materia/parcial/periodo
router.get('/componentes/:claveDocente/:claveMateria/:parcial/:periodo', obtenerComponentesPorMateria);

// Crear nuevo componente
router.post('/componentes/crear', crearComponente);

// Modificar componente existente
router.put('/componentes/:idComponente', modificarComponente);

// Eliminar componente
router.delete('/componentes/:idComponente', eliminarComponente);

// Validar suma total de componentes (función anterior)
router.get('/componentes/validar/:claveDocente/:claveMateria/:parcial/:periodo', validarSumaComponentes);

// 🆕 AGREGAR ESTA RUTA FALTANTE (para recomendaciones)
router.get('/componentes/validar-parcial/:claveDocente/:claveMateria/:parcial/:periodo', validarParcial);

// 🆕 Validar completitud de un parcial específico (función nueva mejorada)
router.get('/componentes/validar-completo/:claveDocente/:claveMateria/:parcial/:periodo', validarComplecionParcial);

// 🆕 Obtener estadísticas generales del docente
router.get('/componentes/estadisticas-generales/:claveDocente', obtenerEstadisticasGeneralesDocente);

// 🆕 Clonar componentes de un parcial a otro
router.post('/componentes/clonar-parcial', clonarComponentesParcial);

// Obtener componentes para dropdown en crear actividad
router.get('/componentes/dropdown/:claveDocente/:claveMateria/:parcial/:periodo', obtenerComponentesParaDropdown);

// =========================================
// GRUPOS Y ACTIVIDADES
// =========================================
router.get('/:clave/materia/:clvMateria/grupos', obtenerGruposPorMateriaDocente);
router.get('/:claveDocente/materia/:claveMateria/listas-cotejo', obtenerListasCotejo);
router.get('/:claveDocente/materia/:claveMateria/grupo/:idGrupo/actividades', obtenerActividadesPorGrupo);

// ✅ NUEVA RUTA PARA ESTADÍSTICAS DEL GRUPO
router.get('/:claveDocente/materia/:claveMateria/grupo/:idGrupo/estadisticas', obtenerEstadisticasGrupo);

router.post('/crear-actividad', crearActividad);
router.post('/crear-actividad-completa-componente', crearActividadCompletaConComponente);

// 🆕 Ruta para obtener calificaciones de integrantes de equipo
router.get('/actividad-equipo/:idActividadEquipo/integrantes-calificaciones', obtenerCalificacionesIntegrantesEquipo);

// 🆕 Ruta para comparativa (opcional)
router.get('/actividad-equipo/:idActividadEquipo/comparativa', obtenerComparativaEquipoIndividual);

// =========================================
// EQUIPOS
// =========================================
router.get('/:claveDocente/materia/:claveMateria/grupo/:idGrupo/equipos', obtenerEquiposPorGrupo);
router.get('/:claveDocente/materia/:claveMateria/grupo/:idGrupo/alumnos', obtenerAlumnosPorGrupo);
router.post('/simular-equipos-aleatorios', simularEquiposAleatorios);
router.get('/:claveDocente/materia/:claveMateria/grupo/:idGrupo/actividades-equipos', obtenerActividadesConEquiposPorGrupo);

// =========================================
// CALIFICACIONES
// =========================================
router.get('/actividad/:idActividad/datos', obtenerDatosActividad);
router.get('/actividad/:idActividad/criterios', obtenerCriteriosActividad);
router.get('/actividad/:idActividad/alumnos', obtenerAlumnosParaCalificar);
router.get('/actividad/:idActividad/equipos', obtenerEquiposParaCalificar);
router.get('/actividad-alumno/:idActividadAlumno/calificaciones', obtenerCalificacionesAlumno);
router.get('/actividad-equipo/:idActividadEquipo/calificaciones', obtenerCalificacionesEquipo);
router.post('/calificar-alumno', guardarCalificacionesAlumno);
router.post('/calificar-equipo', guardarCalificacionesEquipo);

// =========================================
// OBSERVACIONES
// =========================================
router.post('/observacion-alumno', guardarObservacionAlumno);
router.post('/observacion-equipo', guardarObservacionEquipo);
router.get('/actividad-alumno/:idActividadAlumno/observacion', obtenerObservacionAlumno);
router.get('/actividad-equipo/:idActividadEquipo/observacion', obtenerObservacionEquipo);

// =========================================
// PROCEDIMIENTOS ALMACENADOS
// =========================================
router.get('/concentrado/:parcial/:grupo/:periodo/:cuatrimestre/:materia', obtenerConcentradoFinal);
router.get('/calificaciones-actividad/:parcial/:grupo/:periodo/:cuatrimestre/:materia', obtenerCalificacionesActividad);

router.get('/:claveDocente/materia/:claveMateria/estadisticas-centro-control', obtenerEstadisticasCentroControl);

module.exports = router;