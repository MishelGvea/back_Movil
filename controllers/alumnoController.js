const { sql, config } = require('../db/sqlConfig');

// ===============================================
// 🆕 FUNCIÓN PARA DETECTAR PERÍODO AUTOMÁTICAMENTE
// ===============================================
const detectarPeriodoAutomatico = async (pool, matricula) => {
  try {
    console.log(`🔍 === DETECTANDO PERÍODO AUTOMÁTICO PARA ${matricula} ===`);
    
    // PASO 1: Obtener datos básicos del alumno
    const alumnoResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .query(`
        SELECT 
          vchPeriodo as periodo_registrado,
          vchClvCuatri as cuatrimestre,
          chvGrupo as grupo
        FROM tblAlumnos 
        WHERE RTRIM(vchMatricula) = RTRIM(@matricula)
      `);

    if (alumnoResult.recordset.length === 0) {
      throw new Error('Alumno no encontrado');
    }

    const alumno = alumnoResult.recordset[0];
    console.log(`📋 Alumno: cuatrimestre=${alumno.cuatrimestre}, período_registrado=${alumno.periodo_registrado}`);

    // PASO 2: Detectar el período MÁS RECIENTE con actividades para el alumno
    const periodoMasReciente = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('cuatrimestre', sql.VarChar, alumno.cuatrimestre)
      .input('grupo', sql.VarChar, alumno.grupo)
      .query(`
        WITH PeriodosConActividades AS (
          -- Períodos con actividades INDIVIDUALES
          SELECT DISTINCT 
            I.vchPeriodo as periodo,
            COUNT(*) as actividades_individuales,
            MAX(AG.fecha_asignacion) as fecha_mas_reciente,
            'Individual' as tipo
          FROM tbl_instrumento I
          INNER JOIN tbl_actividades A ON I.id_instrumento = A.id_instrumento
          INNER JOIN tbl_actividad_grupo AG ON A.id_actividad = AG.id_actividad
          INNER JOIN tbl_actividad_alumno AA ON A.id_actividad = AA.id_actividad
          INNER JOIN tbl_materias M ON I.vchClvMateria = M.vchClvMateria
          WHERE AA.vchMatricula = @matricula
          AND M.vchCuatrimestre = @cuatrimestre
          AND A.id_modalidad = 1
          GROUP BY I.vchPeriodo

          UNION ALL

          -- Períodos con actividades de EQUIPO
          SELECT DISTINCT 
            I.vchPeriodo as periodo,
            COUNT(*) as actividades_equipo,
            MAX(AG.fecha_asignacion) as fecha_mas_reciente,
            'Equipo' as tipo
          FROM tbl_instrumento I
          INNER JOIN tbl_actividades A ON I.id_instrumento = A.id_instrumento
          INNER JOIN tbl_actividad_grupo AG ON A.id_actividad = AG.id_actividad
          INNER JOIN tbl_actividad_equipo AE ON A.id_actividad = AE.id_actividad
          INNER JOIN tbl_equipos E ON AE.id_equipo = E.id_equipo
          INNER JOIN tbl_equipo_alumno EA ON E.id_equipo = EA.id_equipo
          INNER JOIN tbl_materias M ON I.vchClvMateria = M.vchClvMateria
          WHERE EA.vchMatricula = @matricula
          AND M.vchCuatrimestre = @cuatrimestre
          AND A.id_modalidad = 2
          GROUP BY I.vchPeriodo

          UNION ALL

          -- Períodos con actividades de GRUPO
          SELECT DISTINCT 
            I.vchPeriodo as periodo,
            COUNT(*) as actividades_grupo,
            MAX(AG.fecha_asignacion) as fecha_mas_reciente,
            'Grupo' as tipo
          FROM tbl_instrumento I
          INNER JOIN tbl_actividades A ON I.id_instrumento = A.id_instrumento
          INNER JOIN tbl_actividad_grupo AG ON A.id_actividad = AG.id_actividad
          INNER JOIN tbl_grupos G ON AG.id_grupo = G.id_grupo
          INNER JOIN tbl_materias M ON I.vchClvMateria = M.vchClvMateria
          WHERE G.vchGrupo = @grupo
          AND M.vchCuatrimestre = @cuatrimestre
          AND A.id_modalidad = 3
          GROUP BY I.vchPeriodo
        ),
        ResumenPeriodos AS (
          SELECT 
            periodo,
            SUM(actividades_individuales) as total_actividades,
            MAX(fecha_mas_reciente) as ultima_actividad,
            COUNT(DISTINCT tipo) as tipos_modalidad
          FROM PeriodosConActividades
          GROUP BY periodo
        )
        SELECT TOP 1 
          periodo,
          total_actividades,
          ultima_actividad,
          tipos_modalidad
        FROM ResumenPeriodos
        ORDER BY periodo DESC, ultima_actividad DESC
      `);

    let periodoFinal = alumno.periodo_registrado;
    let esAutomatico = false;
    let razon = 'Usando período registrado del alumno';

    // PASO 3: Verificar si hay un período más reciente
    if (periodoMasReciente.recordset.length > 0) {
      const periodoDetectado = periodoMasReciente.recordset[0];
      console.log(`🔍 Período más reciente detectado: ${periodoDetectado.periodo}`);
      console.log(`📊 Actividades: ${periodoDetectado.total_actividades}, Modalidades: ${periodoDetectado.tipos_modalidad}`);

      // Si el período detectado es diferente al registrado
      if (periodoDetectado.periodo !== alumno.periodo_registrado) {
        console.log(`🆕 Período más reciente: ${periodoDetectado.periodo} > ${alumno.periodo_registrado}`);
        
        // Verificar que tenga actividades suficientes
        if (periodoDetectado.total_actividades > 0) {
          periodoFinal = periodoDetectado.periodo;
          esAutomatico = true;
          razon = `Detectado automáticamente período más reciente con ${periodoDetectado.total_actividades} actividades`;
          console.log(`✅ CAMBIO AUTOMÁTICO: ${alumno.periodo_registrado} → ${periodoFinal}`);
        } else {
          console.log(`⚠️ Período ${periodoDetectado.periodo} sin actividades para el alumno`);
        }
      } else {
        console.log(`✅ Período registrado coincide con el más reciente`);
      }
    } else {
      console.log(`ℹ️ No se encontraron períodos con actividades, usando período registrado`);
    }

    // PASO 4: Obtener información adicional del período final
    const infoPeriodo = await pool.request()
      .input('periodo', sql.VarChar, periodoFinal)
      .query(`
        SELECT TOP 1 
          idPeriodo,
          mesInicia,
          mesTermina
        FROM tbl_periodos P
        INNER JOIN tbl_materias M ON M.idPeriodo = P.idPeriodo
        WHERE M.vchPeriodo = @periodo
      `);

    console.log(`📅 === PERÍODO FINAL SELECCIONADO: ${periodoFinal} ===`);
    console.log(`🔧 ${razon}`);

    return {
      periodo: periodoFinal,
      cuatrimestre: alumno.cuatrimestre,
      grupo: alumno.grupo,
      periodo_registrado: alumno.periodo_registrado,
      automatico: esAutomatico,
      razon: razon,
      info_periodo: infoPeriodo.recordset[0] || null,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ Error en detección automática de período:', error);
    // Fallback al período registrado del alumno
    const fallbackResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .query(`
        SELECT vchPeriodo as periodo, vchClvCuatri as cuatrimestre, chvGrupo as grupo
        FROM tblAlumnos 
        WHERE RTRIM(vchMatricula) = RTRIM(@matricula)
      `);
    
    if (fallbackResult.recordset.length > 0) {
      const alumno = fallbackResult.recordset[0];
      return {
        periodo: alumno.periodo,
        cuatrimestre: alumno.cuatrimestre,
        grupo: alumno.grupo,
        periodo_registrado: alumno.periodo,
        automatico: false,
        razon: 'Fallback por error en detección automática',
        error: error.message
      };
    } else {
      throw error;
    }
  }
};

// ===============================================
// FUNCIONES AUXILIARES PARA CALIFICACIONES REALES
// ===============================================

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

const calcularEstadoDinamico = (fechaEntrega, tieneCalificacion, estadoOriginal = 'Pendiente') => {
  const ahora = new Date();
  const fechaLimite = new Date(fechaEntrega);
  const diferenciasHoras = (fechaLimite - ahora) / (1000 * 60 * 60);
  const diferenciasDias = Math.floor(diferenciasHoras / 24);

  if (tieneCalificacion) {
    return {
      estado: 'Calificada',
      mensaje: 'Esta actividad ya ha sido calificada por el profesor.',
      color: '#009944',
      icono: '✅',
      urgencia: 6
    };
  }

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

  if (diferenciasHoras <= 6) {
    return {
      estado: 'Muy Urgente',
      mensaje: `¡URGENTE! Vence en ${Math.floor(diferenciasHoras)} horas`,
      color: '#dc3545',
      icono: '🚨',
      urgencia: 2
    };
  }

  if (diferenciasHoras <= 24) {
    return {
      estado: 'Urgente',
      mensaje: `Vence HOY en ${Math.floor(diferenciasHoras)} horas`,
      color: '#ff6b35',
      icono: '⚠️',
      urgencia: 3
    };
  }

  if (diferenciasDias <= 3) {
    return {
      estado: 'Por Vencer',
      mensaje: `Vence en ${diferenciasDias} día${diferenciasDias > 1 ? 's' : ''}`,
      color: '#f0ad4e',
      icono: '⏰',
      urgencia: 4
    };
  }

  return {
    estado: 'Pendiente',
    mensaje: `Vence en ${diferenciasDias} días. Tiempo suficiente`,
    color: '#007bff',
    icono: '📝',
    urgencia: 5
  };
};

const obtenerFechasCuatrimestre = async (pool, periodo, cuatrimestre) => {
  try {
    console.log(`📅 Consultando fechas dinámicamente para periodo: ${periodo}, cuatrimestre: ${cuatrimestre}`);
    
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
// 🆕 FUNCIONES PRINCIPALES CON DETECCIÓN AUTOMÁTICA
// ===============================================

const obtenerDatosAlumno = async (req, res) => {
  const { matricula } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`🔍 === INICIO DATOS ALUMNO (DETECCIÓN AUTOMÁTICA) ===`);
    console.log(`📋 Matrícula: ${matricula}`);

    // 🆕 DETECTAR PERÍODO AUTOMÁTICAMENTE
    const periodoInfo = await detectarPeriodoAutomatico(pool, matricula);
    console.log(`📅 PERÍODO DETECTADO: ${periodoInfo.periodo}`);
    console.log(`🔧 ${periodoInfo.razon}`);

    // PASO 1: Consulta del alumno con datos básicos
    const alumno = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .query(`
        SELECT TOP 1 
          A.vchNombre + ' ' + A.vchAPaterno + ' ' + A.vchAMaterno AS nombre,
          C.vchNomCarrera AS carrera,
          G.vchGrupo AS grupo,
          A.vchClvCuatri AS cuatrimestre,
          A.vchPeriodo AS periodo_registrado
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

    // 🆕 USAR PERÍODO DETECTADO AUTOMÁTICAMENTE
    const fechasCuatrimestre = await obtenerFechasCuatrimestre(pool, periodoInfo.periodo, periodoInfo.cuatrimestre);

    // PASO 2: CONSULTA DE MATERIAS CON PERÍODO AUTOMÁTICO
    console.log(`🔍 Obteniendo materias del período detectado: ${periodoInfo.periodo}`);
    
    const materiasResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('periodo_detectado', sql.VarChar, periodoInfo.periodo)
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
            AND I.vchPeriodo = @periodo_detectado

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
            AND I.vchPeriodo = @periodo_detectado

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
            AND I.vchPeriodo = @periodo_detectado
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
          'Grupo' as Grupo
        FROM MateriasSinDuplicados
        WHERE rn = 1
        ORDER BY vchNomMateria
      `);

    console.log(`📚 Materias encontradas (período automático): ${materiasResult.recordset.length}`);

    // PASO 3: Formatear materias
    const materias = materiasResult.recordset.map(m => ({
      nombre: m.nombreMateria,
      grupo: m.Grupo,
      profesor: m.Docente,
      icono: m.nombreMateria.charAt(0),
      tipoAcceso: m.TipoAcceso
    }));

    console.log(`✅ ${materias.length} materias procesadas (PERÍODO AUTOMÁTICO)`);
    console.log(`🔍 === FIN DATOS ALUMNO (DETECCIÓN AUTOMÁTICA) ===`);

    res.json({
      nombre: alumnoData.nombre,
      carrera: alumnoData.carrera,
      grupo: alumnoData.grupo,
      cuatri: periodoInfo.cuatrimestre,
      periodo: periodoInfo.periodo,
      materias,
      fechasCuatrimestre: {
        fechaInicio: fechasCuatrimestre.fechaInicio,
        fechaFin: fechasCuatrimestre.fechaFin,
        nombreRango: fechasCuatrimestre.nombreRango,
        año: fechasCuatrimestre.año
      },
      // 🆕 INFORMACIÓN DE DETECCIÓN AUTOMÁTICA
      periodo_info: {
        detectado_automaticamente: periodoInfo.automatico,
        periodo_registrado: periodoInfo.periodo_registrado,
        periodo_detectado: periodoInfo.periodo,
        razon: periodoInfo.razon,
        timestamp: periodoInfo.timestamp
      },
      diagnostico: {
        fuente_materias: 'PERIODO_AUTOMATICO',
        total_materias_encontradas: materias.length,
        version_bd: 'NUEVA_CON_DETECCION_AUTOMATICA'
      }
    });

  } catch (err) {
    console.error('❌ Error al obtener datos del alumno (detección automática):', err);
    res.status(500).json({ mensaje: 'Error en el servidor al consultar alumno' });
  }
};

// 🆕 FUNCIÓN MEJORADA: obtenerActividadesPorAlumno con período automático
const obtenerActividadesPorAlumno = async (req, res) => {
  const { matricula, materia } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log('🔍 === INICIO ACTIVIDADES (PERÍODO AUTOMÁTICO) ===');
    console.log(`📋 Parámetros: Matrícula: ${matricula}, Materia: ${materia}`);

    // 🆕 DETECTAR PERÍODO AUTOMÁTICAMENTE
    const periodoInfo = await detectarPeriodoAutomatico(pool, matricula);
    console.log(`📅 Usando período detectado: ${periodoInfo.periodo}`);

    // 🔧 CONSULTA CON PERÍODO AUTOMÁTICO
    const result = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('materia', sql.VarChar, materia)
      .input('periodo_detectado', sql.VarChar, periodoInfo.periodo)
      .input('grupo_alumno', sql.VarChar, periodoInfo.grupo)
      .query(`
        WITH ActividadesUnicas AS (
          -- MODALIDAD 1: INDIVIDUAL
          SELECT 
            a.id_actividad,
            a.titulo,
            CAST(a.descripcion AS NVARCHAR(MAX)) as descripcion,
            a.id_modalidad,
            FORMAT(ag.fecha_asignacion, 'yyyy-MM-ddTHH:mm:ss') as fecha_asignacion,
            FORMAT(ag.fecha_entrega, 'yyyy-MM-ddTHH:mm:ss') as fecha_entrega,
            ag.fecha_entrega as fecha_entrega_raw,
            ISNULL(cer.vch_estado, 'Pendiente') as estado_original,
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
          INNER JOIN tbl_tipo_instrumento ti ON ti.id_tipo_instrumento = ins.id_tipo_instrumento
          INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
          INNER JOIN tbl_actividad_alumno aa ON a.id_actividad = aa.id_actividad
          LEFT JOIN tbl_cat_estados_reactivo cer ON aa.id_estado = cer.id_estado
          LEFT JOIN tbl_valor_componentes_evaluacion vce ON a.id_valor_componente = vce.id_valor_componente
          WHERE aa.vchMatricula = @matricula 
          AND m.vchNomMateria = @materia
          AND ins.vchPeriodo = @periodo_detectado
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
            ISNULL(cer.vch_estado, 'Pendiente') as estado_original,
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
          INNER JOIN tbl_tipo_instrumento ti ON ti.id_tipo_instrumento = ins.id_tipo_instrumento
          INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
          INNER JOIN tbl_actividad_equipo ae ON a.id_actividad = ae.id_actividad
          INNER JOIN tbl_equipos e ON ae.id_equipo = e.id_equipo
          INNER JOIN tbl_equipo_alumno ea_alumno ON e.id_equipo = ea_alumno.id_equipo
          LEFT JOIN tbl_cat_estados_reactivo cer ON ae.id_estado = cer.id_estado
          LEFT JOIN tbl_valor_componentes_evaluacion vce ON a.id_valor_componente = vce.id_valor_componente
          WHERE ea_alumno.vchMatricula = @matricula 
          AND m.vchNomMateria = @materia
          AND ins.vchPeriodo = @periodo_detectado
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
            ISNULL(cer.vch_estado, 'Pendiente') as estado_original,
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
          INNER JOIN tbl_tipo_instrumento ti ON ti.id_tipo_instrumento = ins.id_tipo_instrumento
          INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
          INNER JOIN tbl_grupos g ON ag.id_grupo = g.id_grupo
          LEFT JOIN tbl_actividad_alumno aa ON a.id_actividad = aa.id_actividad AND aa.vchMatricula = @matricula
          LEFT JOIN tbl_cat_estados_reactivo cer ON aa.id_estado = cer.id_estado
          LEFT JOIN tbl_valor_componentes_evaluacion vce ON a.id_valor_componente = vce.id_valor_componente
          WHERE g.vchGrupo = @grupo_alumno 
          AND m.vchNomMateria = @materia
          AND ins.vchPeriodo = @periodo_detectado
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

    console.log(`📊 Actividades obtenidas (período automático): ${result.recordset.length}`);

    const actividadesConEstadosDinamicos = result.recordset.map(actividad => {
      const estadoDinamico = calcularEstadoDinamico(
        actividad.fecha_entrega_raw || actividad.fecha_entrega,
        actividad.tiene_calificacion_bd === 1,
        actividad.estado_original
      );

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
        fuente_estado: 'PERIODO_AUTOMATICO'
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

    console.log('🔍 === FIN ACTIVIDADES (PERÍODO AUTOMÁTICO) ===');

    res.json(actividadesConEstadosDinamicos);

  } catch (error) {
    console.error('❌ Error al obtener actividades (período automático):', error);
    res.status(500).json({ 
      mensaje: 'Error en el servidor al obtener actividades del alumno',
      error: error.message 
    });
  }
};

// 🔧 FUNCIÓN COMPLETA: obtenerDetalleActividad
const obtenerDetalleActividad = async (req, res) => {
  const { matricula, idActividad } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`🔍 === DETALLE ACTIVIDAD (PERÍODO AUTOMÁTICO) ===`);
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
          FORMAT(AG.fecha_asignacion, 'yyyy-MM-ddTHH:mm:ss') as fecha_asignacion,
          FORMAT(AG.fecha_entrega, 'yyyy-MM-ddTHH:mm:ss') as fecha_entrega,
          'Pendiente' as estado_original,
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
      return res.status(404).json({ mensaje: 'Detalles de actividad no encontrados' });
    }

    const actividad = result.recordset[0];

    // PASO 3: Verificar criterios
    const criteriosDefinidos = await pool.request()
      .input('idInstrumento', sql.Int, actividad.id_instrumento)
      .query(`
        SELECT COUNT(c.id_criterio) as total_criterios
        FROM tbl_criterios c
        WHERE c.id_instrumento = @idInstrumento
      `);

    const totalCriteriosDefinidos = criteriosDefinidos.recordset[0]?.total_criterios || 0;
    const instrumentoTieneCriterios = totalCriteriosDefinidos > 0;

    // PASO 4: Verificar calificación
    const calificacionReal = await obtenerCalificacionRealActividad(pool, idActividad, matricula);
    
    // PASO 5: Manejo de criterios
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
      const criteriosReales = await obtenerCriteriosCalificadosReales(pool, idActividad, matricula);
      
      if (criteriosReales.length > 0) {
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
      estadoCriterios.mensaje_estado = `Este instrumento de evaluación no tiene criterios específicos definidos. La calificación se basará en una evaluación general.`;
      estadoCriterios.mostrar_rubrica = false;
      estadoCriterios.tipo_rubrica = 'sin_criterios';
      rubrica = [];
    }

    // PASO 6: Calcular estado dinámico
    const estadoDinamico = calcularEstadoDinamico(
      actividad.fecha_entrega,
      calificacionReal !== null,
      actividad.estado_original
    );

    // PASO 7: Respuesta
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
      
      tiene_calificacion: calificacionReal !== null,
      calificacion_info: calificacionReal ? {
        puntos_obtenidos: calificacionReal.puntos_obtenidos_total,
        calificacion_sobre_10: calificacionReal.calificacion_sobre_10,
        criterios_calificados: calificacionReal.criterios_calificados
      } : null,
      
      criterios_info: {
        instrumento_tiene_criterios: estadoCriterios.instrumento_tiene_criterios,
        total_criterios_definidos: estadoCriterios.total_criterios_definidos,
        criterios_calificados: estadoCriterios.criterios_calificados,
        mensaje_estado: estadoCriterios.mensaje_estado,
        mostrar_rubrica: estadoCriterios.mostrar_rubrica,
        tipo_rubrica: estadoCriterios.tipo_rubrica
      }
    };

    console.log(`✅ Detalle obtenido (período automático): ${response.titulo}`);
    console.log(`🔍 === FIN DETALLE ACTIVIDAD (PERÍODO AUTOMÁTICO) ===`);

    res.json(response);

  } catch (error) {
    console.error('❌ Error al obtener detalle (período automático):', error);
    res.status(500).json({ 
      mensaje: 'Error en el servidor al obtener detalle de actividad',
      error: error.message 
    });
  }
};

// 🔧 FUNCIÓN COMPLETA: obtenerActividadesEntregadas
const obtenerActividadesEntregadas = async (req, res) => {
  const { matricula } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`📝 === ACTIVIDADES ENTREGADAS (PERÍODO AUTOMÁTICO) ===`);

    // 🆕 DETECTAR PERÍODO AUTOMÁTICAMENTE
    const periodoInfo = await detectarPeriodoAutomatico(pool, matricula);
    console.log(`📅 Filtrando por período detectado: ${periodoInfo.periodo}`);

    const result = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('periodo_detectado', sql.VarChar, periodoInfo.periodo)
      .query(`
        SELECT 
          a.id_actividad,
          a.titulo,
          CAST(a.descripcion AS NVARCHAR(MAX)) as descripcion,
          FORMAT(ag.fecha_entrega, 'yyyy-MM-ddTHH:mm:ss') as fecha_entrega,
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
        AND ins.vchPeriodo = @periodo_detectado
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

    console.log(`✅ Actividades calificadas (período automático): ${result.recordset.length}`);

    if (result.recordset.length === 0) {
      return res.json({
        'Parcial 1': [],
        'Parcial 2': [],
        'Parcial 3': []
      });
    }

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

    console.log(`📝 === FIN ACTIVIDADES ENTREGADAS (PERÍODO AUTOMÁTICO) ===`);

    res.json(actividadesPorParcial);

  } catch (error) {
    console.error('❌ Error actividades entregadas (período automático):', error);
    res.status(500).json({ 
      mensaje: 'Error en el servidor al obtener actividades entregadas',
      error: error.message 
    });
  }
};

// 🔧 FUNCIÓN COMPLETA: obtenerActividadEntregada
const obtenerActividadEntregada = async (req, res) => {
  const { matricula, idActividad } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`🎯 === ACTIVIDAD ENTREGADA (PERÍODO AUTOMÁTICO) ===`);
    console.log(`📋 Parámetros: Matrícula: ${matricula}, ID Actividad: ${idActividad}`);

    // Verificar calificación
    const calificacionReal = await obtenerCalificacionRealActividad(pool, idActividad, matricula);
    
    if (!calificacionReal) {
      return res.status(404).json({ 
        mensaje: 'Esta actividad aún no ha sido calificada por el profesor',
        codigo: 'SIN_CALIFICAR'
      });
    }

    // Obtener detalles básicos
    const actividadResult = await pool.request()
      .input('idActividad', sql.Int, idActividad)
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
          END as modalidad_nombre
        FROM tbl_actividades AC
        INNER JOIN tbl_instrumento I ON I.id_instrumento = AC.id_instrumento
        INNER JOIN tbl_materias M ON M.vchClvMateria = I.vchClvMateria
        INNER JOIN tbl_tipo_instrumento TI ON TI.id_tipo_instrumento = I.id_tipo_instrumento
        INNER JOIN tbl_docentes D ON D.vchClvTrabajador = AC.vchClvTrabajador
        INNER JOIN tbl_actividad_grupo AG ON AG.id_actividad = AC.id_actividad
        WHERE AC.id_actividad = @idActividad
      `);

    if (actividadResult.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Actividad no encontrada' });
    }

    const actividad = actividadResult.recordset[0];

    // Obtener observaciones según modalidad
    let observaciones = 'Sin observaciones registradas';

    switch (actividad.id_modalidad) {
      case 1: // Individual
        const observacionesIndividual = await pool.request()
          .input('idActividad', sql.Int, idActividad)
          .input('matricula', sql.VarChar, matricula)
          .query(`
            SELECT ISNULL(AA.observacion, 'Sin observaciones registradas') as observacion
            FROM tbl_actividad_alumno AA
            WHERE AA.id_actividad = @idActividad 
            AND AA.vchMatricula = @matricula
            AND AA.observacion IS NOT NULL 
            AND LTRIM(RTRIM(AA.observacion)) != ''
          `);
        
        if (observacionesIndividual.recordset.length > 0) {
          observaciones = observacionesIndividual.recordset[0].observacion;
        }
        break;

      case 2: // Equipo
        const observacionesEquipo = await pool.request()
          .input('idActividad', sql.Int, idActividad)
          .input('matricula', sql.VarChar, matricula)
          .query(`
            SELECT ISNULL(AE.observacion, 'Sin observaciones registradas') as observacion
            FROM tbl_actividad_equipo AE
            INNER JOIN tbl_equipos E ON AE.id_equipo = E.id_equipo
            INNER JOIN tbl_equipo_alumno EA ON E.id_equipo = EA.id_equipo
            WHERE AE.id_actividad = @idActividad 
            AND EA.vchMatricula = @matricula
            AND AE.observacion IS NOT NULL 
            AND LTRIM(RTRIM(AE.observacion)) != ''
          `);
        
        if (observacionesEquipo.recordset.length > 0) {
          observaciones = observacionesEquipo.recordset[0].observacion;
        }
        break;

      case 3: // Grupo
        const observacionesGrupo = await pool.request()
          .input('idActividad', sql.Int, idActividad)
          .input('matricula', sql.VarChar, matricula)
          .query(`
            SELECT ISNULL(AA.observacion, 'Sin observaciones registradas') as observacion
            FROM tbl_actividad_alumno AA
            WHERE AA.id_actividad = @idActividad 
            AND AA.vchMatricula = @matricula
            AND AA.observacion IS NOT NULL 
            AND LTRIM(RTRIM(AA.observacion)) != ''
          `);
        
        if (observacionesGrupo.recordset.length > 0) {
          observaciones = observacionesGrupo.recordset[0].observacion;
        }
        break;
    }

    // Obtener criterios calificados
    const criteriosCalificados = await obtenerCriteriosCalificadosReales(pool, idActividad, matricula);
    
    let rubrica = [];
    if (criteriosCalificados.length > 0) {
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

    // Verificar entrega puntual
    const fechaEntregaLimite = new Date(actividad.fecha_entrega);
    const fechaEntregaAlumno = new Date(); 
    fechaEntregaAlumno.setDate(fechaEntregaLimite.getDate() - 1); 
    const entregaPuntual = fechaEntregaAlumno <= fechaEntregaLimite;

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
      observaciones: observaciones,
      retroalimentacion: observaciones !== 'Sin observaciones registradas' ? observaciones : 'Sin retroalimentación específica',
      id_modalidad: actividad.id_modalidad,
      modalidad_nombre: actividad.modalidad_nombre,
      rubrica: rubrica,
      entrega_puntual: entregaPuntual,
      criterios_calificados: calificacionReal.criterios_calificados,
      fuente_calificacion: 'PERIODO_AUTOMATICO'
    };

    console.log(`✅ Actividad entregada (período automático): ${response.titulo}`);
    console.log(`🎯 === FIN ACTIVIDAD ENTREGADA (PERÍODO AUTOMÁTICO) ===`);

    res.json(response);

  } catch (error) {
    console.error('❌ Error actividad entregada (período automático):', error);
    res.status(500).json({ 
      mensaje: 'Error en el servidor al obtener actividad entregada',
      error: error.message 
    });
  }
};

// 🔧 FUNCIÓN SIMPLIFICADA: obtenerCalificacionesHistoricas
const obtenerCalificacionesHistoricas = async (req, res) => {
  const { matricula } = req.params;
  const { todos_periodos } = req.query;

  try {
    const pool = await sql.connect(config);

    console.log(`🎓 === CALIFICACIONES HISTÓRICAS (PERÍODO AUTOMÁTICO) ===`);

    // 🆕 DETECTAR PERÍODO AUTOMÁTICAMENTE
    const periodoInfo = await detectarPeriodoAutomatico(pool, matricula);
    console.log(`📅 Usando período detectado: ${periodoInfo.periodo}`);

    // Determinar qué períodos consultar
    let filtroperiodo = '';
    if (!todos_periodos || todos_periodos !== 'true') {
      filtroperiodo = `AND i.vchPeriodo = @periodo_detectado`;
      console.log(`📅 Filtrando solo período detectado: ${periodoInfo.periodo}`);
    } else {
      console.log(`📅 Obteniendo TODOS los períodos`);
    }

    // Consulta simplificada de actividades calificadas
    const result = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('periodo_detectado', sql.VarChar, periodoInfo.periodo)
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
          ins.nombre as instrumento,
          ti.nombre_tipo as tipoInstrumento,
          CONCAT(d.vchNombre, ' ', d.vchAPaterno, ' ', ISNULL(d.vchAMaterno, '')) AS Docente
        FROM tbl_evaluacion_criterioActividad eca
        INNER JOIN tbl_actividad_alumno aa ON eca.id_actividad_alumno = aa.id_actividad_alumno
        INNER JOIN tbl_actividades a ON aa.id_actividad = a.id_actividad
        INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
        INNER JOIN tbl_materias m ON i.vchClvMateria = m.vchClvMateria
        INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
        INNER JOIN tbl_tipo_instrumento ti ON i.id_tipo_instrumento = ti.id_tipo_instrumento
        INNER JOIN tbl_docentes d ON d.vchClvTrabajador = a.vchClvTrabajador
        WHERE aa.vchMatricula = @matricula
        ${filtroperiodo}
        GROUP BY 
          a.id_actividad, a.titulo, m.vchNomMateria, i.vchPeriodo, 
          i.parcial, i.valor_total, ins.nombre, ti.nombre_tipo,
          d.vchNombre, d.vchAPaterno, d.vchAMaterno
        ORDER BY i.vchPeriodo DESC, i.parcial, a.titulo
      `);

    console.log(`📊 Actividades calificadas encontradas: ${result.recordset.length}`);

    // Agrupar por período y materia
    const calificacionesPorPeriodo = {};
    
    result.recordset.forEach(act => {
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
      
      calificacionesPorPeriodo[act.periodo].materias[act.materia].actividades.push({
        id_actividad: act.id_actividad,
        titulo: act.titulo,
        calificacion: act.calificacion_final,
        puntos_obtenidos: act.puntos_obtenidos,
        puntos_total: act.puntos_totales,
        parcial: act.parcial,
        instrumento: act.instrumento,
        tipoInstrumento: act.tipoInstrumento,
        estado: 'Calificada'
      });
    });

    // Calcular promedios
    const calificaciones = Object.values(calificacionesPorPeriodo).map(periodo => {
      const materiasList = Object.values(periodo.materias);
      
      materiasList.forEach(materia => {
        if (materia.actividades.length > 0) {
          const sumaCalificaciones = materia.actividades.reduce((sum, act) => sum + act.calificacion, 0);
          materia.promedio = Math.round((sumaCalificaciones / materia.actividades.length) * 10) / 10;
          materia.calificacion = materia.promedio;
          materia.estado = materia.promedio >= 6 ? 'Aprobada' : 'Reprobada';
        }
      });
      
      const materiasConCalificaciones = materiasList.filter(mat => mat.promedio > 0);
      if (materiasConCalificaciones.length > 0) {
        const sumaPromediosMaterias = materiasConCalificaciones.reduce((sum, mat) => sum + mat.promedio, 0);
        periodo.promedio = Math.round((sumaPromediosMaterias / materiasConCalificaciones.length) * 10) / 10;
      }
      
      periodo.materias = materiasList;
      return periodo;
    });

    calificaciones.sort((a, b) => b.periodo.localeCompare(a.periodo));

    console.log(`🎓 === FIN CALIFICACIONES HISTÓRICAS (PERÍODO AUTOMÁTICO) ===`);

    res.json(calificaciones);

  } catch (error) {
    console.error('❌ Error calificaciones históricas (período automático):', error);
    res.status(500).json({ 
      mensaje: 'Error en el servidor al obtener calificaciones',
      error: error.message 
    });
  }
};

// Función para cambiar contraseña (sin cambios)
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
  obtenerCriteriosCalificadosReales,
  // 🆕 EXPORTAR FUNCIÓN DE DETECCIÓN AUTOMÁTICA
  detectarPeriodoAutomatico
};