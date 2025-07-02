const { sql, config } = require('../db/sqlConfig');

// ===============================================
// FUNCIONES AUXILIARES PARA CALIFICACIONES REALES
// ===============================================

// Función para obtener calificación real de una actividad
const obtenerCalificacionRealActividad = async (pool, idActividad, matricula) => {
  try {
    console.log(`📊 Buscando calificación real para actividad ${idActividad}, alumno ${matricula}`);
    
    const result = await pool.request()
      .input('idActividad', sql.Int, idActividad)
      .input('matricula', sql.VarChar, matricula)
      .query(`
        SELECT 
          SUM(eca.calificacion) as puntos_obtenidos_total,
          COUNT(eca.id_criterio) as criterios_calificados,
          i.valor_total as puntos_maximos_total,
          ROUND((SUM(eca.calificacion) * 10.0) / i.valor_total, 2) as calificacion_sobre_10
        FROM tbl_evaluacion_criterioActividad eca
        INNER JOIN tbl_actividad_alumno aa ON eca.id_actividad_alumno = aa.id_actividad_alumno
        INNER JOIN tbl_actividades a ON aa.id_actividad = a.id_actividad
        INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
        WHERE aa.vchMatricula = @matricula 
          AND a.id_actividad = @idActividad
        GROUP BY i.valor_total
      `);
    
    if (result.recordset.length > 0) {
      const data = result.recordset[0];
      console.log(`✅ Calificación real encontrada: ${data.calificacion_sobre_10}/10 (${data.puntos_obtenidos_total}/${data.puntos_maximos_total} pts)`);
      return data;
    } else {
      console.log(`ℹ️ No se encontró calificación real para actividad ${idActividad}`);
      return null;
    }
  } catch (error) {
    console.log(`⚠️ Error al obtener calificación real: ${error.message}`);
    return null;
  }
};

// Función para obtener criterios calificados reales
const obtenerCriteriosCalificadosReales = async (pool, idActividad, matricula) => {
  try {
    const result = await pool.request()
      .input('idActividad', sql.Int, idActividad)
      .input('matricula', sql.VarChar, matricula)
      .query(`
        SELECT 
          c.id_criterio,
          c.nombre as criterio,
          c.descripcion,
          c.valor_maximo as puntos_maximos,
          ISNULL(eca.calificacion, 0) as puntos_obtenidos,
          CASE 
            WHEN eca.calificacion IS NOT NULL AND eca.calificacion >= (c.valor_maximo * 0.6) THEN 1 
            ELSE 0 
          END as cumplido,
          CASE 
            WHEN eca.calificacion IS NOT NULL THEN 1 
            ELSE 0 
          END as calificado
        FROM tbl_criterios c
        INNER JOIN tbl_instrumento i ON c.id_instrumento = i.id_instrumento
        INNER JOIN tbl_actividades a ON a.id_instrumento = i.id_instrumento
        LEFT JOIN tbl_actividad_alumno aa ON aa.id_actividad = a.id_actividad AND aa.vchMatricula = @matricula
        LEFT JOIN tbl_evaluacion_criterioActividad eca ON eca.id_actividad_alumno = aa.id_actividad_alumno 
                                                       AND eca.id_criterio = c.id_criterio
        WHERE a.id_actividad = @idActividad
        ORDER BY c.id_criterio
      `);
    
    console.log(`📋 Criterios encontrados: ${result.recordset.length}`);
    return result.recordset;
  } catch (error) {
    console.log(`⚠️ Error al obtener criterios calificados: ${error.message}`);
    return [];
  }
};

