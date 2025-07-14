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
// FUNCIÓN PARA CALCULAR ESTADOS DINÁMICOS
// ===============================================
const calcularEstadoDinamico = (fechaEntrega, tieneCalificacion, estadoOriginal = 'Pendiente') => {
  const ahora = new Date();
  const fechaLimite = new Date(fechaEntrega);
  const diferenciasHoras = (fechaLimite - ahora) / (1000 * 60 * 60);
  const diferenciasDias = Math.floor(diferenciasHoras / 24);

  // Si ya está calificado -> CALIFICADA
  if (tieneCalificacion) {
    return {
      estado: 'Calificada',
      mensaje: 'Esta actividad ya ha sido calificada por el profesor.',
      color: '#009944',
      icono: '✅',
      urgencia: 6
    };
  }

  // Si ya venció la fecha y NO está calificado -> VENCIDA
  if (diferenciasHoras < 0) {
    const diasVencidos = Math.floor(Math.abs(diferenciasHoras) / 24);
    return {
      estado: 'Vencida',
      mensaje: diasVencidos > 0 
        ? `Venció hace ${diasVencidos} día${diasVencidos > 1 ? 's' : ''}.`
        : `Venció hace ${Math.floor(Math.abs(diferenciasHoras))} horas.`,
      color: '#d9534f',
      icono: '❌',
      urgencia: 1
    };
  }

  // Si está por vencer (menos de 6 horas) -> MUY URGENTE
  if (diferenciasHoras <= 6) {
    return {
      estado: 'Muy Urgente',
      mensaje: `¡URGENTE! Vence en ${Math.floor(diferenciasHoras)} horas`,
      color: '#dc3545',
      icono: '🚨',
      urgencia: 2
    };
  }

  // Si está por vencer (menos de 24 horas) -> URGENTE
  if (diferenciasHoras <= 24) {
    return {
      estado: 'Urgente',
      mensaje: `Vence HOY en ${Math.floor(diferenciasHoras)} horas`,
      color: '#ff6b35',
      icono: '⚠️',
      urgencia: 3
    };
  }

  // Si está por vencer (menos de 3 días) -> POR VENCER
  if (diferenciasDias <= 3) {
    return {
      estado: 'Por Vencer',
      mensaje: `Vence en ${diferenciasDias} día${diferenciasDias > 1 ? 's' : ''}`,
      color: '#f0ad4e',
      icono: '⏰',
      urgencia: 4
    };
  }

  // Si tiene tiempo suficiente -> PENDIENTE
  return {
    estado: 'Pendiente',
    mensaje: `Vence en ${diferenciasDias} días. Tiempo suficiente`,
    color: '#007bff',
    icono: '📝',
    urgencia: 5
  };
};

// ===============================================
// FUNCIÓN PARA OBTENER FECHAS DEL CUATRIMESTRE
// ===============================================
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

// ===============================================
// FUNCIONES PRINCIPALES DEL CONTROLLER
// ===============================================
// 🔧 FUNCIÓN CORREGIDA: obtenerDatosAlumno - Con consulta directa en lugar de vista defectuosa
const obtenerDatosAlumno = async (req, res) => {
  const { matricula } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`🔍 === INICIO DATOS ALUMNO (CONSULTA DIRECTA) ===`);
    console.log(`📋 Matrícula: ${matricula}`);

    // PASO 1: Consulta del alumno (sin cambios)
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

    console.log(`✅ Alumno encontrado: ${alumnoData.nombre}`);
    console.log(`📅 Período actual: ${alumnoData.periodo}`);

    const fechasCuatrimestre = await obtenerFechasCuatrimestre(pool, alumnoData.periodo, alumnoData.cuatrimestre);

    // 🔧 PASO 2: CONSULTA DIRECTA EN LUGAR DE LA VISTA DEFECTUOSA
    console.log(`🔍 Obteniendo materias del período actual con consulta directa...`);
    
    const materiasResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('periodo_actual', sql.VarChar, alumnoData.periodo)
      .query(`
        WITH MateriasDelAlumno AS (
          -- Materias por actividades INDIVIDUALES
          SELECT DISTINCT
            M.vchNomMateria,
            CONCAT(D.vchAPaterno, ' ', D.vchAMaterno, ' ', D.vchNombre) AS Docente,
            'Individual' as TipoAcceso,
            1 as Prioridad
          FROM tblAlumnos A
          INNER JOIN tbl_actividad_alumno AA ON AA.vchMatricula = A.vchMatricula
          INNER JOIN tbl_actividades AC ON AC.id_actividad = AA.id_actividad
          INNER JOIN tbl_instrumento I ON I.id_instrumento = AC.id_instrumento
          INNER JOIN tbl_materias M ON M.vchClvMateria = I.vchClvMateria
          INNER JOIN tbl_docentes D ON D.vchClvTrabajador = AC.vchClvTrabajador
          WHERE A.vchMatricula = @matricula 
            AND I.vchPeriodo = @periodo_actual

          UNION

          -- Materias por actividades de EQUIPO
          SELECT DISTINCT
            M.vchNomMateria,
            CONCAT(D.vchAPaterno, ' ', D.vchAMaterno, ' ', D.vchNombre) AS Docente,
            'Equipo' as TipoAcceso,
            2 as Prioridad
          FROM tblAlumnos A
          INNER JOIN tbl_equipo_alumno EA ON EA.vchMatricula = A.vchMatricula
          INNER JOIN tbl_equipos E ON E.id_equipo = EA.id_equipo
          INNER JOIN tbl_actividad_equipo AE ON AE.id_equipo = E.id_equipo
          INNER JOIN tbl_actividades AC ON AC.id_actividad = AE.id_actividad
          INNER JOIN tbl_instrumento I ON I.id_instrumento = AC.id_instrumento
          INNER JOIN tbl_materias M ON M.vchClvMateria = I.vchClvMateria
          INNER JOIN tbl_docentes D ON D.vchClvTrabajador = AC.vchClvTrabajador
          WHERE A.vchMatricula = @matricula 
            AND I.vchPeriodo = @periodo_actual

          UNION

          -- Materias por actividades de GRUPO
          SELECT DISTINCT
            M.vchNomMateria,
            CONCAT(D.vchAPaterno, ' ', D.vchAMaterno, ' ', D.vchNombre) AS Docente,
            'Grupo' as TipoAcceso,
            3 as Prioridad
          FROM tblAlumnos A
          INNER JOIN tbl_grupos G ON G.vchGrupo = A.chvGrupo
          INNER JOIN tbl_actividad_grupo AG ON AG.id_grupo = G.id_grupo
          INNER JOIN tbl_actividades AC ON AC.id_actividad = AG.id_actividad
          INNER JOIN tbl_instrumento I ON I.id_instrumento = AC.id_instrumento
          INNER JOIN tbl_materias M ON M.vchClvMateria = I.vchClvMateria
          INNER JOIN tbl_docentes D ON D.vchClvTrabajador = AC.vchClvTrabajador
          WHERE A.vchMatricula = @matricula 
            AND I.vchPeriodo = @periodo_actual
        ),
        MateriasSinDuplicados AS (
          SELECT 
            vchNomMateria,
            Docente,
            TipoAcceso,
            ROW_NUMBER() OVER (PARTITION BY vchNomMateria ORDER BY Prioridad) as rn
          FROM MateriasDelAlumno
        )
        SELECT 
          vchNomMateria as nombreMateria,
          Docente,
          TipoAcceso,
          'Grupo' as Grupo  -- Valor por defecto, podría mejorarse
        FROM MateriasSinDuplicados
        WHERE rn = 1
        ORDER BY vchNomMateria
      `);

    console.log(`📚 Materias encontradas con consulta directa: ${materiasResult.recordset.length}`);
    materiasResult.recordset.forEach(m => {
      console.log(`   - ${m.nombreMateria} (Acceso: ${m.TipoAcceso}, Docente: ${m.Docente})`);
    });

    // PASO 3: Formatear materias
    const materias = materiasResult.recordset.map(m => ({
      nombre: m.nombreMateria,
      grupo: m.Grupo,
      profesor: m.Docente,
      icono: m.nombreMateria.charAt(0),
      tipoAcceso: m.TipoAcceso // Información adicional para debug
    }));

    console.log(`✅ ${materias.length} materias del período actual procesadas correctamente`);
    console.log(`🔍 === FIN DATOS ALUMNO (CONSULTA DIRECTA) ===`);

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
      },
      // 🆕 Información de diagnóstico
      diagnostico: {
        fuente_materias: 'CONSULTA_DIRECTA',
        total_materias_encontradas: materias.length,
        problema_vista_detectado: true
      }
    });

  } catch (err) {
    console.error('❌ Error al obtener datos del alumno:', err);
    res.status(500).json({ mensaje: 'Error en el servidor al consultar alumno' });
  }
};

// 🔧 FUNCIÓN CORREGIDA: obtenerActividadesEntregadas - Solo período actual
const obtenerActividadesEntregadas = async (req, res) => {
  const { matricula } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`📝 === INICIO OBTENER ACTIVIDADES ENTREGADAS (PERÍODO ACTUAL) ===`);
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
    console.log(`📅 Filtrando por período actual: ${alumno.vchPeriodo}`);

    // PASO 2: SOLO actividades calificadas del período actual
    const result = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('periodo_alumno', sql.VarChar, alumno.vchPeriodo)
      .query(`
        SELECT 
          a.id_actividad,
          a.titulo,
          CAST(a.descripcion AS NVARCHAR(MAX)) as descripcion,
          CONVERT(VARCHAR, ag.fecha_entrega, 126) as fecha_entrega,
          'Calificada' as estado,
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
          ROUND((SUM(eca.calificacion) * 10.0) / ins.valor_total, 2) as calificacion_real,
          ag.fecha_entrega as fecha_orden
        FROM tbl_evaluacion_criterioActividad eca
        INNER JOIN tbl_actividad_alumno aa ON eca.id_actividad_alumno = aa.id_actividad_alumno
        INNER JOIN tbl_actividades a ON aa.id_actividad = a.id_actividad
        INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
        INNER JOIN tbl_materias m ON ins.vchClvMateria = m.vchClvMateria
        INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
        WHERE aa.vchMatricula = @matricula 
        AND ins.vchPeriodo = @periodo_alumno
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
        HAVING COUNT(eca.id_criterio) > 0
        ORDER BY fecha_orden DESC, a.titulo ASC
      `);

    console.log(`✅ Actividades entregadas y CALIFICADAS encontradas (período actual): ${result.recordset.length}`);

    // Debug por materias
    const materiasCounts = result.recordset.reduce((acc, act) => {
      acc[act.materia] = (acc[act.materia] || 0) + 1;
      return acc;
    }, {});
    console.log(`📚 Distribución por materias (período actual):`);
    Object.entries(materiasCounts).forEach(([materia, count]) => {
      console.log(`   - ${materia}: ${count} actividades`);
    });

    // Si no hay actividades, retornar estructura vacía pero exitosa
    if (result.recordset.length === 0) {
      console.log(`ℹ️ No hay actividades entregadas para ${matricula} en período ${alumno.vchPeriodo}`);
      return res.json({
        'Parcial 1': [],
        'Parcial 2': [],
        'Parcial 3': []
      });
    }

    // PASO 3: Agrupar por parcial
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
          calificacion: actividad.calificacion_real
        });
      }
    });

    console.log(`📊 Distribución por parciales (período actual):`);
    Object.entries(actividadesPorParcial).forEach(([parcial, actividades]) => {
      console.log(`   - ${parcial}: ${actividades.length} actividades calificadas`);
    });

    console.log(`📝 === FIN OBTENER ACTIVIDADES ENTREGADAS (PERÍODO ACTUAL) ===`);

    res.json(actividadesPorParcial);

  } catch (error) {
    console.error('❌ Error al obtener actividades entregadas:', error);
    res.status(500).json({ 
      mensaje: 'Error en el servidor al obtener actividades entregadas',
      error: error.message 
    });
  }
};