// ===============================================
// FUNCIÓN ADAPTADA: obtenerDetalleActividad
// ===============================================
const obtenerDetalleActividad = async (req, res) => {
  const { matricula, idActividad } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`🔍 === INICIO DEBUG DETALLE ACTIVIDAD (CON ESTADO REAL) ===`);
    console.log(`📋 Parámetros: Matrícula: ${matricula}, ID Actividad: ${idActividad}`);

    // PASO 1: Verificar acceso
    const verificacionResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('idActividad', sql.Int, idActividad)
      .query(`
        SELECT 
          A.vchPeriodo as periodo_alumno,
          A.chvGrupo as grupo_alumno,
          AC.id_modalidad,
          AC.titulo,
          'Verificado' as acceso
        FROM tblAlumnos A
        CROSS JOIN tbl_actividades AC
        WHERE A.vchMatricula = @matricula 
        AND AC.id_actividad = @idActividad
        AND (
          (AC.id_modalidad = 1 AND EXISTS (
            SELECT 1 FROM tbl_actividad_alumno AA 
            WHERE AA.id_actividad = AC.id_actividad AND AA.vchMatricula = @matricula
          ))
          OR
          (AC.id_modalidad = 2 AND EXISTS (
            SELECT 1 FROM tbl_actividad_equipo AE
            INNER JOIN tbl_equipos E ON E.id_equipo = AE.id_equipo
            INNER JOIN tbl_equipo_alumno EA ON EA.id_equipo = E.id_equipo
            WHERE AE.id_actividad = AC.id_actividad AND EA.vchMatricula = @matricula
          ))
          OR
          (AC.id_modalidad = 3 AND EXISTS (
            SELECT 1 FROM tbl_actividad_grupo AG
            INNER JOIN tbl_grupos G ON G.id_grupo = AG.id_grupo
            WHERE AG.id_actividad = AC.id_actividad AND G.vchGrupo = A.chvGrupo
          ))
        )
      `);

    if (verificacionResult.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Actividad no encontrada o sin acceso' });
    }

    // PASO 2: Obtener detalles de la actividad
    const result = await pool.request()
      .input('idActividad', sql.Int, idActividad)
      .query(`
        SELECT 
          AC.id_actividad,
          AC.titulo,
          AC.descripcion,
          CONVERT(VARCHAR, AG.fecha_asignacion, 126) as fecha_asignacion,
          CONVERT(VARCHAR, AG.fecha_entrega, 126) as fecha_entrega,
          EA.nombre_estado as estado_original,
          I.nombre as instrumento,
          I.valor_total as puntos_total,
          I.id_instrumento,
          TI.nombre_tipo as tipoInstrumento,
          M.vchNomMateria as materia,
          CONCAT(D.vchNombre, ' ', D.vchAPaterno, ' ', ISNULL(D.vchAMaterno, '')) AS docente,
          CASE 
            WHEN I.parcial = 1 THEN 'Parcial 1'
            WHEN I.parcial = 2 THEN 'Parcial 2'
            WHEN I.parcial = 3 THEN 'Parcial 3'
            ELSE 'Actividad General'
          END as parcial,
          AC.id_modalidad,
          CASE 
            WHEN AC.id_modalidad = 1 THEN 'Individual'
            WHEN AC.id_modalidad = 2 THEN 'Equipo'
            WHEN AC.id_modalidad = 3 THEN 'Grupo'
            ELSE 'Desconocida'
          END as modalidad_nombre
        FROM tbl_actividades AC
        INNER JOIN tbl_instrumento I ON I.id_instrumento = AC.id_instrumento
        INNER JOIN tbl_materias M ON M.vchClvMateria = I.vchClvMateria
        INNER JOIN tbl_estado_actividad EA ON EA.id_estado_actividad = AC.id_estado_actividad
        INNER JOIN tbl_tipo_instrumento TI ON TI.id_tipo_instrumento = I.id_tipo_instrumento
        INNER JOIN tbl_docentes D ON D.vchClvTrabajador = AC.vchClvTrabajador
        INNER JOIN tbl_actividad_grupo AG ON AG.id_actividad = AC.id_actividad
        WHERE AC.id_actividad = @idActividad
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Detalles de actividad no encontrados' });
    }

    const actividad = result.recordset[0];

    // PASO 3: 🆕 VERIFICAR SI EL INSTRUMENTO TIENE CRITERIOS DEFINIDOS
    const criteriosDefinidos = await pool.request()
      .input('idInstrumento', sql.Int, actividad.id_instrumento)
      .query(`
        SELECT COUNT(c.id_criterio) as total_criterios
        FROM tbl_criterios c
        WHERE c.id_instrumento = @idInstrumento
      `);

    const totalCriteriosDefinidos = criteriosDefinidos.recordset[0]?.total_criterios || 0;
    const instrumentoTieneCriterios = totalCriteriosDefinidos > 0;

    console.log(`📊 Instrumento ${actividad.id_instrumento} (${actividad.instrumento}):`);
    console.log(`   - Criterios definidos: ${totalCriteriosDefinidos}`);
    console.log(`   - Tiene criterios: ${instrumentoTieneCriterios ? 'SÍ' : 'NO'}`);

    // PASO 4: VERIFICAR SI HAY CALIFICACIÓN REAL
    const calificacionReal = await obtenerCalificacionRealActividad(pool, idActividad, matricula);
    
    // PASO 5: DETERMINAR ESTADO REAL BASADO EN CALIFICACIONES
    let estadoReal = actividad.estado_original;
    if (calificacionReal && calificacionReal.criterios_calificados > 0) {
      estadoReal = 'Calificada';
    }

    // PASO 6: 🆕 MANEJO MEJORADO DE CRITERIOS CON MENSAJES CLAROS
    let rubrica = [];
    let estadoCriterios = {
      instrumento_tiene_criterios: instrumentoTieneCriterios,
      total_criterios_definidos: totalCriteriosDefinidos,
      criterios_calificados: 0,
      mensaje_estado: '',
      mostrar_rubrica: false,
      tipo_rubrica: ''
    };

    if (instrumentoTieneCriterios) {
      console.log(`✅ Instrumento con criterios definidos (${totalCriteriosDefinidos})`);
      
      const criteriosReales = await obtenerCriteriosCalificadosReales(pool, idActividad, matricula);
      
      if (criteriosReales.length > 0) {
        console.log(`✅ Criterios con calificaciones encontradas`);
        
        rubrica = criteriosReales.map(criterio => ({
          criterio: criterio.criterio,
          descripcion: criterio.descripcion || 'Criterio de evaluación',
          puntos: criterio.puntos_maximos,
          puntos_obtenidos: criterio.puntos_obtenidos || 0,
          cumplido: criterio.cumplido === 1,
          calificado: criterio.calificado === 1,
          icono: criterio.calificado === 1 ? (criterio.cumplido === 1 ? '✅' : '❌') : '📝'
        }));
        
        estadoCriterios.criterios_calificados = criteriosReales.filter(c => c.calificado === 1).length;
        estadoCriterios.mensaje_estado = `Esta actividad tiene ${totalCriteriosDefinidos} criterios de evaluación definidos. ${estadoCriterios.criterios_calificados} han sido calificados.`;
        estadoCriterios.mostrar_rubrica = true;
        estadoCriterios.tipo_rubrica = 'real';
        
      } else {
        console.log(`⚠️ Criterios definidos pero sin calificaciones`);
        
        // Obtener criterios sin calificar
        const criteriosSinCalificar = await pool.request()
          .input('idInstrumento', sql.Int, actividad.id_instrumento)
          .query(`
            SELECT 
              c.id_criterio,
              c.nombre as criterio,
              c.descripcion,
              c.valor_maximo as puntos_maximos
            FROM tbl_criterios c
            WHERE c.id_instrumento = @idInstrumento
            ORDER BY c.id_criterio
          `);
        
        rubrica = criteriosSinCalificar.recordset.map(criterio => ({
          criterio: criterio.criterio,
          descripcion: criterio.descripcion || 'Criterio de evaluación',
          puntos: criterio.puntos_maximos,
          puntos_obtenidos: 0,
          cumplido: false,
          calificado: false,
          icono: '📝'
        }));
        
        estadoCriterios.mensaje_estado = `Esta actividad tiene ${totalCriteriosDefinidos} criterios de evaluación definidos, pero aún no han sido calificados por el profesor.`;
        estadoCriterios.mostrar_rubrica = true;
        estadoCriterios.tipo_rubrica = 'sin_calificar';
      }
      
    } else {
      console.log(`❌ Instrumento SIN criterios definidos`);
      
      estadoCriterios.mensaje_estado = `Este instrumento de evaluación no tiene criterios específicos definidos. La calificación se basará en una evaluación general.`;
      estadoCriterios.mostrar_rubrica = false;
      estadoCriterios.tipo_rubrica = 'sin_criterios';
      
      // No mostrar rúbrica cuando no hay criterios definidos
      rubrica = [];
    }

    // PASO 7: Formatear respuesta
    const response = {
      id_actividad: actividad.id_actividad,
      titulo: actividad.titulo,
      descripcion: actividad.descripcion || 'Sin descripción disponible',
      fecha_asignacion: actividad.fecha_asignacion,
      fecha_entrega: actividad.fecha_entrega,
      estado: estadoReal,
      instrumento: actividad.instrumento,
      tipoInstrumento: actividad.tipoInstrumento,
      materia: actividad.materia,
      docente: actividad.docente,
      parcial: actividad.parcial,
      puntos_total: actividad.puntos_total,
      id_modalidad: actividad.id_modalidad,
      modalidad_nombre: actividad.modalidad_nombre,
      rubrica: rubrica,
      
      // Información sobre calificación
      tiene_calificacion: calificacionReal !== null,
      calificacion_info: calificacionReal ? {
        puntos_obtenidos: calificacionReal.puntos_obtenidos_total,
        calificacion_sobre_10: calificacionReal.calificacion_sobre_10,
        criterios_calificados: calificacionReal.criterios_calificados
      } : null,
      
      // 🆕 INFORMACIÓN CLARA SOBRE CRITERIOS
      criterios_info: {
        instrumento_tiene_criterios: estadoCriterios.instrumento_tiene_criterios,
        total_criterios_definidos: estadoCriterios.total_criterios_definidos,
        criterios_calificados: estadoCriterios.criterios_calificados,
        mensaje_estado: estadoCriterios.mensaje_estado,
        mostrar_rubrica: estadoCriterios.mostrar_rubrica,
        tipo_rubrica: estadoCriterios.tipo_rubrica
      }
    };

    console.log(`✅ Detalle de actividad obtenido:`);
    console.log(`   - Título: ${response.titulo}`);
    console.log(`   - Estado real: ${response.estado}`);
    console.log(`   - Tiene calificación: ${response.tiene_calificacion}`);
    console.log(`   - Instrumento tiene criterios: ${response.criterios_info.instrumento_tiene_criterios}`);
    console.log(`   - Tipo de rúbrica: ${response.criterios_info.tipo_rubrica}`);
    console.log(`   - Mostrar rúbrica: ${response.criterios_info.mostrar_rubrica}`);
    console.log(`   - Mensaje: ${response.criterios_info.mensaje_estado}`);
    console.log(`🔍 === FIN DEBUG DETALLE ACTIVIDAD ===`);

    res.json(response);

  } catch (error) {
    console.error('❌ Error al obtener detalle de actividad:', error);
    res.status(500).json({ 
      mensaje: 'Error en el servidor al obtener detalle de actividad',
      error: error.message 
    });
  }
};

// ===============================================
// RESTO DE FUNCIONES SIN CAMBIOS
// ===============================================

// Función ORIGINAL obtenerActividadEntregada (sin cambios)
const obtenerActividadEntregada = async (req, res) => {
  const { matricula, idActividad } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`🎯 === INICIO DEBUG ACTIVIDAD ENTREGADA (CON CALIFICACIONES REALES) ===`);
    console.log(`📋 Parámetros: Matrícula: ${matricula}, ID Actividad: ${idActividad}`);

    // PASO 1: Verificar que la actividad tenga calificación real
    const calificacionReal = await obtenerCalificacionRealActividad(pool, idActividad, matricula);
    
    if (!calificacionReal) {
      console.log(`⚠️ No se encontró calificación real para actividad ${idActividad}`);
      return res.status(404).json({ 
        mensaje: 'Esta actividad aún no ha sido calificada por el profesor',
        codigo: 'SIN_CALIFICAR'
      });
    }

    // PASO 2: Obtener detalles de la actividad
    const result = await pool.request()
      .input('idActividad', sql.Int, idActividad)
      .query(`
        SELECT 
          AC.id_actividad,
          AC.titulo,
          AC.descripcion,
          CONVERT(VARCHAR, AG.fecha_asignacion, 126) as fecha_asignacion,
          CONVERT(VARCHAR, AG.fecha_entrega, 126) as fecha_entrega,
          I.nombre as instrumento,
          I.valor_total as puntos_total,
          I.id_instrumento,
          TI.nombre_tipo as tipoInstrumento,
          M.vchNomMateria as materia,
          CONCAT(D.vchNombre, ' ', D.vchAPaterno, ' ', ISNULL(D.vchAMaterno, '')) AS docente,
          CASE 
            WHEN I.parcial = 1 THEN 'Parcial 1'
            WHEN I.parcial = 2 THEN 'Parcial 2'
            WHEN I.parcial = 3 THEN 'Parcial 3'
            ELSE 'Actividad General'
          END as parcial,
          AC.id_modalidad,
          CASE 
            WHEN AC.id_modalidad = 1 THEN 'Individual'
            WHEN AC.id_modalidad = 2 THEN 'Equipo'
            WHEN AC.id_modalidad = 3 THEN 'Grupo'
            ELSE 'Desconocida'
          END as modalidad_nombre
        FROM tbl_actividades AC
        INNER JOIN tbl_instrumento I ON I.id_instrumento = AC.id_instrumento
        INNER JOIN tbl_materias M ON M.vchClvMateria = I.vchClvMateria
        INNER JOIN tbl_tipo_instrumento TI ON TI.id_tipo_instrumento = I.id_tipo_instrumento
        INNER JOIN tbl_docentes D ON D.vchClvTrabajador = AC.vchClvTrabajador
        INNER JOIN tbl_actividad_grupo AG ON AG.id_actividad = AC.id_actividad
        WHERE AC.id_actividad = @idActividad
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Actividad no encontrada' });
    }

    const actividad = result.recordset[0];

    // PASO 3: 🆕 OBTENER CRITERIOS CALIFICADOS REALES
    const criteriosCalificados = await obtenerCriteriosCalificadosReales(pool, idActividad, matricula);
    
    let rubrica = [];
    if (criteriosCalificados.length > 0) {
      console.log(`✅ Usando criterios calificados reales de la BD`);
      
      rubrica = criteriosCalificados.map(criterio => ({
        criterio: criterio.criterio,
        descripcion: criterio.descripcion || 'Criterio de evaluación',
        puntos_maximos: criterio.puntos_maximos,
        puntos_obtenidos: criterio.puntos_obtenidos,
        cumplido: criterio.cumplido === 1,
        icono: criterio.cumplido === 1 ? '✅' : '❌',
        calificado: criterio.calificado === 1
      }));
    } else {
      console.log(`⚠️ No se encontraron criterios específicos calificados`);
      
      // Rúbrica básica basada en la calificación total real
      const puntosTotal = actividad.puntos_total;
      const puntosObtenidos = calificacionReal.puntos_obtenidos_total;
      
      rubrica = [
        {
          criterio: 'Calificación general',
          descripcion: 'Evaluación general de la actividad',
          puntos_maximos: puntosTotal,
          puntos_obtenidos: puntosObtenidos,
          cumplido: calificacionReal.calificacion_sobre_10 >= 6,
          icono: calificacionReal.calificacion_sobre_10 >= 6 ? '✅' : '❌',
          calificado: true
        }
      ];
    }

    // PASO 4: Verificar entrega puntual (simulado por ahora)
    const fechaEntregaLimite = new Date(actividad.fecha_entrega);
    const fechaEntregaAlumno = new Date(); // Por ahora simulada
    fechaEntregaAlumno.setDate(fechaEntregaLimite.getDate() - 1); // Simular entrega 1 día antes
    const entregaPuntual = fechaEntregaAlumno <= fechaEntregaLimite;

    // PASO 5: Formatear respuesta con datos REALES
    const response = {
      id_actividad: actividad.id_actividad,
      titulo: actividad.titulo,
      descripcion: actividad.descripcion || 'Sin descripción disponible',
      fecha_asignacion: actividad.fecha_asignacion,
      fecha_entrega: actividad.fecha_entrega,
      fecha_entrega_alumno: fechaEntregaAlumno.toISOString(),
      estado: 'Calificada', // Estado real
      instrumento: actividad.instrumento,
      tipoInstrumento: actividad.tipoInstrumento,
      materia: actividad.materia,
      docente: actividad.docente,
      parcial: actividad.parcial,
      puntos_total: actividad.puntos_total,
      puntos_obtenidos: calificacionReal.puntos_obtenidos_total, // 🆕 REAL
      calificacion: calificacionReal.calificacion_sobre_10, // 🆕 REAL
      observaciones: 'Actividad calificada correctamente', // Por ahora genérico
      retroalimentacion: 'Buen trabajo. Continúa esforzándote.', // Por ahora genérico
      id_modalidad: actividad.id_modalidad,
      modalidad_nombre: actividad.modalidad_nombre,
      rubrica: rubrica, // 🆕 REAL
      entrega_puntual: entregaPuntual,
      // Información adicional
      criterios_calificados: calificacionReal.criterios_calificados,
      fuente_calificacion: 'BD_REAL'
    };

    console.log(`✅ Actividad entregada con calificación REAL:`);
    console.log(`   - Calificación: ${response.calificacion}/10`);
    console.log(`   - Puntos: ${response.puntos_obtenidos}/${response.puntos_total}`);
    console.log(`   - Criterios calificados: ${response.criterios_calificados}`);
    console.log(`   - Fuente: BD REAL`);
    console.log(`🎯 === FIN DEBUG ACTIVIDAD ENTREGADA ===`);

    res.json(response);

  } catch (error) {
    console.error('❌ Error al obtener actividad entregada:', error);
    res.status(500).json({ 
      mensaje: 'Error en el servidor al obtener actividad entregada',
      error: error.message 
    });
  }
};

// Todas las demás funciones permanecen exactamente igual...
const obtenerFechasCuatrimestre = async (pool, periodo, cuatrimestre) => {
  try {
    console.log(`📅 Consultando fechas dinámicamente para periodo: ${periodo}, cuatrimestre: ${cuatrimestre}`);
    
    // PASO 1: Obtener el idPeriodo desde tbl_materias
    const periodoResult = await pool.request()
      .input('cuatrimestre', sql.VarChar, cuatrimestre)
      .query(`
        SELECT DISTINCT idPeriodo 
        FROM tbl_materias 
        WHERE vchCuatrimestre = @cuatrimestre
      `);

    let idPeriodo = null;
    if (periodoResult.recordset.length > 0) {
      idPeriodo = periodoResult.recordset[0].idPeriodo;
      console.log(`📅 idPeriodo encontrado: ${idPeriodo}`);
    } else {
      console.log(`⚠️ No se encontró idPeriodo para cuatrimestre: ${cuatrimestre}`);
    }

    // PASO 2: Consultar las fechas desde tbl_periodos
    let fechasResult = null;
    if (idPeriodo) {
      fechasResult = await pool.request()
        .input('idPeriodo', sql.Int, idPeriodo)
        .query(`
          SELECT mesInicia, mesTermina
          FROM tbl_periodos 
          WHERE idPeriodo = @idPeriodo
        `);
      
      console.log(`📅 Resultado consulta tbl_periodos:`, fechasResult.recordset);
    }

    // PASO 3: Calcular fechas dinámicas si tenemos datos
    if (fechasResult && fechasResult.recordset.length > 0) {
      const datos = fechasResult.recordset[0];
      console.log(`📅 Datos obtenidos de tbl_periodos:`, datos);
      
      if (datos.mesInicia && datos.mesTermina) {
        const año = periodo.substring(0, 4);
        const mesIniciaTexto = datos.mesInicia;
        const mesTerminaTexto = datos.mesTermina;
        
        const mesesANumeros = {
          'Enero': 1, 'Febrero': 2, 'Marzo': 3, 'Abril': 4,
          'Mayo': 5, 'Junio': 6, 'Julio': 7, 'Agosto': 8,
          'Septiembre': 9, 'Octubre': 10, 'Noviembre': 11, 'Diciembre': 12
        };
        
        const numeroMesInicia = mesesANumeros[mesIniciaTexto];
        const numeroMesTermina = mesesANumeros[mesTerminaTexto];
        
        const fechaInicio = `${año}-${numeroMesInicia.toString().padStart(2, '0')}-01`;
        const fechaFin = `${año}-${numeroMesTermina.toString().padStart(2, '0')}-30`;
        const nombreRango = `${mesIniciaTexto}-${mesTerminaTexto} ${año}`;
        
        console.log(`✅ Fechas dinámicas calculadas: ${nombreRango}`);
        
        return {
          fechaInicio,
          fechaFin,
          nombreRango,
          año,
          origen: 'dinamico'
        };
      }
    }
    
    // PASO 4: Fallback estático
    console.log(`⚠️ Usando cálculo estático`);
    const año = periodo.substring(0, 4);
    const rangosCuatrimestres = {
      '1': { inicio: `${año}-01-01`, fin: `${año}-04-30`, nombre: 'Enero-Abril' },
      '2': { inicio: `${año}-05-01`, fin: `${año}-08-31`, nombre: 'Mayo-Agosto' },
      '3': { inicio: `${año}-09-01`, fin: `${año}-12-31`, nombre: 'Septiembre-Diciembre' }
    };
    const rango = rangosCuatrimestres[cuatrimestre] || rangosCuatrimestres['1'];
    
    return {
      fechaInicio: rango.inicio,
      fechaFin: rango.fin,
      nombreRango: `${rango.nombre} ${año}`,
      año,
      origen: 'estatico'
    };
    
  } catch (error) {
    console.log('⚠️ Error:', error);
    const añoActual = new Date().getFullYear();
    return {
      fechaInicio: `${añoActual}-01-01`,
      fechaFin: `${añoActual}-04-30`,
      nombreRango: `Enero-Abril ${añoActual}`,
      año: añoActual.toString(),
      origen: 'default'
    };
  }
};