const obtenerCalificacionesHistoricas = async (req, res) => {
  const { matricula } = req.params;
  const { todos_periodos } = req.query;

  try {
    console.log(`🎓 === INICIO CALIFICACIONES CORREGIDAS (TODAS LAS ACTIVIDADES) ===`);
    console.log(`📋 Parámetros: matricula=${matricula}, todos_periodos=${todos_periodos}`);
    
    const pool = await sql.connect(config);

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
      console.log(`❌ Alumno no encontrado`);
      return res.status(404).json({ mensaje: 'Alumno no encontrado' });
    }

    const alumno = alumnoResult.recordset[0];
    console.log(`✅ Alumno encontrado: período=${alumno.vchPeriodo}, grupo=${alumno.chvGrupo}`);
    
    // PASO 2: Construir filtro de período DINÁMICO
    let filtroperiodo = '';
    if (!todos_periodos || todos_periodos !== 'true') {
      filtroperiodo = `AND i.vchPeriodo = @periodo_alumno`;
      console.log(`📅 Filtrando solo período actual: ${alumno.vchPeriodo}`);
    } else {
      console.log(`📅 Obteniendo TODOS los períodos`);
    }

    // PASO 3: CONSULTA CORREGIDA - INCLUYENDO TODAS LAS ACTIVIDADES (CALIFICADAS Y NO CALIFICADAS)
    console.log(`🔍 Ejecutando consulta principal (TODAS LAS ACTIVIDADES)...`);
    
    const todasLasActividades = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('periodo_alumno', sql.VarChar, alumno.vchPeriodo)
      .query(`
        WITH TodasLasActividadesDelAlumno AS (
          -- MODALIDAD 1: INDIVIDUAL
          SELECT DISTINCT
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
            -- 🆕 CALIFICACIÓN CON LEFT JOIN (puede ser NULL)
            ISNULL(SUM(eca.calificacion), 0) as puntos_obtenidos,
            i.valor_total as puntos_totales,
            CASE 
              WHEN SUM(eca.calificacion) IS NOT NULL THEN 
                ROUND((SUM(eca.calificacion) * 10.0) / i.valor_total, 2)
              ELSE 0 
            END as calificacion_final,
            COUNT(eca.id_criterio) as criterios_calificados,
            CONVERT(VARCHAR, ag.fecha_entrega, 126) as fecha_entrega,
            ti.nombre_tipo as tipoInstrumento,
            ins.nombre as instrumento,
            CONCAT(d.vchNombre, ' ', d.vchAPaterno, ' ', ISNULL(d.vchAMaterno, '')) AS Docente,
            'Individual' as modalidad_tipo,
            -- 🆕 ESTADO BASADO EN CALIFICACIÓN
            CASE 
              WHEN COUNT(eca.id_criterio) > 0 THEN 'Calificada'
              ELSE 'Pendiente'
            END as estado,
            1 as prioridad
          FROM tbl_actividades a
          INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
          INNER JOIN tbl_materias m ON i.vchClvMateria = m.vchClvMateria
          INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
          INNER JOIN tbl_tipo_instrumento ti ON i.id_tipo_instrumento = ti.id_tipo_instrumento
          INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
          INNER JOIN tbl_docentes d ON d.vchClvTrabajador = a.vchClvTrabajador
          INNER JOIN tbl_actividad_alumno aa ON a.id_actividad = aa.id_actividad
          -- 🔧 LEFT JOIN PARA INCLUIR ACTIVIDADES SIN CALIFICAR
          LEFT JOIN tbl_evaluacion_criterioActividad eca ON eca.id_actividad_alumno = aa.id_actividad_alumno
          WHERE aa.vchMatricula = @matricula
          AND a.id_modalidad = 1  -- Solo Individual
          ${filtroperiodo}
          GROUP BY a.id_actividad, a.titulo, m.vchNomMateria, i.vchPeriodo, i.parcial, i.valor_total, ag.fecha_entrega, ti.nombre_tipo, ins.nombre, d.vchNombre, d.vchAPaterno, d.vchAMaterno

          UNION

          -- MODALIDAD 2: EQUIPO
          SELECT DISTINCT
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
            -- 🆕 CALIFICACIÓN CON LEFT JOIN (puede ser NULL)
            ISNULL(SUM(eceq.calificacion), 0) as puntos_obtenidos,
            i.valor_total as puntos_totales,
            CASE 
              WHEN SUM(eceq.calificacion) IS NOT NULL THEN 
                ROUND((SUM(eceq.calificacion) * 10.0) / i.valor_total, 2)
              ELSE 0 
            END as calificacion_final,
            COUNT(eceq.id_criterio) as criterios_calificados,
            CONVERT(VARCHAR, ag.fecha_entrega, 126) as fecha_entrega,
            ti.nombre_tipo as tipoInstrumento,
            ins.nombre as instrumento,
            CONCAT(d.vchNombre, ' ', d.vchAPaterno, ' ', ISNULL(d.vchAMaterno, '')) AS Docente,
            'Equipo' as modalidad_tipo,
            -- 🆕 ESTADO BASADO EN CALIFICACIÓN
            CASE 
              WHEN COUNT(eceq.id_criterio) > 0 THEN 'Calificada'
              ELSE 'Pendiente'
            END as estado,
            2 as prioridad
          FROM tbl_actividades a
          INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
          INNER JOIN tbl_materias m ON i.vchClvMateria = m.vchClvMateria
          INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
          INNER JOIN tbl_tipo_instrumento ti ON i.id_tipo_instrumento = ti.id_tipo_instrumento
          INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
          INNER JOIN tbl_docentes d ON d.vchClvTrabajador = a.vchClvTrabajador
          INNER JOIN tbl_actividad_equipo ae ON a.id_actividad = ae.id_actividad
          INNER JOIN tbl_equipos eq ON ae.id_equipo = eq.id_equipo
          INNER JOIN tbl_equipo_alumno ea ON eq.id_equipo = ea.id_equipo
          -- 🔧 LEFT JOIN PARA INCLUIR ACTIVIDADES SIN CALIFICAR
          LEFT JOIN tbl_evaluacion_criterioActividadEquipo eceq ON eceq.id_actividad_equipo = ae.id_actividad_equipo AND eceq.id_equipo = eq.id_equipo
          WHERE ea.vchMatricula = @matricula
          AND a.id_modalidad = 2  -- Solo Equipo
          ${filtroperiodo}
          GROUP BY a.id_actividad, a.titulo, m.vchNomMateria, i.vchPeriodo, i.parcial, i.valor_total, ag.fecha_entrega, ti.nombre_tipo, ins.nombre, d.vchNombre, d.vchAPaterno, d.vchAMaterno

          UNION

          -- MODALIDAD 3: GRUPO  
          SELECT DISTINCT
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
            -- 🆕 CALIFICACIÓN CON LEFT JOIN (puede ser NULL)
            ISNULL(SUM(eca.calificacion), 0) as puntos_obtenidos,
            i.valor_total as puntos_totales,
            CASE 
              WHEN SUM(eca.calificacion) IS NOT NULL THEN 
                ROUND((SUM(eca.calificacion) * 10.0) / i.valor_total, 2)
              ELSE 0 
            END as calificacion_final,
            COUNT(eca.id_criterio) as criterios_calificados,
            CONVERT(VARCHAR, ag.fecha_entrega, 126) as fecha_entrega,
            ti.nombre_tipo as tipoInstrumento,
            ins.nombre as instrumento,
            CONCAT(d.vchNombre, ' ', d.vchAPaterno, ' ', ISNULL(d.vchAMaterno, '')) AS Docente,
            'Grupo' as modalidad_tipo,
            -- 🆕 ESTADO BASADO EN CALIFICACIÓN
            CASE 
              WHEN COUNT(eca.id_criterio) > 0 THEN 'Calificada'
              ELSE 'Pendiente'
            END as estado,
            3 as prioridad
          FROM tbl_actividades a
          INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
          INNER JOIN tbl_materias m ON i.vchClvMateria = m.vchClvMateria
          INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
          INNER JOIN tbl_grupos g ON ag.id_grupo = g.id_grupo
          INNER JOIN tbl_tipo_instrumento ti ON i.id_tipo_instrumento = ti.id_tipo_instrumento
          INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
          INNER JOIN tbl_docentes d ON d.vchClvTrabajador = a.vchClvTrabajador
          INNER JOIN tblAlumnos al ON al.vchMatricula = @matricula
          INNER JOIN tbl_actividad_alumno aa ON a.id_actividad = aa.id_actividad AND aa.vchMatricula = @matricula
          -- 🔧 LEFT JOIN PARA INCLUIR ACTIVIDADES SIN CALIFICAR
          LEFT JOIN tbl_evaluacion_criterioActividad eca ON eca.id_actividad_alumno = aa.id_actividad_alumno
          WHERE g.vchGrupo = al.chvGrupo
          AND a.id_modalidad = 3  -- Solo Grupo
          ${filtroperiodo}
          GROUP BY a.id_actividad, a.titulo, m.vchNomMateria, i.vchPeriodo, i.parcial, i.valor_total, ag.fecha_entrega, ti.nombre_tipo, ins.nombre, d.vchNombre, d.vchAPaterno, d.vchAMaterno
        ),
        ActividadesSinDuplicados AS (
          SELECT 
            id_actividad,
            titulo,
            materia,
            periodo,
            parcial,
            puntos_obtenidos,
            puntos_totales,
            calificacion_final,
            criterios_calificados,
            fecha_entrega,
            tipoInstrumento,
            instrumento,
            Docente,
            modalidad_tipo,
            estado,
            ROW_NUMBER() OVER (PARTITION BY id_actividad ORDER BY prioridad) as rn
          FROM TodasLasActividadesDelAlumno
        )
        SELECT *
        FROM ActividadesSinDuplicados
        WHERE rn = 1
        ORDER BY periodo DESC, parcial, titulo
      `);

    console.log(`📊 Consulta ejecutada. Registros encontrados: ${todasLasActividades.recordset.length}`);

    // PASO 4: Validación de datos
    if (todasLasActividades.recordset.length === 0) {
      console.log(`⚠️ No se encontraron actividades para ${matricula}`);
      return res.json([]);
    }

    // PASO 5: Debug por períodos encontrados
    const periodos = [...new Set(todasLasActividades.recordset.map(cal => cal.periodo))];
    console.log(`📅 Períodos en los datos: ${periodos.join(', ')}`);
    console.log(`📅 Filtro aplicado: ${todos_periodos === 'true' ? 'TODOS LOS PERÍODOS' : 'SOLO ' + alumno.vchPeriodo}`);

    // PASO 6: Obtener información de materias con docentes (IGUAL QUE ANTES)
    console.log(`🔍 Obteniendo información de materias con docentes...`);
    
    const periodosFiltro = todos_periodos === 'true' ? 
      periodos.map(p => `'${p}'`).join(',') :
      `'${alumno.vchPeriodo}'`;

    let materiasResult = { recordset: [] };
    
    if (periodosFiltro && todasLasActividades.recordset.length > 0) {
      try {
        materiasResult = await pool.request()
          .input('matricula', sql.VarChar, matricula)
          .query(`
            WITH MateriasConDocentes AS (
              -- Materias por actividades INDIVIDUALES
              SELECT DISTINCT
                I.vchPeriodo as Periodo,
                M.vchNomMateria as materia,
                CONCAT(D.vchNombre, ' ', D.vchAPaterno, ' ', ISNULL(D.vchAMaterno, '')) AS Docente,
                'Grupo' as Grupo,
                A.vchClvCuatri as Cuatrimestre,
                1 as Prioridad
              FROM tblAlumnos A
              INNER JOIN tbl_actividad_alumno AA ON AA.vchMatricula = A.vchMatricula
              INNER JOIN tbl_actividades AC ON AC.id_actividad = AA.id_actividad
              INNER JOIN tbl_instrumento I ON I.id_instrumento = AC.id_instrumento
              INNER JOIN tbl_materias M ON M.vchClvMateria = I.vchClvMateria
              INNER JOIN tbl_docentes D ON D.vchClvTrabajador = AC.vchClvTrabajador
              WHERE A.vchMatricula = @matricula 
                AND I.vchPeriodo IN (${periodosFiltro})

              UNION

              -- Materias por actividades de EQUIPO
              SELECT DISTINCT
                I.vchPeriodo as Periodo,
                M.vchNomMateria as materia,
                CONCAT(D.vchNombre, ' ', D.vchAPaterno, ' ', ISNULL(D.vchAMaterno, '')) AS Docente,
                'Grupo' as Grupo,
                A.vchClvCuatri as Cuatrimestre,
                2 as Prioridad
              FROM tblAlumnos A
              INNER JOIN tbl_equipo_alumno EA ON EA.vchMatricula = A.vchMatricula
              INNER JOIN tbl_equipos E ON E.id_equipo = EA.id_equipo
              INNER JOIN tbl_actividad_equipo AE ON AE.id_equipo = E.id_equipo
              INNER JOIN tbl_actividades AC ON AC.id_actividad = AE.id_actividad
              INNER JOIN tbl_instrumento I ON I.id_instrumento = AC.id_instrumento
              INNER JOIN tbl_materias M ON M.vchClvMateria = I.vchClvMateria
              INNER JOIN tbl_docentes D ON D.vchClvTrabajador = AC.vchClvTrabajador
              WHERE A.vchMatricula = @matricula 
                AND I.vchPeriodo IN (${periodosFiltro})

              UNION

              -- Materias por actividades de GRUPO
              SELECT DISTINCT
                I.vchPeriodo as Periodo,
                M.vchNomMateria as materia,
                CONCAT(D.vchNombre, ' ', D.vchAPaterno, ' ', ISNULL(D.vchAMaterno, '')) AS Docente,
                'Grupo' as Grupo,
                A.vchClvCuatri as Cuatrimestre,
                3 as Prioridad
              FROM tblAlumnos A
              INNER JOIN tbl_grupos G ON G.vchGrupo = A.chvGrupo
              INNER JOIN tbl_actividad_grupo AG ON AG.id_grupo = G.id_grupo
              INNER JOIN tbl_actividades AC ON AC.id_actividad = AG.id_actividad
              INNER JOIN tbl_instrumento I ON I.id_instrumento = AC.id_instrumento
              INNER JOIN tbl_materias M ON M.vchClvMateria = I.vchClvMateria
              INNER JOIN tbl_docentes D ON D.vchClvTrabajador = AC.vchClvTrabajador
              WHERE A.vchMatricula = @matricula 
                AND I.vchPeriodo IN (${periodosFiltro})
            ),
            MateriasSinDuplicados AS (
              SELECT 
                Periodo, materia, Docente, Grupo, Cuatrimestre,
                ROW_NUMBER() OVER (PARTITION BY Periodo, materia ORDER BY Prioridad) as rn
              FROM MateriasConDocentes
            )
            SELECT Periodo, materia, Docente, Grupo, Cuatrimestre
            FROM MateriasSinDuplicados
            WHERE rn = 1
            ORDER BY Periodo DESC, materia
          `);
          
        console.log(`📚 Materias con docentes encontradas: ${materiasResult.recordset.length}`);
      } catch (consultaError) {
        console.log(`⚠️ Error en consulta de materias:`, consultaError.message);
      }
    }

    // PASO 7: Agrupar TODAS las actividades por período (CALIFICADAS Y PENDIENTES)
    console.log(`🔄 Procesando y agrupando TODAS las actividades...`);
    const calificacionesPorPeriodo = {};
    
    todasLasActividades.recordset.forEach(act => {
      if (!calificacionesPorPeriodo[act.periodo]) {
        calificacionesPorPeriodo[act.periodo] = {
          periodo: act.periodo,
          materias: {},
          promedio: 0
        };
      }
      
      if (!calificacionesPorPeriodo[act.periodo].materias[act.materia]) {
        calificacionesPorPeriodo[act.periodo].materias[act.materia] = {
          nombre: act.materia,
          actividades: [],
          promedio: 0,
          estado: 'En curso',
          creditos: 5,
          docente: act.Docente || 'Docente Asignado',
          grupo: 'Grupo'
        };
      }
      
      // VERIFICAR QUE NO ESTÁ DUPLICADA
      const actividadExiste = calificacionesPorPeriodo[act.periodo].materias[act.materia].actividades
        .some(actividad => actividad.id_actividad === act.id_actividad);
      
      if (!actividadExiste) {
        calificacionesPorPeriodo[act.periodo].materias[act.materia].actividades.push({
          id_actividad: act.id_actividad,
          titulo: act.titulo,
          calificacion: act.calificacion_final,
          puntos_obtenidos: act.puntos_obtenidos,
          puntos_total: act.puntos_totales,
          fecha_entrega: act.fecha_entrega,
          parcial: act.parcial,
          modalidad: act.modalidad_tipo,
          criterios_calificados: act.criterios_calificados,
          instrumento: act.instrumento,
          tipoInstrumento: act.tipoInstrumento,
          estado: act.estado // 🆕 'Calificada' o 'Pendiente'
        });
      }
    });

    console.log(`📊 Períodos procesados: ${Object.keys(calificacionesPorPeriodo).length}`);

    // PASO 8: Agregar información de docentes (IGUAL QUE ANTES)
    materiasResult.recordset.forEach(materia => {
      if (calificacionesPorPeriodo[materia.Periodo] && 
          calificacionesPorPeriodo[materia.Periodo].materias[materia.materia]) {
        calificacionesPorPeriodo[materia.Periodo].materias[materia.materia].docente = materia.Docente;
        calificacionesPorPeriodo[materia.Periodo].materias[materia.materia].grupo = materia.Grupo;
      }
    });

    // PASO 9: Calcular promedios SOLO PARA ACTIVIDADES CALIFICADAS
    console.log(`🧮 Calculando promedios (solo actividades calificadas)...`);
    const calificaciones = Object.values(calificacionesPorPeriodo).map(periodo => {
      const materiasList = Object.values(periodo.materias);
      
      materiasList.forEach(materia => {
        // 🆕 FILTRAR SOLO ACTIVIDADES CALIFICADAS PARA EL PROMEDIO
        const actividadesCalificadas = materia.actividades.filter(act => act.estado === 'Calificada');
        
        if (actividadesCalificadas.length > 0) {
          const sumaCalificaciones = actividadesCalificadas.reduce((sum, act) => sum + act.calificacion, 0);
          materia.promedio = Math.round((sumaCalificaciones / actividadesCalificadas.length) * 10) / 10;
          materia.calificacion = materia.promedio;
          materia.estado = materia.promedio >= 6 ? 'Aprobada' : 'Reprobada';
        } else {
          // Si no hay actividades calificadas, promedio 0 y estado "En curso"
          materia.promedio = 0;
          materia.calificacion = 0;
          materia.estado = 'En curso';
        }
      });
      
      // 🆕 PROMEDIO DEL PERÍODO SOLO PARA MATERIAS CON CALIFICACIONES
      const materiasConCalificaciones = materiasList.filter(mat => mat.promedio > 0);
      if (materiasConCalificaciones.length > 0) {
        const sumaPromediosMaterias = materiasConCalificaciones.reduce((sum, mat) => sum + mat.promedio, 0);
        periodo.promedio = Math.round((sumaPromediosMaterias / materiasConCalificaciones.length) * 10) / 10;
      } else {
        periodo.promedio = 0;
      }
      
      periodo.materias = materiasList;
      
      return periodo;
    });

    // Ordenar por período descendente
    calificaciones.sort((a, b) => b.periodo.localeCompare(a.periodo));

    // PASO 10: Debug final MEJORADO
    console.log(`✅ Calificaciones finales procesadas (TODAS LAS ACTIVIDADES):`);
    calificaciones.forEach(periodo => {
      const totalActividades = periodo.materias.reduce((sum, mat) => sum + mat.actividades.length, 0);
      const actividadesCalificadas = periodo.materias.reduce((sum, mat) => 
        sum + mat.actividades.filter(act => act.estado === 'Calificada').length, 0);
      const actividadesPendientes = totalActividades - actividadesCalificadas;
      
      console.log(`   - Periodo ${periodo.periodo}: ${periodo.materias.length} materias, ${totalActividades} actividades (${actividadesCalificadas} calificadas, ${actividadesPendientes} pendientes), promedio: ${periodo.promedio}`);
    });

    const tipoConsulta = todos_periodos === 'true' ? 'TODOS LOS PERÍODOS' : 'PERÍODO ACTUAL';
    console.log(`🎓 === FIN CALIFICACIONES ${tipoConsulta} (CORREGIDO - TODAS LAS ACTIVIDADES) ===`);

    res.json(calificaciones);

  } catch (error) {
    console.error('❌ ERROR CRÍTICO en obtenerCalificacionesHistoricas:', error);
    console.error('❌ Error stack:', error.stack);
    
    res.status(500).json({ 
      mensaje: 'Error en el servidor al obtener calificaciones',
      error: error.message,
      debug: {
        matricula,
        todos_periodos,
        timestamp: new Date().toISOString()
      }
    });
  }
};