// Obtener datos del alumno y materias (SIN CAMBIOS)
const obtenerDatosAlumno = async (req, res) => {
  const { matricula } = req.params;

  try {
    const pool = await sql.connect(config);

    const alumno = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .query(`
        SELECT TOP 1 
          A.vchNombre + ' ' + A.vchAPaterno + ' ' + A.vchAMaterno AS nombre,
          C.vchNomCarrera AS carrera,
          G.vchGrupo AS grupo,
          A.vchClvCuatri AS cuatrimestre,
          A.vchPeriodo AS periodo
        FROM dbo.tblAlumnos A
        JOIN dbo.tblCarreras C ON C.chrClvCarrera = A.chrClvCarrera
        JOIN dbo.tbl_grupos G ON G.id_grupo = A.chvGrupo
        WHERE RTRIM(A.vchMatricula) = RTRIM(@matricula)
      `);

    const alumnoData = alumno.recordset[0];

    if (!alumnoData) {
      return res.status(404).json({ mensaje: 'Alumno no encontrado' });
    }

    const fechasCuatrimestre = await obtenerFechasCuatrimestre(pool, alumnoData.periodo, alumnoData.cuatrimestre);

    const materiasResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('periodo', sql.VarChar, alumnoData.periodo)
      .query(`
        SELECT DISTINCT vchNomMateria AS nombreMateria, Docente, Grupo
        FROM view_MateriasPorAlumno
        WHERE vchMatricula = @matricula AND Periodo = @periodo
      `);

    const materias = materiasResult.recordset.map(m => ({
      nombre: m.nombreMateria,
      grupo: m.Grupo,
      profesor: m.Docente,
      icono: m.nombreMateria.charAt(0)
    }));

    res.json({
      nombre: alumnoData.nombre,
      carrera: alumnoData.carrera,
      grupo: alumnoData.grupo,
      cuatri: alumnoData.cuatrimestre,
      periodo: alumnoData.periodo,
      materias,
      fechasCuatrimestre: {
        fechaInicio: fechasCuatrimestre.fechaInicio,
        fechaFin: fechasCuatrimestre.fechaFin,
        nombreRango: fechasCuatrimestre.nombreRango,
        año: fechasCuatrimestre.año
      }
    });

  } catch (err) {
    console.error('❌ Error al obtener datos del alumno:', err);
    res.status(500).json({ mensaje: 'Error en el servidor al consultar alumno' });
  }
};

// Cambiar contraseña del alumno (SIN CAMBIOS)
const cambiarContrasena = async (req, res) => {
  const { matricula } = req.params;
  const { actual, nueva } = req.body;

  try {
    const pool = await sql.connect(config);

    const result = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .query(`
        SELECT vchContrasenia 
        FROM dbo.tblAlumnos 
        WHERE RTRIM(vchMatricula) = RTRIM(@matricula)
      `);

    const alumno = result.recordset[0];
    if (!alumno || alumno.vchContrasenia !== actual) {
      return res.status(400).json({ mensaje: 'Contraseña actual incorrecta' });
    }

    await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('nueva', sql.VarChar, nueva)
      .query(`
        UPDATE dbo.tblAlumnos 
        SET vchContrasenia = @nueva 
        WHERE RTRIM(vchMatricula) = RTRIM(@matricula)
      `);

    res.json({ mensaje: 'Contraseña actualizada correctamente' });

  } catch (err) {
    console.error('❌ Error al cambiar contraseña:', err);
    res.status(500).json({ mensaje: 'Error del servidor' });
  }
};

// Resto de funciones originales SIN cambios...
const obtenerActividadesPorAlumno = async (req, res) => {
  const { matricula, materia } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log('🔍 === INICIO DEBUG ACTIVIDADES ===');
    console.log(`📋 Parámetros recibidos:`);
    console.log(`   - Matrícula: ${matricula}`);
    console.log(`   - Materia: ${materia}`);

    // PASO 1: Obtener datos completos del alumno
    const alumnoResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .query(`
        SELECT 
          vchPeriodo,
          chvGrupo,
          vchClvCuatri
        FROM tblAlumnos 
        WHERE RTRIM(vchMatricula) = RTRIM(@matricula)
      `);

    if (alumnoResult.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Alumno no encontrado' });
    }

    const alumno = alumnoResult.recordset[0];
    console.log(`👤 Datos del alumno encontrados:`);
    console.log(`   - Periodo: ${alumno.vchPeriodo}`);
    console.log(`   - Grupo: ${alumno.chvGrupo}`);
    console.log(`   - Cuatrimestre: ${alumno.vchClvCuatri}`);

    // PASO 2: CONSULTA PRINCIPAL CON CTE PARA EVITAR DUPLICADOS + ESTADO REAL
    const result = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('materia', sql.VarChar, materia)
      .input('periodo_alumno', sql.VarChar, alumno.vchPeriodo)
      .input('grupo_alumno', sql.VarChar, alumno.chvGrupo)
      .query(`
        WITH ActividadesUnicas AS (
          -- MODALIDAD 1: INDIVIDUAL
          SELECT 
            a.id_actividad,
            a.titulo,
            a.descripcion,
            a.id_modalidad,
            CONVERT(VARCHAR, ag.fecha_asignacion, 126) as fecha_asignacion,
            CONVERT(VARCHAR, ag.fecha_entrega, 126) as fecha_entrega,
            -- 🆕 ESTADO REAL BASADO EN CALIFICACIONES
            CASE 
              WHEN EXISTS (
                SELECT 1 FROM tbl_actividad_alumno aa_check
                INNER JOIN tbl_evaluacion_criterioActividad eca_check ON aa_check.id_actividad_alumno = eca_check.id_actividad_alumno
                WHERE aa_check.id_actividad = a.id_actividad AND aa_check.vchMatricula = @matricula
              ) THEN 'Calificada'
              ELSE ea.nombre_estado
            END as estado,
            ins.nombre as instrumento,
            ti.nombre_tipo as tipoInstrumento,
            CASE 
              WHEN ins.parcial = 1 THEN 'Parcial 1'
              WHEN ins.parcial = 2 THEN 'Parcial 2'
              WHEN ins.parcial = 3 THEN 'Parcial 3'
              ELSE 'Actividad General'
            END as parcial,
            'Individual' as modalidad_tipo,
            1 as prioridad
          FROM tbl_actividades a
          INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
          INNER JOIN tbl_materias m ON ins.vchClvMateria = m.vchClvMateria
          INNER JOIN tbl_estado_actividad ea ON ea.id_estado_actividad = a.id_estado_actividad
          INNER JOIN tbl_tipo_instrumento ti ON ti.id_tipo_instrumento = ins.id_tipo_instrumento
          INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
          INNER JOIN tbl_actividad_alumno aa ON a.id_actividad = aa.id_actividad
          WHERE aa.vchMatricula = @matricula 
          AND m.vchNomMateria = @materia
          AND ins.vchPeriodo = @periodo_alumno
          AND a.id_modalidad = 1

          UNION ALL

          -- MODALIDAD 2: EQUIPO
          SELECT 
            a.id_actividad,
            a.titulo,
            a.descripcion,
            a.id_modalidad,
            CONVERT(VARCHAR, ag.fecha_asignacion, 126) as fecha_asignacion,
            CONVERT(VARCHAR, ag.fecha_entrega, 126) as fecha_entrega,
            -- 🆕 ESTADO REAL BASADO EN CALIFICACIONES
            CASE 
              WHEN EXISTS (
                SELECT 1 FROM tbl_actividad_equipo ae_check
                INNER JOIN tbl_equipos e_check ON ae_check.id_equipo = e_check.id_equipo
                INNER JOIN tbl_equipo_alumno ea_check ON e_check.id_equipo = ea_check.id_equipo
                INNER JOIN tbl_actividad_alumno aa_check ON a.id_actividad = aa_check.id_actividad AND aa_check.vchMatricula = ea_check.vchMatricula
                INNER JOIN tbl_evaluacion_criterioActividad eca_check ON aa_check.id_actividad_alumno = eca_check.id_actividad_alumno
                WHERE ae_check.id_actividad = a.id_actividad AND ea_check.vchMatricula = @matricula
              ) THEN 'Calificada'
              ELSE ea.nombre_estado
            END as estado,
            ins.nombre as instrumento,
            ti.nombre_tipo as tipoInstrumento,
            CASE 
              WHEN ins.parcial = 1 THEN 'Parcial 1'
              WHEN ins.parcial = 2 THEN 'Parcial 2'
              WHEN ins.parcial = 3 THEN 'Parcial 3'
              ELSE 'Actividad General'
            END as parcial,
            'Equipo' as modalidad_tipo,
            2 as prioridad
          FROM tbl_actividades a
          INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
          INNER JOIN tbl_materias m ON ins.vchClvMateria = m.vchClvMateria
          INNER JOIN tbl_estado_actividad ea ON ea.id_estado_actividad = a.id_estado_actividad
          INNER JOIN tbl_tipo_instrumento ti ON ti.id_tipo_instrumento = ins.id_tipo_instrumento
          INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
          INNER JOIN tbl_actividad_equipo ae ON a.id_actividad = ae.id_actividad
          INNER JOIN tbl_equipos e ON ae.id_equipo = e.id_equipo
          INNER JOIN tbl_equipo_alumno ea_alumno ON e.id_equipo = ea_alumno.id_equipo
          WHERE ea_alumno.vchMatricula = @matricula 
          AND m.vchNomMateria = @materia
          AND ins.vchPeriodo = @periodo_alumno
          AND a.id_modalidad = 2

          UNION ALL

          -- MODALIDAD 3: GRUPO
          SELECT 
            a.id_actividad,
            a.titulo,
            a.descripcion,
            a.id_modalidad,
            CONVERT(VARCHAR, ag.fecha_asignacion, 126) as fecha_asignacion,
            CONVERT(VARCHAR, ag.fecha_entrega, 126) as fecha_entrega,
            -- 🆕 ESTADO REAL BASADO EN CALIFICACIONES
            CASE 
              WHEN EXISTS (
                SELECT 1 FROM tbl_actividad_alumno aa_check
                INNER JOIN tbl_evaluacion_criterioActividad eca_check ON aa_check.id_actividad_alumno = eca_check.id_actividad_alumno
                WHERE aa_check.id_actividad = a.id_actividad AND aa_check.vchMatricula = @matricula
              ) THEN 'Calificada'
              ELSE ea.nombre_estado
            END as estado,
            ins.nombre as instrumento,
            ti.nombre_tipo as tipoInstrumento,
            CASE 
              WHEN ins.parcial = 1 THEN 'Parcial 1'
              WHEN ins.parcial = 2 THEN 'Parcial 2'
              WHEN ins.parcial = 3 THEN 'Parcial 3'
              ELSE 'Actividad General'
            END as parcial,
            'Grupo' as modalidad_tipo,
            3 as prioridad
          FROM tbl_actividades a
          INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
          INNER JOIN tbl_materias m ON ins.vchClvMateria = m.vchClvMateria
          INNER JOIN tbl_estado_actividad ea ON ea.id_estado_actividad = a.id_estado_actividad
          INNER JOIN tbl_tipo_instrumento ti ON ti.id_tipo_instrumento = ins.id_tipo_instrumento
          INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
          INNER JOIN tbl_grupos g ON ag.id_grupo = g.id_grupo
          WHERE g.vchGrupo = @grupo_alumno 
          AND m.vchNomMateria = @materia
          AND ins.vchPeriodo = @periodo_alumno
          AND a.id_modalidad = 3
        ),
        ActividadesSinDuplicados AS (
          SELECT 
            id_actividad,
            titulo,
            descripcion,
            id_modalidad,
            fecha_asignacion,
            fecha_entrega,
            estado,
            instrumento,
            tipoInstrumento,
            parcial,
            modalidad_tipo,
            ROW_NUMBER() OVER (PARTITION BY id_actividad ORDER BY prioridad) as rn
          FROM ActividadesUnicas
        )
        SELECT 
          id_actividad,
          titulo,
          descripcion,
          id_modalidad,
          fecha_asignacion,
          fecha_entrega,
          estado,
          instrumento,
          tipoInstrumento,
          parcial,
          modalidad_tipo
        FROM ActividadesSinDuplicados
        WHERE rn = 1
        ORDER BY fecha_entrega ASC, titulo ASC
      `);

    console.log(`✅ Actividades encontradas (sin duplicados): ${result.recordset.length}`);
    
    if (result.recordset.length > 0) {
      console.log('📋 Actividades por modalidad:');
      const modalidades = result.recordset.reduce((acc, r) => {
        acc[r.modalidad_tipo] = (acc[r.modalidad_tipo] || 0) + 1;
        return acc;
      }, {});
      
      Object.entries(modalidades).forEach(([modalidad, count]) => {
        console.log(`   - ${modalidad}: ${count} actividades`);
      });

      console.log('📝 Lista de actividades encontradas:');
      result.recordset.forEach(act => {
        console.log(`   * ID: ${act.id_actividad} - ${act.titulo} (${act.modalidad_tipo}) - ${act.estado}`);
      });
    } else {
      console.log(`ℹ️ No se encontraron actividades para ${matricula} en ${materia} (periodo: ${alumno.vchPeriodo})`);
    }

    console.log('🔍 === FIN DEBUG ACTIVIDADES ===');

    res.json(result.recordset);
    
  } catch (error) {
    console.error('❌ Error al obtener actividades:', error);
    res.status(500).json({ mensaje: 'Error en el servidor al obtener actividades del alumno' });
  }
};