// FUNCIÓN: obtenerActividadesPorAlumno - Sin cambios (ya está bien)
const obtenerActividadesPorAlumno = async (req, res) => {
  const { matricula, materia } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log('🔍 === INICIO ACTIVIDADES CON ESTADOS DINÁMICOS Y COMPONENTES ===');
    console.log(`📋 Parámetros: Matrícula: ${matricula}, Materia: ${materia}`);

    // Obtener datos del alumno
    const alumnoResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .query(`
        SELECT vchPeriodo, chvGrupo, vchClvCuatri
        FROM tblAlumnos 
        WHERE RTRIM(vchMatricula) = RTRIM(@matricula)
      `);

    if (alumnoResult.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Alumno no encontrado' });
    }

    const alumno = alumnoResult.recordset[0];

    // Consulta con eliminación de duplicados
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
            CAST(a.descripcion AS NVARCHAR(MAX)) as descripcion,
            a.id_modalidad,
            CONVERT(VARCHAR, ag.fecha_asignacion, 126) as fecha_asignacion,
            CONVERT(VARCHAR, ag.fecha_entrega, 126) as fecha_entrega,
            ag.fecha_entrega as fecha_entrega_raw,
            ea.nombre_estado as estado_original,
            ins.nombre as instrumento,
            ti.nombre_tipo as tipoInstrumento,
            CASE 
              WHEN ins.parcial = 1 THEN 'Parcial 1'
              WHEN ins.parcial = 2 THEN 'Parcial 2'
              WHEN ins.parcial = 3 THEN 'Parcial 3'
              ELSE 'Actividad General'
            END as parcial,
            'Individual' as modalidad_tipo,
            ISNULL(vce.componente, 'Actividad') as tipo_componente,
            ISNULL(vce.valor_componente, 0) as valor_componente,
            CASE 
              WHEN UPPER(ISNULL(vce.componente, 'Actividad')) LIKE '%EXAMEN%' OR 
                   UPPER(ISNULL(vce.componente, 'Actividad')) LIKE '%FINAL%' OR
                   UPPER(ISNULL(vce.componente, 'Actividad')) LIKE '%PRACTICA FINAL%' THEN 'Final'
              ELSE 'Normal'
            END as clasificacion_actividad,
            CASE 
              WHEN EXISTS (
                SELECT 1 FROM tbl_evaluacion_criterioActividad eca 
                INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
                WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
              ) THEN 1 ELSE 0 
            END as tiene_calificacion_bd,
            1 as prioridad
          FROM tbl_actividades a
          INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
          INNER JOIN tbl_materias m ON ins.vchClvMateria = m.vchClvMateria
          INNER JOIN tbl_estado_actividad ea ON ea.id_estado_actividad = a.id_estado_actividad
          INNER JOIN tbl_tipo_instrumento ti ON ti.id_tipo_instrumento = ins.id_tipo_instrumento
          INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
          INNER JOIN tbl_actividad_alumno aa ON a.id_actividad = aa.id_actividad
          LEFT JOIN tbl_valor_componentes_evaluacion vce ON a.id_valor_componente = vce.id_valor_componente
          WHERE aa.vchMatricula = @matricula 
          AND m.vchNomMateria = @materia
          AND ins.vchPeriodo = @periodo_alumno
          AND a.id_modalidad = 1

          UNION ALL

          -- MODALIDAD 2: EQUIPO
          SELECT 
            a.id_actividad,
            a.titulo,
            CAST(a.descripcion AS NVARCHAR(MAX)) as descripcion,
            a.id_modalidad,
            CONVERT(VARCHAR, ag.fecha_asignacion, 126) as fecha_asignacion,
            CONVERT(VARCHAR, ag.fecha_entrega, 126) as fecha_entrega,
            ag.fecha_entrega as fecha_entrega_raw,
            ea.nombre_estado as estado_original,
            ins.nombre as instrumento,
            ti.nombre_tipo as tipoInstrumento,
            CASE 
              WHEN ins.parcial = 1 THEN 'Parcial 1'
              WHEN ins.parcial = 2 THEN 'Parcial 2'
              WHEN ins.parcial = 3 THEN 'Parcial 3'
              ELSE 'Actividad General'
            END as parcial,
            'Equipo' as modalidad_tipo,
            ISNULL(vce.componente, 'Actividad') as tipo_componente,
            ISNULL(vce.valor_componente, 0) as valor_componente,
            CASE 
              WHEN UPPER(ISNULL(vce.componente, 'Actividad')) LIKE '%EXAMEN%' OR 
                   UPPER(ISNULL(vce.componente, 'Actividad')) LIKE '%FINAL%' OR
                   UPPER(ISNULL(vce.componente, 'Actividad')) LIKE '%PRACTICA FINAL%' THEN 'Final'
              ELSE 'Normal'
            END as clasificacion_actividad,
            CASE 
              WHEN EXISTS (
                SELECT 1 FROM tbl_evaluacion_criterioActividad eca 
                INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
                WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
              ) THEN 1 ELSE 0 
            END as tiene_calificacion_bd,
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
          LEFT JOIN tbl_valor_componentes_evaluacion vce ON a.id_valor_componente = vce.id_valor_componente
          WHERE ea_alumno.vchMatricula = @matricula 
          AND m.vchNomMateria = @materia
          AND ins.vchPeriodo = @periodo_alumno
          AND a.id_modalidad = 2

          UNION ALL

          -- MODALIDAD 3: GRUPO
          SELECT 
            a.id_actividad,
            a.titulo,
            CAST(a.descripcion AS NVARCHAR(MAX)) as descripcion,
            a.id_modalidad,
            CONVERT(VARCHAR, ag.fecha_asignacion, 126) as fecha_asignacion,
            CONVERT(VARCHAR, ag.fecha_entrega, 126) as fecha_entrega,
            ag.fecha_entrega as fecha_entrega_raw,
            ea.nombre_estado as estado_original,
            ins.nombre as instrumento,
            ti.nombre_tipo as tipoInstrumento,
            CASE 
              WHEN ins.parcial = 1 THEN 'Parcial 1'
              WHEN ins.parcial = 2 THEN 'Parcial 2'
              WHEN ins.parcial = 3 THEN 'Parcial 3'
              ELSE 'Actividad General'
            END as parcial,
            'Grupo' as modalidad_tipo,
            ISNULL(vce.componente, 'Actividad') as tipo_componente,
            ISNULL(vce.valor_componente, 0) as valor_componente,
            CASE 
              WHEN UPPER(ISNULL(vce.componente, 'Actividad')) LIKE '%EXAMEN%' OR 
                   UPPER(ISNULL(vce.componente, 'Actividad')) LIKE '%FINAL%' OR
                   UPPER(ISNULL(vce.componente, 'Actividad')) LIKE '%PRACTICA FINAL%' THEN 'Final'
              ELSE 'Normal'
            END as clasificacion_actividad,
            CASE 
              WHEN EXISTS (
                SELECT 1 FROM tbl_evaluacion_criterioActividad eca 
                INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
                WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
              ) THEN 1 ELSE 0 
            END as tiene_calificacion_bd,
            3 as prioridad
          FROM tbl_actividades a
          INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
          INNER JOIN tbl_materias m ON ins.vchClvMateria = m.vchClvMateria
          INNER JOIN tbl_estado_actividad ea ON ea.id_estado_actividad = a.id_estado_actividad
          INNER JOIN tbl_tipo_instrumento ti ON ti.id_tipo_instrumento = ins.id_tipo_instrumento
          INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
          INNER JOIN tbl_grupos g ON ag.id_grupo = g.id_grupo
          LEFT JOIN tbl_valor_componentes_evaluacion vce ON a.id_valor_componente = vce.id_valor_componente
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
            fecha_entrega_raw,
            estado_original,
            instrumento,
            tipoInstrumento,
            parcial,
            modalidad_tipo,
            tipo_componente,
            valor_componente,
            clasificacion_actividad,
            tiene_calificacion_bd,
            ROW_NUMBER() OVER (PARTITION BY id_actividad ORDER BY prioridad) as rn
          FROM ActividadesUnicas
        )
        SELECT *
        FROM ActividadesSinDuplicados
        WHERE rn = 1
        ORDER BY fecha_entrega_raw ASC
      `);

    console.log(`📊 Actividades obtenidas de BD: ${result.recordset.length}`);

    const actividadesConEstadosDinamicos = result.recordset.map(actividad => {
      const estadoDinamico = calcularEstadoDinamico(
        actividad.fecha_entrega_raw || actividad.fecha_entrega,
        actividad.tiene_calificacion_bd === 1,
        actividad.estado_original
      );

      console.log(`📝 ${actividad.clasificacion_actividad === 'Final' ? '🎯' : '📄'} "${actividad.titulo}" (${actividad.tipo_componente}): ${actividad.estado_original} → ${estadoDinamico.estado}`);

      return {
        id_actividad: actividad.id_actividad,
        titulo: actividad.titulo,
        descripcion: actividad.descripcion || 'Sin descripción disponible',
        id_modalidad: actividad.id_modalidad,
        fecha_asignacion: actividad.fecha_asignacion,
        fecha_entrega: actividad.fecha_entrega,
        
        estado: estadoDinamico.estado,
        estado_info: {
          mensaje: estadoDinamico.mensaje,
          color: estadoDinamico.color,
          icono: estadoDinamico.icono,
          urgencia: estadoDinamico.urgencia
        },
        
        instrumento: actividad.instrumento,
        tipoInstrumento: actividad.tipoInstrumento,
        parcial: actividad.parcial,
        modalidad_tipo: actividad.modalidad_tipo,
        
        tipo_componente: actividad.tipo_componente,
        valor_componente: actividad.valor_componente,
        clasificacion_actividad: actividad.clasificacion_actividad,
        es_actividad_final: actividad.clasificacion_actividad === 'Final',
        
        tiene_calificacion: actividad.tiene_calificacion_bd === 1,
        fuente_estado: 'DINAMICO_JS'
      };
    });

    // Ordenamiento
    actividadesConEstadosDinamicos.sort((a, b) => {
      if (a.es_actividad_final && !b.es_actividad_final && !a.tiene_calificacion) return -1;
      if (b.es_actividad_final && !a.es_actividad_final && !b.tiene_calificacion) return 1;
      
      if (a.estado_info.urgencia !== b.estado_info.urgencia) {
        return a.estado_info.urgencia - b.estado_info.urgencia;
      }
      
      return new Date(a.fecha_entrega) - new Date(b.fecha_entrega);
    });

    console.log('📊 Resumen de actividades por tipo:');
    const resumenTipos = actividadesConEstadosDinamicos.reduce((acc, act) => {
      const tipo = act.es_actividad_final ? `Final (${act.tipo_componente})` : `Normal (${act.tipo_componente})`;
      acc[tipo] = (acc[tipo] || 0) + 1;
      return acc;
    }, {});
    
    Object.entries(resumenTipos).forEach(([tipo, count]) => {
      console.log(`   - ${tipo}: ${count} actividades`);
    });

    console.log('🔍 === FIN ACTIVIDADES CON ESTADOS DINÁMICOS Y COMPONENTES ===');

    res.json(actividadesConEstadosDinamicos);

  } catch (error) {
    console.error('❌ Error al obtener actividades:', error);
    res.status(500).json({ 
      mensaje: 'Error en el servidor al obtener actividades del alumno',
      error: error.message 
    });
  }
};

// FUNCIÓN: obtenerDetalleActividad - Sin cambios (ya está bien)
const obtenerDetalleActividad = async (req, res) => {
  const { matricula, idActividad } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`🔍 === DETALLE ACTIVIDAD CON ESTADO DINÁMICO ===`);
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

    // PASO 3: Verificar si el instrumento tiene criterios definidos
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

    // PASO 4: Verificar si hay calificación real
    const calificacionReal = await obtenerCalificacionRealActividad(pool, idActividad, matricula);
    
    // PASO 5: Determinar estado real basado en calificaciones
    let estadoReal = actividad.estado_original;
    if (calificacionReal && calificacionReal.criterios_calificados > 0) {
      estadoReal = 'Calificada';
    }

    // PASO 6: Manejo de criterios con mensajes claros
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
      
      rubrica = [];
    }

    // PASO 7: Calcular estado dinámico
    const estadoDinamico = calcularEstadoDinamico(
      actividad.fecha_entrega_raw || actividad.fecha_entrega,
      calificacionReal !== null,
      actividad.estado_original
    );
    console.log(`📝 Estado calculado para "${actividad.titulo}": ${actividad.estado_original} → ${estadoDinamico.estado}`);

    // PASO 8: Formatear respuesta
    const response = {
      id_actividad: actividad.id_actividad,
      titulo: actividad.titulo,
      descripcion: actividad.descripcion || 'Sin descripción disponible',
      fecha_asignacion: actividad.fecha_asignacion,
      fecha_entrega: actividad.fecha_entrega,
      estado: estadoDinamico.estado,
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
      
      // Información clara sobre criterios
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
    console.log(`🔍 === FIN DEBUG DETALLE ACTIVIDAD ===`);

    res.json(response);

  } catch (error) {
    console.error('❌ Error al obtener detalle con estado dinámico:', error);
    res.status(500).json({ 
      mensaje: 'Error en el servidor al obtener detalle de actividad',
      error: error.message 
    });
  }
};

// FUNCIÓN: obtenerActividadEntregada - Sin cambios (ya está bien)
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

    // PASO 2: Obtener detalles de la actividad CON OBSERVACIONES
    const result = await pool.request()
      .input('idActividad', sql.Int, idActividad)
      .input('matricula', sql.VarChar, matricula)
      .query(`
        SELECT 
          AC.id_actividad,
          AC.titulo,
          CAST(AC.descripcion AS NVARCHAR(MAX)) as descripcion,
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
          END as modalidad_nombre,
          AA.observacion as observaciones_bd
        FROM tbl_actividades AC
        INNER JOIN tbl_instrumento I ON I.id_instrumento = AC.id_instrumento
        INNER JOIN tbl_materias M ON M.vchClvMateria = I.vchClvMateria
        INNER JOIN tbl_tipo_instrumento TI ON TI.id_tipo_instrumento = I.id_tipo_instrumento
        INNER JOIN tbl_docentes D ON D.vchClvTrabajador = AC.vchClvTrabajador
        INNER JOIN tbl_actividad_grupo AG ON AG.id_actividad = AC.id_actividad
        LEFT JOIN tbl_actividad_alumno AA ON AA.id_actividad = AC.id_actividad 
                                          AND AA.vchMatricula = @matricula
        WHERE AC.id_actividad = @idActividad
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Actividad no encontrada' });
    }

    const actividad = result.recordset[0];

    // PASO 3: Obtener criterios calificados reales
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

    // PASO 4: Verificar entrega puntual
    const fechaEntregaLimite = new Date(actividad.fecha_entrega);
    const fechaEntregaAlumno = new Date(); 
    fechaEntregaAlumno.setDate(fechaEntregaLimite.getDate() - 1); 
    const entregaPuntual = fechaEntregaAlumno <= fechaEntregaLimite;

    // PASO 5: Formatear respuesta con observaciones REALES
    const response = {
      id_actividad: actividad.id_actividad,
      titulo: actividad.titulo,
      descripcion: actividad.descripcion || 'Sin descripción disponible',
      fecha_asignacion: actividad.fecha_asignacion,
      fecha_entrega: actividad.fecha_entrega,
      fecha_entrega_alumno: fechaEntregaAlumno.toISOString(),
      estado: 'Calificada',
      instrumento: actividad.instrumento,
      tipoInstrumento: actividad.tipoInstrumento,
      materia: actividad.materia,
      docente: actividad.docente,
      parcial: actividad.parcial,
      puntos_total: actividad.puntos_total,
      puntos_obtenidos: calificacionReal.puntos_obtenidos_total,
      calificacion: calificacionReal.calificacion_sobre_10,
      observaciones: actividad.observaciones_bd || 'Sin observaciones registradas',
      retroalimentacion: actividad.observaciones_bd || 'Sin retroalimentación específica',
      id_modalidad: actividad.id_modalidad,
      modalidad_nombre: actividad.modalidad_nombre,
      rubrica: rubrica,
      entrega_puntual: entregaPuntual,
      criterios_calificados: calificacionReal.criterios_calificados,
      fuente_calificacion: 'BD_REAL'
    };

    console.log(`✅ Actividad entregada con observaciones REALES:`);
    console.log(`   - Observaciones: ${response.observaciones}`);
    console.log(`   - Calificación: ${response.calificacion}/10`);
    console.log(`   - Puntos: ${response.puntos_obtenidos}/${response.puntos_total}`);
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

// FUNCIÓN: cambiarContrasena - Sin cambios
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

// ===============================================
// EXPORTS
// ===============================================
module.exports = {
  obtenerDatosAlumno,
  cambiarContrasena,
  obtenerActividadesPorAlumno,
  obtenerCalificacionesHistoricas, 
  obtenerDetalleActividad,
  obtenerActividadesEntregadas,
  obtenerActividadEntregada,
  obtenerCalificacionRealActividad,
  obtenerCriteriosCalificadosReales
};