// Resto de funciones originales (calificaciones históricas, actividades entregadas)...
const obtenerCalificacionesHistoricas = async (req, res) => {
  const { matricula } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`🎓 === INICIO CALIFICACIONES HISTÓRICAS REALES ===`);
    console.log(`📋 Alumno: ${matricula}`);

    // PASO 1: Obtener TODAS las calificaciones reales del alumno
    const calificacionesReales = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .query(`
        SELECT 
          a.id_actividad,
          a.titulo,
          m.vchNomMateria as materia,
          i.vchPeriodo as periodo,
          CASE 
            WHEN i.parcial = 1 THEN 'Parcial 1'
            WHEN i.parcial = 2 THEN 'Parcial 2'
            WHEN i.parcial = 3 THEN 'Parcial 3'
            ELSE 'Actividad General'
          END as parcial,
          SUM(eca.calificacion) as puntos_obtenidos,
          i.valor_total as puntos_totales,
          ROUND((SUM(eca.calificacion) * 10.0) / i.valor_total, 2) as calificacion_final,
          COUNT(eca.id_criterio) as criterios_calificados,
          CONVERT(VARCHAR, ag.fecha_entrega, 126) as fecha_entrega,
          ti.nombre_tipo as tipoInstrumento,
          ins.nombre as instrumento
        FROM tbl_evaluacion_criterioActividad eca
        INNER JOIN tbl_actividad_alumno aa ON eca.id_actividad_alumno = aa.id_actividad_alumno
        INNER JOIN tbl_actividades a ON aa.id_actividad = a.id_actividad
        INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
        INNER JOIN tbl_materias m ON i.vchClvMateria = m.vchClvMateria
        INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
        INNER JOIN tbl_tipo_instrumento ti ON i.id_tipo_instrumento = ti.id_tipo_instrumento
        INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
        WHERE aa.vchMatricula = @matricula
        GROUP BY a.id_actividad, a.titulo, m.vchNomMateria, i.vchPeriodo, i.parcial, i.valor_total, ag.fecha_entrega, ti.nombre_tipo, ins.nombre
        HAVING COUNT(eca.id_criterio) > 0
        ORDER BY i.vchPeriodo DESC, i.parcial, a.titulo
      `);

    console.log(`📊 Calificaciones reales encontradas: ${calificacionesReales.recordset.length}`);

    // PASO 2: Obtener materias del alumno
    let materiasResult;
    try {
      materiasResult = await pool.request()
        .input('matricula', sql.VarChar, matricula)
        .query(`
          SELECT 
            VM.Periodo,
            VM.vchNomMateria as materia,
            VM.Docente,
            VM.Grupo,
            VM.Cuatrimestre
          FROM view_MateriasPorAlumno VM
          WHERE VM.vchMatricula = @matricula
        `);
    } catch (vistaError) {
      console.log(`⚠️ Vista no disponible`);
      materiasResult = { recordset: [] };
    }

    // PASO 3: Agrupar calificaciones por periodo y materia
    const calificacionesPorPeriodo = {};
    
    calificacionesReales.recordset.forEach(cal => {
      if (!calificacionesPorPeriodo[cal.periodo]) {
        calificacionesPorPeriodo[cal.periodo] = {
          periodo: cal.periodo,
          materias: {},
          promedio: 0
        };
      }
      
      if (!calificacionesPorPeriodo[cal.periodo].materias[cal.materia]) {
        calificacionesPorPeriodo[cal.periodo].materias[cal.materia] = {
          nombre: cal.materia,
          actividades: [],
          promedio: 0,
          estado: 'En curso',
          creditos: 5,
          docente: 'Docente Asignado',
          grupo: 'Grupo'
        };
      }
      
      calificacionesPorPeriodo[cal.periodo].materias[cal.materia].actividades.push({
        id_actividad: cal.id_actividad,
        titulo: cal.titulo,
        calificacion: cal.calificacion_final, // 🆕 REAL
        puntos_obtenidos: cal.puntos_obtenidos, // 🆕 REAL
        puntos_total: cal.puntos_totales, // 🆕 REAL
        fecha_entrega: cal.fecha_entrega,
        parcial: cal.parcial,
        modalidad: 'Real', // Indica que es calificación real
        criterios_calificados: cal.criterios_calificados, // 🆕 REAL
        instrumento: cal.instrumento,
        tipoInstrumento: cal.tipoInstrumento,
        estado: 'Calificada'
      });
    });

    // PASO 4: Completar información de materias desde la vista
    materiasResult.recordset.forEach(materia => {
      if (calificacionesPorPeriodo[materia.Periodo] && 
          calificacionesPorPeriodo[materia.Periodo].materias[materia.materia]) {
        calificacionesPorPeriodo[materia.Periodo].materias[materia.materia].docente = materia.Docente;
        calificacionesPorPeriodo[materia.Periodo].materias[materia.materia].grupo = materia.Grupo;
      }
    });

    // PASO 5: Calcular promedios reales
    const calificaciones = Object.values(calificacionesPorPeriodo).map(periodo => {
      const materiasList = Object.values(periodo.materias);
      
      materiasList.forEach(materia => {
        const sumaCalificaciones = materia.actividades.reduce((sum, act) => sum + act.calificacion, 0);
        materia.promedio = materia.actividades.length > 0 ? 
          Math.round((sumaCalificaciones / materia.actividades.length) * 10) / 10 : 0;
        materia.calificacion = materia.promedio;
        materia.estado = materia.promedio >= 6 ? 'Aprobada' : 'Reprobada';
      });
      
      const sumaPromediosMaterias = materiasList.reduce((sum, mat) => sum + mat.promedio, 0);
      periodo.promedio = materiasList.length > 0 ? 
        Math.round((sumaPromediosMaterias / materiasList.length) * 10) / 10 : 0;
      
      periodo.materias = materiasList;
      
      return periodo;
    });

    calificaciones.sort((a, b) => b.periodo.localeCompare(a.periodo));

    console.log(`✅ Calificaciones históricas REALES obtenidas:`);
    calificaciones.forEach(periodo => {
      const totalActividades = periodo.materias.reduce((sum, mat) => sum + mat.actividades.length, 0);
      console.log(`   - Periodo ${periodo.periodo}: ${periodo.materias.length} materias, ${totalActividades} actividades, promedio: ${periodo.promedio}`);
    });

    res.json(calificaciones);

  } catch (error) {
    console.error('❌ Error al obtener calificaciones históricas reales:', error);
    res.status(500).json({ 
      mensaje: 'Error en el servidor al obtener calificaciones reales',
      error: error.message 
    });
  }
};

const obtenerActividadesEntregadas = async (req, res) => {
  const { matricula } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`📝 === INICIO OBTENER ACTIVIDADES ENTREGADAS (REALES) ===`);
    console.log(`📋 Matrícula: ${matricula}`);

    // PASO 1: Obtener datos del alumno
    const alumnoResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .query(`
        SELECT 
          vchPeriodo,
          chvGrupo,
          vchClvCuatri
        FROM tblAlumnos 
        WHERE RTRIM(vchMatricula) = RTRIM(@matricula)
      `);

    if (alumnoResult.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Alumno no encontrado' });
    }

    const alumno = alumnoResult.recordset[0];

    // PASO 2: Obtener SOLO actividades que tengan calificaciones reales
    // 🔧 CORRECCIÓN: Usar GROUP BY en lugar de DISTINCT y manejar campos text
    const result = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('periodo_alumno', sql.VarChar, alumno.vchPeriodo)
      .query(`
        SELECT 
          a.id_actividad,
          a.titulo,
          -- 🔧 CAST para manejar campos text
          CAST(a.descripcion AS NVARCHAR(MAX)) as descripcion,
          CONVERT(VARCHAR, ag.fecha_entrega, 126) as fecha_entrega,
          'Calificada' as estado, -- Estado real
          ins.nombre as instrumento,
          m.vchNomMateria as materia,
          CASE 
            WHEN ins.parcial = 1 THEN 'Parcial 1'
            WHEN ins.parcial = 2 THEN 'Parcial 2'
            WHEN ins.parcial = 3 THEN 'Parcial 3'
            ELSE 'Actividad General'
          END as parcial,
          CASE 
            WHEN a.id_modalidad = 1 THEN 'Individual'
            WHEN a.id_modalidad = 2 THEN 'Equipo'
            WHEN a.id_modalidad = 3 THEN 'Grupo'
            ELSE 'Desconocida'
          END as modalidad_tipo,
          -- 🆕 CALIFICACIÓN REAL
          ROUND((SUM(eca.calificacion) * 10.0) / ins.valor_total, 2) as calificacion_real
        FROM tbl_evaluacion_criterioActividad eca
        INNER JOIN tbl_actividad_alumno aa ON eca.id_actividad_alumno = aa.id_actividad_alumno
        INNER JOIN tbl_actividades a ON aa.id_actividad = a.id_actividad
        INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
        INNER JOIN tbl_materias m ON ins.vchClvMateria = m.vchClvMateria
        INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
        WHERE aa.vchMatricula = @matricula 
        AND ins.vchPeriodo = @periodo_alumno
        -- 🔧 USAR GROUP BY en lugar de DISTINCT
        GROUP BY 
          a.id_actividad, 
          a.titulo, 
          CAST(a.descripcion AS NVARCHAR(MAX)), 
          ag.fecha_entrega, 
          ins.nombre, 
          m.vchNomMateria, 
          ins.parcial, 
          a.id_modalidad, 
          ins.valor_total
        HAVING COUNT(eca.id_criterio) > 0 -- Solo actividades calificadas
        -- 🔧 ORDER BY usando campos del SELECT
        ORDER BY ag.fecha_entrega DESC, a.titulo ASC
      `);

    console.log(`✅ Actividades entregadas y CALIFICADAS encontradas: ${result.recordset.length}`);

    // PASO 3: Agrupar por parcial con calificaciones REALES
    const actividadesPorParcial = {
      'Parcial 1': [],
      'Parcial 2': [],
      'Parcial 3': []
    };

    result.recordset.forEach(actividad => {
      if (actividadesPorParcial[actividad.parcial]) {
        actividadesPorParcial[actividad.parcial].push({
          id_actividad: actividad.id_actividad,
          titulo: actividad.titulo,
          descripcion: actividad.descripcion,
          fecha_entrega: actividad.fecha_entrega,
          estado: actividad.estado,
          instrumento: actividad.instrumento,
          materia: actividad.materia,
          modalidad: actividad.modalidad_tipo,
          calificacion: actividad.calificacion_real // 🆕 REAL
        });
      }
    });

    console.log(`📊 Distribución por parciales:`);
    Object.entries(actividadesPorParcial).forEach(([parcial, actividades]) => {
      console.log(`   - ${parcial}: ${actividades.length} actividades calificadas`);
    });

    console.log(`📝 === FIN OBTENER ACTIVIDADES ENTREGADAS (REALES) ===`);

    res.json(actividadesPorParcial);

  } catch (error) {
    console.error('❌ Error al obtener actividades entregadas:', error);
    res.status(500).json({ 
      mensaje: 'Error en el servidor al obtener actividades entregadas',
      error: error.message 
    });
  }
};

// FUNCIONES AUXILIARES PARA CALIFICACIONES DINÁMICAS
const obtenerCalificacionDesdeVista = async (pool, matricula, idActividad) => {
  try {
    const result = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('idActividad', sql.Int, idActividad)
      .query(`
        SELECT TOP 1
          CalificacionObtenida,
          PromedioActividades,
          CalificacionExamen,
          CalificacionFinal,
          ValorActividad
        FROM vw_Calificaciones_Final
        WHERE Matricula = @matricula
        AND NumeroActividad = @idActividad
      `);

    if (result.recordset.length > 0) {
      return {
        calificacionObtenida: result.recordset[0].CalificacionObtenida,
        promedioActividades: result.recordset[0].PromedioActividades,
        calificacionExamen: result.recordset[0].CalificacionExamen,
        calificacionFinal: result.recordset[0].CalificacionFinal,
        valorActividad: result.recordset[0].ValorActividad
      };
    }
    return null;
  } catch (error) {
    console.error('Error al obtener calificación desde vista:', error);
    return null;
  }
};

const obtenerDetalleActividadConCalificacion = async (req, res) => {
  const { matricula, idActividad } = req.params;

  try {
    const pool = await sql.connect(config);

    // 1. Obtener información básica de la actividad
    const actividadQuery = `
      SELECT 
        a.id_actividad, a.titulo, a.descripcion, 
        CONVERT(varchar, a.fecha_asignacion, 120) AS fecha_asignacion,
        CONVERT(varchar, a.fecha_entrega, 120) AS fecha_entrega,
        i.vchNombreInstrumento AS instrumento,
        i.vchTipoInstrumento AS tipoInstrumento,
        m.vchNomMateria AS materia,
        d.vchNombre + ' ' + d.vchAPaterno + ' ' + d.vchAMaterno AS docente,
        i.parcial,
        i.valor_total AS puntos_total,
        mod.id_modalidad, mod.vchNombreModalidad AS modalidad_nombre,
        ISNULL(aa.estado, 'pendiente') AS estado,
        CONVERT(varchar, aa.fecha_entrega, 120) AS fecha_entrega_alumno,
        CASE 
          WHEN aa.fecha_entrega IS NULL AND GETDATE() > a.fecha_entrega THEN 'vencido'
          WHEN aa.fecha_entrega IS NULL THEN 'pendiente'
          WHEN aa.fecha_entrega > a.fecha_entrega THEN 'entregado tardío'
          ELSE 'entregado'
        END AS estado_entrega
      FROM tbl_actividades a
      INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
      INNER JOIN tbl_materias m ON i.vchClvMateria = m.vchClvMateria
      INNER JOIN tbl_docentes d ON a.vchClvTrabajador = d.vchClvTrabajador
      LEFT JOIN tbl_modalidades mod ON i.id_modalidad = mod.id_modalidad
      LEFT JOIN tbl_actividad_alumno aa ON aa.id_actividad = a.id_actividad AND aa.vchMatricula = @matricula
      WHERE a.id_actividad = @idActividad
    `;

    const actividadResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('idActividad', sql.Int, idActividad)
      .query(actividadQuery);

    if (actividadResult.recordset.length === 0) {
      return res.status(404).json({ 
        mensaje: 'Actividad no encontrada o no asignada al alumno',
        codigo: 'ACTIVIDAD_NO_ENCONTRADA'
      });
    }

    let actividad = actividadResult.recordset[0];
    actividad.estado = actividad.estado_entrega; // Usamos el estado calculado

    // 2. Obtener la rúbrica/criterios de evaluación
    const rubricaQuery = `
      SELECT 
        c.id_criterio,
        c.vchCriterio AS criterio,
        c.vchDescripcion AS descripcion,
        c.decValorMaximo AS puntos,
        c.vchIcono AS icono,
        ec.calificacion AS puntos_obtenidos,
        CASE 
          WHEN ec.calificacion IS NOT NULL THEN 1
          ELSE 0
        END AS calificado,
        CASE 
          WHEN ec.calificacion >= (c.decValorMaximo * 0.6) THEN 1
          ELSE 0
        END AS cumplido
      FROM tbl_criterios c
      LEFT JOIN tbl_evaluacion_criterioActividad ec ON ec.id_criterio = c.id_criterio
          AND ec.id_actividad_alumno = (
              SELECT id_actividad_alumno 
              FROM tbl_actividad_alumno 
              WHERE id_actividad = @idActividad AND vchMatricula = @matricula
          )
      WHERE c.id_instrumento = (
          SELECT id_instrumento FROM tbl_actividades WHERE id_actividad = @idActividad
      )
      ORDER BY c.id_criterio
    `;

    const rubrica = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('idActividad', sql.Int, idActividad)
      .query(rubricaQuery);

    // 3. Obtener información de calificación desde vw_Calificaciones_Final
    const calificacionData = await obtenerCalificacionDesdeVista(pool, matricula, idActividad);

    // 4. Calcular información de criterios
    const criteriosCalificados = rubrica.recordset.filter(c => c.calificado).length;
    const totalCriterios = rubrica.recordset.length;
    const tieneCriterios = totalCriterios > 0;

    let mensajeEstado = '';
    if (tieneCriterios) {
      if (criteriosCalificados === totalCriterios) {
        mensajeEstado = 'Todos los criterios han sido calificados';
      } else if (criteriosCalificados > 0) {
        mensajeEstado = `Parcialmente calificada (${criteriosCalificados}/${totalCriterios} criterios)`;
      } else {
        mensajeEstado = 'Criterios definidos pero aún no calificados';
      }
    } else {
      mensajeEstado = 'Esta actividad no tiene criterios específicos de evaluación';
    }

    // 5. Preparar respuesta
    const response = {
      ...actividad,
      rubrica: rubrica.recordset,
      criterios_info: {
        instrumento_tiene_criterios: tieneCriterios,
        total_criterios_definidos: totalCriterios,
        criterios_calificados: criteriosCalificados,
        mensaje_estado: mensajeEstado,
        mostrar_rubrica: tieneCriterios,
        tipo_rubrica: 'real'
      }
    };

    // 6. Agregar información de calificación si existe
    if (calificacionData) {
      response.tiene_calificacion = true;
      response.calificacion_info = {
        puntos_obtenidos: calificacionData.calificacionObtenida || 0,
        calificacion_sobre_10: calificacionData.calificacionFinal || 0,
        criterios_calificados: criteriosCalificados,
        valor_actividad: calificacionData.valorActividad || 0
      };
      
      // Actualizar estado si está calificada
      if (response.estado !== 'calificada' && calificacionData.calificacionFinal !== null) {
        response.estado = 'calificada';
      }
    } else {
      response.tiene_calificacion = false;
    }

    res.json(response);

  } catch (error) {
    console.error('Error en obtenerDetalleActividadConCalificacion:', error);
    res.status(500).json({ 
      mensaje: 'Error al obtener la actividad',
      error: error.message,
      codigo: 'ERROR_SERVIDOR'
    });
  }
};

const obtenerActividadEntregadaConCalificacion = async (req, res) => {
  const { matricula, idActividad } = req.params;

  try {
    const pool = await sql.connect(config);

    // 1. Verificar si la actividad está entregada
    const entregaQuery = `
      SELECT 
        estado, 
        CONVERT(varchar, fecha_entrega, 120) AS fecha_entrega,
        observaciones, 
        retroalimentacion
      FROM tbl_actividad_alumno
      WHERE id_actividad = @idActividad AND vchMatricula = @matricula
    `;

    const entregaResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('idActividad', sql.Int, idActividad)
      .query(entregaQuery);

    if (entregaResult.recordset.length === 0 || entregaResult.recordset[0].estado === 'pendiente') {
      return res.status(404).json({ 
        mensaje: 'La actividad no ha sido entregada o no existe',
        codigo: 'ACTIVIDAD_NO_ENTREGADA'
      });
    }

    // 2. Obtener información básica de la actividad
    const actividadQuery = `
      SELECT 
        a.id_actividad, a.titulo, a.descripcion, 
        CONVERT(varchar, a.fecha_asignacion, 120) AS fecha_asignacion,
        CONVERT(varchar, a.fecha_entrega, 120) AS fecha_entrega,
        i.vchNombreInstrumento AS instrumento,
        i.vchTipoInstrumento AS tipoInstrumento,
        m.vchNomMateria AS materia,
        d.vchNombre + ' ' + d.vchAPaterno + ' ' + d.vchAMaterno AS docente,
        i.parcial,
        i.valor_total AS puntos_total,
        mod.id_modalidad, mod.vchNombreModalidad AS modalidad_nombre,
        aa.estado,
        CONVERT(varchar, aa.fecha_entrega, 120) AS fecha_entrega_alumno,
        aa.observaciones,
        aa.retroalimentacion,
        CASE 
          WHEN aa.fecha_entrega <= a.fecha_entrega THEN 1
          ELSE 0
        END AS entrega_puntual
      FROM tbl_actividades a
      INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
      INNER JOIN tbl_materias m ON i.vchClvMateria = m.vchClvMateria
      INNER JOIN tbl_docentes d ON a.vchClvTrabajador = d.vchClvTrabajador
      LEFT JOIN tbl_modalidades mod ON i.id_modalidad = mod.id_modalidad
      INNER JOIN tbl_actividad_alumno aa ON aa.id_actividad = a.id_actividad AND aa.vchMatricula = @matricula
      WHERE a.id_actividad = @idActividad
    `;

    const actividadResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('idActividad', sql.Int, idActividad)
      .query(actividadQuery);

    if (actividadResult.recordset.length === 0) {
      return res.status(404).json({ 
        mensaje: 'Actividad no encontrada',
        codigo: 'ACTIVIDAD_NO_ENCONTRADA'
      });
    }

    const actividad = actividadResult.recordset[0];

    // 3. Obtener calificación desde vw_Calificaciones_Final
    const calificacionData = await obtenerCalificacionDesdeVista(pool, matricula, idActividad);

    if (!calificacionData) {
      return res.status(404).json({ 
        mensaje: 'La actividad no ha sido calificada aún',
        codigo: 'SIN_CALIFICAR'
      });
    }

    // 4. Obtener la rúbrica/criterios de evaluación
    const rubricaQuery = `
      SELECT 
        c.vchCriterio AS criterio,
        c.vchDescripcion AS descripcion,
        c.decValorMaximo AS puntos_maximos,
        ec.calificacion AS puntos_obtenidos,
        CASE 
          WHEN ec.calificacion >= (c.decValorMaximo * 0.6) THEN 1
          ELSE 0
        END AS cumplido,
        c.vchIcono AS icono,
        1 AS calificado
      FROM tbl_criterios c
      INNER JOIN tbl_evaluacion_criterioActividad ec ON ec.id_criterio = c.id_criterio
      WHERE ec.id_actividad_alumno = (
        SELECT id_actividad_alumno 
        FROM tbl_actividad_alumno 
        WHERE id_actividad = @idActividad AND vchMatricula = @matricula
      )
      ORDER BY c.id_criterio
    `;

    const rubrica = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('idActividad', sql.Int, idActividad)
      .query(rubricaQuery);

    // 5. Calcular información de criterios
    const criteriosCalificados = rubrica.recordset.length;
    const totalCriteriosResult = await pool.request()
      .input('idActividad', sql.Int, idActividad)
      .query(`
        SELECT COUNT(*) AS total 
        FROM tbl_criterios 
        WHERE id_instrumento = (
          SELECT id_instrumento FROM tbl_actividades WHERE id_actividad = @idActividad
        )
      `);
    const totalCriterios = totalCriteriosResult.recordset[0]?.total || 0;

    // 6. Preparar respuesta
    const response = {
      ...actividad,
      puntos_obtenidos: calificacionData.calificacionObtenida || 0,
      calificacion: calificacionData.calificacionFinal || 0,
      rubrica: rubrica.recordset,
      criterios_calificados: criteriosCalificados,
      total_criterios: totalCriterios,
      fuente_calificacion: 'BD_REAL',
      valor_actividad: calificacionData.valorActividad || 0
    };

    res.json(response);

  } catch (error) {
    console.error('Error en obtenerActividadEntregadaConCalificacion:', error);
    res.status(500).json({ 
      mensaje: 'Error al obtener la actividad entregada',
      error: error.message,
      codigo: 'ERROR_SERVIDOR'
    });
  }
};

module.exports = {
  obtenerDatosAlumno,
  cambiarContrasena,
  obtenerActividadesPorAlumno,
  obtenerCalificacionesHistoricas, 
  obtenerDetalleActividad,
  obtenerActividadesEntregadas,
  obtenerActividadEntregada,
  obtenerCalificacionDesdeVista,
  obtenerDetalleActividadConCalificacion,
  
};