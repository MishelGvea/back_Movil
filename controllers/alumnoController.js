const { sql, config } = require('../db/sqlConfig');

// ===============================================
// 🔧 FUNCIÓN CORREGIDA: detectarPeriodoAutomatico
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
          INNER JOIN tbl_materias M ON I.vchClvMateria = M.vchClvMateria AND I.idPeriodo = M.idPeriodo
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
          INNER JOIN tbl_materias M ON I.vchClvMateria = M.vchClvMateria AND I.idPeriodo = M.idPeriodo
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
          INNER JOIN tbl_materias M ON I.vchClvMateria = M.vchClvMateria AND I.idPeriodo = M.idPeriodo
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

    console.log(`📅 === PERÍODO FINAL SELECCIONADO: ${periodoFinal} ===`);
    console.log(`🔧 ${razon}`);

    return {
      periodo: periodoFinal,
      cuatrimestre: alumno.cuatrimestre,
      grupo: alumno.grupo,
      periodo_registrado: alumno.periodo_registrado,
      automatico: esAutomatico,
      razon: razon,
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
// 🔧 FUNCIÓN COMPLETAMENTE CORREGIDA: calcularEstadoDinamico
// ===============================================
const calcularEstadoDinamico = (fechaEntrega, tieneCalificacion, estadoOriginal = 'Pendiente') => {
  console.log(`🔍 === CALCULANDO ESTADO DINÁMICO (ZONA HORARIA CORREGIDA) ===`);
  
  if (tieneCalificacion) {
    console.log(`✅ RESULTADO: CALIFICADA`);
    return {
      estado: 'Calificada',
      mensaje: 'Esta actividad ya ha sido calificada por el profesor.',
      color: '#009944',
      icono: '✅',
      urgencia: 6
    };
  }

  if (!fechaEntrega) {
    console.log(`⚠️ RESULTADO: SIN FECHA`);
    return {
      estado: 'Sin fecha',
      mensaje: 'Sin fecha de entrega definida',
      color: '#6c757d',
      icono: '❓',
      urgencia: 5
    };
  }

  // 🔧 OBTENER HORA ACTUAL EN ZONA HORARIA CORRECTA (México)
  const ahora = new Date();
  
  // 🔧 APLICAR CORRECCIÓN DE ZONA HORARIA PARA MÉXICO (UTC-6)
  // Ajustar según tu zona horaria real
  const offsetMexico = -6; // UTC-6 para zona horaria de México
  const ahoraLocal = new Date(ahora.getTime() + (offsetMexico * 60 * 60 * 1000));
  
  console.log(`📅 Hora actual UTC: ${ahora.toISOString()}`);
  console.log(`📅 Hora actual México (UTC-6): ${ahoraLocal.toISOString()}`);
  
  let fechaLimite;

  try {
    // 🔧 PARSEAR LA FECHA ASUMIENDO QUE VIENE EN ZONA HORARIA LOCAL
    if (typeof fechaEntrega === 'string') {
      fechaLimite = new Date(fechaEntrega);
    } else if (fechaEntrega instanceof Date) {
      fechaLimite = new Date(fechaEntrega.getTime());
    } else {
      fechaLimite = new Date(fechaEntrega);
    }
    
    if (isNaN(fechaLimite.getTime())) {
      console.error(`❌ Fecha inválida: ${fechaEntrega}`);
      return {
        estado: 'Error',
        mensaje: 'Error en fecha de entrega',
        color: '#6c757d',
        icono: '❓',
        urgencia: 5
      };
    }
  } catch (error) {
    console.error(`❌ Error parseando fecha: ${error.message}`);
    return {
      estado: 'Error',
      mensaje: 'Error en fecha de entrega',
      color: '#6c757d',
      icono: '❓',
      urgencia: 5
    };
  }

  console.log(`📅 Fecha límite parseada: ${fechaLimite.toISOString()}`);
  
  // ✅ CÁLCULO PRECISO DE DIFERENCIA USANDO HORA LOCAL CORREGIDA
  const diferenciaMilisegundos = fechaLimite.getTime() - ahoraLocal.getTime();
  const diferenciaMinutos = Math.floor(diferenciaMilisegundos / (1000 * 60));
  const diferenciaHoras = Math.floor(diferenciaMilisegundos / (1000 * 60 * 60));
  
  console.log(`⏰ Diferencia en milisegundos: ${diferenciaMilisegundos}`);
  console.log(`⏰ Diferencia en minutos: ${diferenciaMinutos}`);
  console.log(`⏰ Diferencia en horas: ${diferenciaHoras}`);
  console.log(`❓ ¿Ya venció? ${diferenciaMilisegundos < 0 ? 'SÍ' : 'NO'}`);

  if (diferenciaMilisegundos < 0) {
    // ❌ YA VENCIÓ
    const tiempoTranscurrido = Math.abs(diferenciaMilisegundos);
    const minutosTranscurridos = Math.floor(tiempoTranscurrido / (1000 * 60));
    const horasTranscurridas = Math.floor(tiempoTranscurrido / (1000 * 60 * 60));
    const diasTranscurridos = Math.floor(tiempoTranscurrido / (1000 * 60 * 60 * 24));
    
    console.log(`❌ ACTIVIDAD VENCIDA:`);
    console.log(`   🕐 Hace ${minutosTranscurridos} minutos`);
    console.log(`   🕐 Hace ${horasTranscurridas} horas`);
    console.log(`   🕐 Hace ${diasTranscurridos} días`);
    
    let mensaje;
    if (diasTranscurridos >= 1) {
      mensaje = `Venció hace ${diasTranscurridos} día${diasTranscurridos > 1 ? 's' : ''}`;
    } else if (horasTranscurridas >= 1) {
      mensaje = `Venció hace ${horasTranscurridas} hora${horasTranscurridas > 1 ? 's' : ''}`;
    } else if (minutosTranscurridos >= 1) {
      mensaje = `Venció hace ${minutosTranscurridos} minuto${minutosTranscurridos > 1 ? 's' : ''}`;
    } else {
      mensaje = `Venció hace unos momentos`;
    }
    
    console.log(`📝 Mensaje final: "${mensaje}"`);
    
    return {
      estado: 'Vencida',
      mensaje: mensaje,
      color: '#d9534f',
      icono: '❌',
      urgencia: 1
    };
  } else {
    // ✅ AÚN NO VENCE
    const tiempoRestante = diferenciaMilisegundos;
    const minutosRestantes = Math.floor(tiempoRestante / (1000 * 60));
    const horasRestantes = Math.floor(tiempoRestante / (1000 * 60 * 60));
    const diasRestantes = Math.floor(tiempoRestante / (1000 * 60 * 60 * 24));
    
    console.log(`✅ ACTIVIDAD PENDIENTE:`);
    console.log(`   🕐 En ${minutosRestantes} minutos`);
    console.log(`   🕐 En ${horasRestantes} horas`);
    console.log(`   🕐 En ${diasRestantes} días`);
    
    let mensaje, estado, color, icono, urgencia;
    
    if (diasRestantes >= 1) {
      estado = 'Pendiente';
      mensaje = `Vence en ${diasRestantes} día${diasRestantes > 1 ? 's' : ''}`;
      color = '#007bff';
      icono = '📝';
      urgencia = 5;
    } else if (horasRestantes >= 1) {
      if (horasRestantes <= 6) {
        estado = 'Muy Urgente';
        mensaje = `¡URGENTE! Vence en ${horasRestantes} hora${horasRestantes > 1 ? 's' : ''}`;
        color = '#dc3545';
        icono = '🚨';
        urgencia = 2;
      } else {
        estado = 'Urgente';
        mensaje = `Vence HOY en ${horasRestantes} hora${horasRestantes > 1 ? 's' : ''}`;
        color = '#ff6b35';
        icono = '⚠️';
        urgencia = 3;
      }
    } else if (minutosRestantes >= 1) {
      estado = 'Muy Urgente';
      mensaje = `¡URGENTE! Vence en ${minutosRestantes} minuto${minutosRestantes > 1 ? 's' : ''}`;
      color = '#dc3545';
      icono = '🚨';
      urgencia = 2;
    } else {
      estado = 'Muy Urgente';
      mensaje = `¡URGENTE! Vence ahora`;
      color = '#dc3545';
      icono = '🚨';
      urgencia = 2;
    }
    
    console.log(`📝 Estado final: "${estado}"`);
    console.log(`📝 Mensaje final: "${mensaje}"`);
    
    return {
      estado,
      mensaje,
      color,
      icono,
      urgencia
    };
  }
};
const verificarEstadoActividad = (actividad) => {
  if (!actividad.fecha_entrega) return 'Sin fecha';
  
  const fechaEntrega = new Date(actividad.fecha_entrega);
  const ahora = new Date();
  
  console.log(`🔍 VERIFICACIÓN FRONTEND:`);
  console.log(`   Fecha entrega: ${fechaEntrega.toLocaleString()}`);
  console.log(`   Hora actual: ${ahora.toLocaleString()}`);
  
  const diferencia = fechaEntrega.getTime() - ahora.getTime();
  const horas = Math.floor(Math.abs(diferencia) / (1000 * 60 * 60));
  const minutos = Math.floor((Math.abs(diferencia) % (1000 * 60 * 60)) / (1000 * 60));
  
  if (diferencia < 0) {
    return `Vencida hace ${horas}h ${minutos}m`;
  } else {
    return `Vence en ${horas}h ${minutos}m`;
  }
};

// ===============================================
// 🧪 FUNCIÓN DE PRUEBA ESPECÍFICA
// ===============================================
const probarConFechaReal = () => {
  console.log('\n🧪 === PRUEBA CON FECHA REAL ===');
  
  // Simular la fecha de tu base de datos: 2025-07-18 20:20:00
  const fechaDB = '2025-07-18T20:20:00.000';
  const fechaBD = new Date(fechaDB);
  
  console.log(`📅 Fecha de BD simulada: ${fechaBD.toLocaleString()}`);
  console.log(`📅 Hora actual: ${new Date().toLocaleString()}`);
  
  const resultado = calcularEstadoDinamico(fechaDB, false);
  
  console.log(`\n📊 RESULTADO:`);
  console.log(`   Estado: ${resultado.estado}`);
  console.log(`   Mensaje: ${resultado.mensaje}`);
  console.log(`   Color: ${resultado.color}`);
  console.log(`   Urgencia: ${resultado.urgencia}`);
  
  return resultado;
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

// ===============================================
// 🔧 FUNCIÓN CORREGIDA: obtenerFechasCuatrimestre
// ===============================================
const obtenerFechasCuatrimestre = async (pool, periodo, cuatrimestre) => {
  try {
    console.log(`📅 Consultando fechas para periodo: ${periodo}, cuatrimestre: ${cuatrimestre}`);
    
    const periodoResult = await pool.request()
      .input('cuatrimestre', sql.VarChar, cuatrimestre)
      .query(`
        SELECT DISTINCT M.idPeriodo
        FROM tbl_materias M
        WHERE M.vchCuatrimestre = @cuatrimestre
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
          SELECT P.mesInicia, P.mesTermina
          FROM tbl_periodos P
          WHERE P.idPeriodo = @idPeriodo
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
// 🔧 FUNCIÓN CORREGIDA: obtenerDatosAlumno
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

    // PASO 2: CONSULTA DE MATERIAS CORREGIDA - USAR tbl_materias
    console.log(`🔍 Obteniendo materias del período detectado: ${periodoInfo.periodo}`);
    
    const materiasResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('periodo_detectado', sql.VarChar, periodoInfo.periodo)
      .input('cuatrimestre_alumno', sql.VarChar, periodoInfo.cuatrimestre)
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
          INNER JOIN tbl_materias M ON M.vchClvMateria = I.vchClvMateria AND M.idPeriodo = I.idPeriodo
          INNER JOIN tbl_docentes D ON D.vchClvTrabajador = AC.vchClvTrabajador
          WHERE A.vchMatricula = @matricula 
            AND I.vchPeriodo = @periodo_detectado
            AND M.vchCuatrimestre = @cuatrimestre_alumno

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
          INNER JOIN tbl_materias M ON M.vchClvMateria = I.vchClvMateria AND M.idPeriodo = I.idPeriodo
          INNER JOIN tbl_docentes D ON D.vchClvTrabajador = AC.vchClvTrabajador
          WHERE A.vchMatricula = @matricula 
            AND I.vchPeriodo = @periodo_detectado
            AND M.vchCuatrimestre = @cuatrimestre_alumno

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
          INNER JOIN tbl_materias M ON M.vchClvMateria = I.vchClvMateria AND M.idPeriodo = I.idPeriodo
          INNER JOIN tbl_docentes D ON D.vchClvTrabajador = AC.vchClvTrabajador
          WHERE A.vchMatricula = @matricula 
            AND I.vchPeriodo = @periodo_detectado
            AND M.vchCuatrimestre = @cuatrimestre_alumno
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
        fuente_materias: 'TBL_MATERIAS_PERIODO_AUTOMATICO',
        total_materias_encontradas: materias.length,
        version_bd: 'USANDO_TBL_MATERIAS_CORRECTA'
      }
    });

  } catch (err) {
    console.error('❌ Error al obtener datos del alumno (detección automática):', err);
    res.status(500).json({ mensaje: 'Error en el servidor al consultar alumno' });
  }
};

// ===============================================
// 🔧 FUNCIÓN CORREGIDA: obtenerActividadesPorAlumno
// ===============================================
const obtenerActividadesPorAlumno = async (req, res) => {
  const { matricula, materia } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log('🔍 === INICIO ACTIVIDADES (PERÍODO AUTOMÁTICO) ===');
    console.log(`📋 Parámetros: Matrícula: ${matricula}, Materia: ${materia}`);

    // 🆕 DETECTAR PERÍODO AUTOMÁTICAMENTE
    const periodoInfo = await detectarPeriodoAutomatico(pool, matricula);
    console.log(`📅 Usando período detectado: ${periodoInfo.periodo}`);

    // 🔧 CONSULTA CORREGIDA CON FECHAS SIN CONVERSIONES
    const result = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('materia', sql.VarChar, materia)
      .input('periodo_detectado', sql.VarChar, periodoInfo.periodo)
      .input('grupo_alumno', sql.VarChar, periodoInfo.grupo)
      .input('cuatrimestre_alumno', sql.VarChar, periodoInfo.cuatrimestre)
      .query(`
      WITH ActividadesUnicas AS (
        -- MODALIDAD 1: INDIVIDUAL
        SELECT 
          a.id_actividad,
          a.titulo,
          CAST(a.descripcion AS NVARCHAR(MAX)) as descripcion,
          a.id_modalidad,
          -- 🔧 FORMATEAR FECHAS SIN CONVERSIONES UTC
          CONVERT(VARCHAR(19), ag.fecha_asignacion, 120) as fecha_asignacion,
          CONVERT(VARCHAR(19), ag.fecha_entrega, 120) as fecha_entrega,
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
        INNER JOIN tbl_materias m ON ins.vchClvMateria = m.vchClvMateria AND ins.idPeriodo = m.idPeriodo
        INNER JOIN tbl_tipo_instrumento ti ON ti.id_tipo_instrumento = ins.id_tipo_instrumento
        INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
        INNER JOIN tbl_actividad_alumno aa ON a.id_actividad = aa.id_actividad
        LEFT JOIN tbl_cat_estados_reactivo cer ON aa.id_estado = cer.id_estado
        LEFT JOIN tbl_valor_componentes_evaluacion vce ON a.id_valor_componente = vce.id_valor_componente
        WHERE aa.vchMatricula = @matricula 
        AND m.vchNomMateria = @materia
        AND ins.vchPeriodo = @periodo_detectado
        AND m.vchCuatrimestre = @cuatrimestre_alumno
        AND a.id_modalidad = 1

        UNION ALL

        -- MODALIDAD 2: EQUIPO
        SELECT 
          a.id_actividad,
          a.titulo,
          CAST(a.descripcion AS NVARCHAR(MAX)) as descripcion,
          a.id_modalidad,
          CONVERT(VARCHAR(19), ag.fecha_asignacion, 120) as fecha_asignacion,
          CONVERT(VARCHAR(19), ag.fecha_entrega, 120) as fecha_entrega,
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
        INNER JOIN tbl_materias m ON ins.vchClvMateria = m.vchClvMateria AND ins.idPeriodo = m.idPeriodo
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
        AND m.vchCuatrimestre = @cuatrimestre_alumno
        AND a.id_modalidad = 2

        UNION ALL

        -- MODALIDAD 3: GRUPO
        SELECT 
          a.id_actividad,
          a.titulo,
          CAST(a.descripcion AS NVARCHAR(MAX)) as descripcion,
          a.id_modalidad,
          CONVERT(VARCHAR(19), ag.fecha_asignacion, 120) as fecha_asignacion,
          CONVERT(VARCHAR(19), ag.fecha_entrega, 120) as fecha_entrega,
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
        INNER JOIN tbl_materias m ON ins.vchClvMateria = m.vchClvMateria AND ins.idPeriodo = m.idPeriodo
        INNER JOIN tbl_tipo_instrumento ti ON ti.id_tipo_instrumento = ins.id_tipo_instrumento
        INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
        INNER JOIN tbl_grupos g ON ag.id_grupo = g.id_grupo
        LEFT JOIN tbl_actividad_alumno aa ON a.id_actividad = aa.id_actividad AND aa.vchMatricula = @matricula
        LEFT JOIN tbl_cat_estados_reactivo cer ON aa.id_estado = cer.id_estado
        LEFT JOIN tbl_valor_componentes_evaluacion vce ON a.id_valor_componente = vce.id_valor_componente
        WHERE g.vchGrupo = @grupo_alumno 
        AND m.vchNomMateria = @materia
        AND ins.vchPeriodo = @periodo_detectado
        AND m.vchCuatrimestre = @cuatrimestre_alumno
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

    // 🔧 PROCESAR ACTIVIDADES CON FUNCIÓN CORREGIDA
    const actividadesConEstadosDinamicos = result.recordset.map(actividad => {
      const estadoDinamico = calcularEstadoDinamico(
        actividad.fecha_entrega_raw,
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
        fuente_estado: 'FECHAS_CORREGIDAS_SIN_UTC'
      };
    });

    // 🔧 ORDENAMIENTO MEJORADO
    actividadesConEstadosDinamicos.sort((a, b) => {
      // Prioridad 1: Actividades finales no calificadas al inicio
      if (a.es_actividad_final && !b.es_actividad_final && !a.tiene_calificacion) return -1;
      if (b.es_actividad_final && !a.es_actividad_final && !b.tiene_calificacion) return 1;
      
      // Prioridad 2: Por urgencia (menor número = más urgente)
      if (a.estado_info.urgencia !== b.estado_info.urgencia) {
        return a.estado_info.urgencia - b.estado_info.urgencia;
      }
      
      // Prioridad 3: Por fecha de entrega
      return new Date(a.fecha_entrega) - new Date(b.fecha_entrega);
    });

    console.log('🔍 === FIN ACTIVIDADES (FECHAS CORREGIDAS) ===');

    res.json(actividadesConEstadosDinamicos);

  } catch (error) {
    console.error('❌ Error al obtener actividades (período automático):', error);
    res.status(500).json({ 
      mensaje: 'Error en el servidor al obtener actividades del alumno',
      error: error.message 
    });
  }
};

// ===============================================
// 🔧 FUNCIÓN CORREGIDA: obtenerDetalleActividad
// ===============================================
const obtenerDetalleActividad = async (req, res) => {
  const { matricula, idActividad } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`🔍 === DETALLE ACTIVIDAD (CON OBSERVACIONES) ===`);
    console.log(`📋 Parámetros: Matrícula: ${matricula}, ID Actividad: ${idActividad}`);

    // PASO 1: Verificar acceso del alumno a la actividad
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

    const modalidad = verificacionResult.recordset[0].id_modalidad;
    console.log(`🎯 Modalidad de actividad: ${modalidad}`);

    // PASO 2: Obtener detalles de la actividad con fechas corregidas
    const result = await pool.request()
      .input('idActividad', sql.Int, idActividad)
      .query(`
        SELECT 
          AC.id_actividad,
          AC.titulo,
          AC.descripcion,
          -- 🔧 FECHAS SIN CONVERSIONES UTC
          CONVERT(VARCHAR(19), AG.fecha_asignacion, 120) as fecha_asignacion,
          CONVERT(VARCHAR(19), AG.fecha_entrega, 120) as fecha_entrega,
          AG.fecha_entrega as fecha_entrega_raw,
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
        INNER JOIN tbl_materias M ON M.vchClvMateria = I.vchClvMateria AND M.idPeriodo = M.idPeriodo
        INNER JOIN tbl_tipo_instrumento TI ON TI.id_tipo_instrumento = I.id_tipo_instrumento
        INNER JOIN tbl_docentes D ON D.vchClvTrabajador = AC.vchClvTrabajador
        INNER JOIN tbl_actividad_grupo AG ON AG.id_actividad = AC.id_actividad
        WHERE AC.id_actividad = @idActividad
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Detalles de actividad no encontrados' });
    }

    const actividad = result.recordset[0];

    // 🔧 PASO 3: OBTENER OBSERVACIONES SEGÚN LA MODALIDAD
    let observaciones = null;
    
    console.log(`💬 Buscando observaciones para modalidad ${modalidad}...`);
    
    if (modalidad === 1) {
      // MODALIDAD INDIVIDUAL
      const obsResult = await pool.request()
        .input('idActividad', sql.Int, idActividad)
        .input('matricula', sql.VarChar, matricula)
        .query(`
          SELECT AA.observacion
          FROM tbl_actividad_alumno AA
          WHERE AA.id_actividad = @idActividad 
          AND AA.vchMatricula = @matricula
        `);
      
      if (obsResult.recordset.length > 0) {
        observaciones = obsResult.recordset[0].observacion;
        console.log(`✅ Observaciones INDIVIDUAL encontradas: "${observaciones}"`);
      } else {
        console.log(`ℹ️ No se encontró registro individual para actividad ${idActividad}, alumno ${matricula}`);
      }
      
    } else if (modalidad === 2) {
      // MODALIDAD EQUIPO
      const obsResult = await pool.request()
        .input('idActividad', sql.Int, idActividad)
        .input('matricula', sql.VarChar, matricula)
        .query(`
          SELECT AE.observacion
          FROM tbl_actividad_equipo AE
          INNER JOIN tbl_equipos E ON AE.id_equipo = E.id_equipo
          INNER JOIN tbl_equipo_alumno EA ON E.id_equipo = EA.id_equipo
          WHERE AE.id_actividad = @idActividad 
          AND EA.vchMatricula = @matricula
        `);
      
      if (obsResult.recordset.length > 0) {
        observaciones = obsResult.recordset[0].observacion;
        console.log(`✅ Observaciones EQUIPO encontradas: "${observaciones}"`);
      } else {
        console.log(`ℹ️ No se encontró registro de equipo para actividad ${idActividad}, alumno ${matricula}`);
      }
      
    } else if (modalidad === 3) {
      // MODALIDAD GRUPO - Las observaciones estarían en la actividad general o en registros específicos
      console.log(`ℹ️ Modalidad GRUPO: las observaciones están a nivel general`);
      observaciones = null; // Modalidad grupo normalmente no tiene observaciones individuales
    }

    // 🔧 LIMPIAR Y VALIDAR OBSERVACIONES
    if (observaciones) {
      observaciones = observaciones.trim();
      if (observaciones.length === 0) {
        observaciones = null;
      }
    }

    console.log(`💬 Observaciones finales: ${observaciones ? `"${observaciones}"` : 'null'}`);

    // PASO 4: Verificar criterios
    const criteriosDefinidos = await pool.request()
      .input('idInstrumento', sql.Int, actividad.id_instrumento)
      .query(`
        SELECT COUNT(c.id_criterio) as total_criterios
        FROM tbl_criterios c
        WHERE c.id_instrumento = @idInstrumento
      `);

    const totalCriteriosDefinidos = criteriosDefinidos.recordset[0]?.total_criterios || 0;
    const instrumentoTieneCriterios = totalCriteriosDefinidos > 0;

    // PASO 5: Verificar calificación
    const calificacionReal = await obtenerCalificacionRealActividad(pool, idActividad, matricula);
    
    // PASO 6: Manejo de criterios
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

    // PASO 7: Calcular estado dinámico con función corregida
    const estadoDinamico = calcularEstadoDinamico(
      actividad.fecha_entrega_raw,
      calificacionReal !== null,
      actividad.estado_original
    );

    // PASO 8: Respuesta CON OBSERVACIONES INCLUIDAS
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
      
      // 🆕 INCLUIR OBSERVACIONES CORRECTAMENTE
      observaciones: observaciones, // Puede ser null, string vacío, o string con contenido
      
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
      },
      
      estado_info: {
        mensaje: estadoDinamico.mensaje,
        color: estadoDinamico.color,
        icono: estadoDinamico.icono,
        urgencia: estadoDinamico.urgencia
      },
      
      fuente_calculo: 'FECHAS_CORREGIDAS_CON_OBSERVACIONES'
    };

    console.log(`✅ Detalle obtenido con observaciones: ${response.titulo}`);
    console.log(`💬 Observaciones incluidas: ${observaciones ? 'SÍ' : 'NO'}`);
    console.log(`🔍 === FIN DETALLE ACTIVIDAD ===`);

    res.json(response);

  } catch (error) {
    console.error('❌ Error al obtener detalle:', error);
    res.status(500).json({ 
      mensaje: 'Error en el servidor al obtener detalle de actividad',
      error: error.message 
    });
  }
};
// ===============================================
// 🔧 FUNCIÓN CORREGIDA: obtenerActividadesEntregadas
// ===============================================
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
      .input('cuatrimestre_alumno', sql.VarChar, periodoInfo.cuatrimestre)
      .query(`
        SELECT 
          a.id_actividad,
          a.titulo,
          CAST(a.descripcion AS NVARCHAR(MAX)) as descripcion,
          -- 🔧 FECHAS SIN CONVERSIONES UTC
          CONVERT(VARCHAR(19), ag.fecha_entrega, 120) as fecha_entrega,
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
          ROUND((SUM(eca.calificacion) * 10.0) / ins.valor_total, 2) as calificacion_real
        FROM tbl_evaluacion_criterioActividad eca
        INNER JOIN tbl_actividad_alumno aa ON eca.id_actividad_alumno = aa.id_actividad_alumno
        INNER JOIN tbl_actividades a ON aa.id_actividad = a.id_actividad
        INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
        INNER JOIN tbl_materias m ON ins.vchClvMateria = m.vchClvMateria AND ins.idPeriodo = m.idPeriodo
        INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
        WHERE aa.vchMatricula = @matricula 
        AND ins.vchPeriodo = @periodo_detectado
        AND m.vchCuatrimestre = @cuatrimestre_alumno
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
        ORDER BY ag.fecha_entrega DESC, a.titulo ASC
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

// ===============================================
// 🔧 CORRECCIÓN COMPLETA DE LA FUNCIÓN obtenerActividadEntregada
// ===============================================
const obtenerActividadEntregada = async (req, res) => {
  const { matricula, idActividad } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`🎯 === ACTIVIDAD ENTREGADA (CON PONDERACIÓN) ===`);
    console.log(`📋 Parámetros: Matrícula: ${matricula}, ID Actividad: ${idActividad}`);

    // Verificar calificación
    const calificacionReal = await obtenerCalificacionRealActividad(pool, idActividad, matricula);
    
    if (!calificacionReal) {
      return res.status(404).json({ 
        mensaje: 'Esta actividad aún no ha sido calificada por el profesor',
        codigo: 'SIN_CALIFICAR'
      });
    }

    // 🔧 CONSULTA MEJORADA CON INFORMACIÓN DE PONDERACIÓN
    const actividadResult = await pool.request()
      .input('idActividad', sql.Int, idActividad)
      .query(`
        SELECT 
          AC.id_actividad,
          AC.titulo,
          CAST(AC.descripcion AS NVARCHAR(MAX)) as descripcion,
          AC.id_modalidad,
          CONVERT(VARCHAR(19), AG.fecha_asignacion, 120) as fecha_asignacion,
          CONVERT(VARCHAR(19), AG.fecha_entrega, 120) as fecha_entrega,
          I.nombre as instrumento,
          I.valor_total as puntos_total,
          TI.nombre_tipo as tipoInstrumento,
          M.vchNomMateria as materia,
          CONCAT(D.vchNombre, ' ', D.vchAPaterno, ' ', ISNULL(D.vchAMaterno, '')) AS docente,
          CASE 
            WHEN I.parcial = 1 THEN 'Parcial 1'
            WHEN I.parcial = 2 THEN 'Parcial 2'
            WHEN I.parcial = 3 THEN 'Parcial 3'
            ELSE 'Actividad General'
          END as parcial,
          -- 🆕 INFORMACIÓN DE PONDERACIÓN
          ISNULL(VCE.valor_componente, 0) as valor_componente,
          ISNULL(VCE.componente, 'Actividad') as tipo_componente,
          ISNULL(VCE.parcial, I.parcial) as parcial_componente
        FROM tbl_actividades AC
        INNER JOIN tbl_instrumento I ON I.id_instrumento = AC.id_instrumento
        INNER JOIN tbl_materias M ON I.vchClvMateria = M.vchClvMateria AND I.idPeriodo = M.idPeriodo
        INNER JOIN tbl_tipo_instrumento TI ON TI.id_tipo_instrumento = I.id_tipo_instrumento
        INNER JOIN tbl_docentes D ON D.vchClvTrabajador = AC.vchClvTrabajador
        INNER JOIN tbl_actividad_grupo AG ON AG.id_actividad = AC.id_actividad
        -- 🆕 JOIN CON TABLA DE PONDERACIONES
        LEFT JOIN tbl_valor_componentes_evaluacion VCE ON AC.id_valor_componente = VCE.id_valor_componente
        WHERE AC.id_actividad = @idActividad
      `);

    if (actividadResult.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Actividad no encontrada' });
    }

    const actividadData = actividadResult.recordset[0]; // 🔧 USAR NOMBRE CORRECTO

    // 🆕 OBTENER TOTAL DE PUNTOS DE LA MATERIA PARA CALCULAR PORCENTAJE
    let totalPuntosMateria = 100; // Default
    try {
      const totalResult = await pool.request()
        .input('idActividad', sql.Int, idActividad)
        .query(`
          SELECT 
            SUM(ISNULL(VCE.valor_componente, 0)) as total_puntos_materia
          FROM tbl_actividades A
          INNER JOIN tbl_instrumento I ON A.id_instrumento = I.id_instrumento
          INNER JOIN tbl_actividades A2 ON A2.id_instrumento = I.id_instrumento
          LEFT JOIN tbl_valor_componentes_evaluacion VCE ON A2.id_valor_componente = VCE.id_valor_componente
          WHERE A.id_actividad = @idActividad
        `);
      
      if (totalResult.recordset.length > 0 && totalResult.recordset[0].total_puntos_materia > 0) {
        totalPuntosMateria = totalResult.recordset[0].total_puntos_materia;
      }
    } catch (error) {
      console.log(`⚠️ Error al obtener total de puntos: ${error.message}`);
    }
   // A:
let observaciones = null;
try {
  const obsResult = await pool.request()
    .input('idActividad', sql.Int, idActividad)
    .input('matricula', sql.VarChar, matricula)
    .query(`
      SELECT observacion
      FROM tbl_actividad_alumno AA
      WHERE AA.id_actividad = @idActividad 
      AND AA.vchMatricula = @matricula
      AND observacion IS NOT NULL
      AND LTRIM(RTRIM(observacion)) != ''
    `);
  
  if (obsResult.recordset.length > 0) {
    observaciones = obsResult.recordset[0].observacion;
    console.log(`✅ Observaciones encontradas: "${observaciones}"`);
  } else {
    console.log(`ℹ️ Sin observaciones para actividad ${idActividad}, alumno ${matricula}`);
  }
} catch (obsError) {
  console.log(`⚠️ Error al obtener observaciones: ${obsError.message}`);
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
      rubrica = [
        {
          criterio: 'Calificación general',
          descripcion: 'Evaluación general de la actividad',
          puntos_maximos: actividadData.puntos_total,
          puntos_obtenidos: calificacionReal.puntos_obtenidos_total,
          cumplido: calificacionReal.calificacion_sobre_10 >= 6,
          icono: calificacionReal.calificacion_sobre_10 >= 6 ? '✅' : '❌',
          calificado: true
        }
      ];
    }

    // 🆕 CALCULAR INFORMACIÓN DE PONDERACIÓN
    const valorComponente = actividadData.valor_componente || 0;
    const calificacionObtenida = calificacionReal.calificacion_sobre_10;
    
    let ponderacionInfo = {
      valor_componente: valorComponente,
      tipo_componente: actividadData.tipo_componente || 'Actividad',
      contribucion_puntos: 0,
      contribucion_porcentaje: 0,
      explicacion: 'Sin ponderación definida'
    };

    if (valorComponente > 0) {
      // Calcular contribución en puntos
      const contribucionPuntos = (calificacionObtenida * valorComponente) / 10;
      
      // Calcular porcentaje que representa del total
      const contribucionPorcentaje = (valorComponente / totalPuntosMateria) * 100;
      
      ponderacionInfo = {
        valor_componente: valorComponente,
        tipo_componente: actividadData.tipo_componente,
        contribucion_puntos: Math.round(contribucionPuntos * 100) / 100,
        contribucion_porcentaje: Math.round(contribucionPorcentaje * 10) / 10,
        explicacion: `Esta actividad vale ${valorComponente} puntos (${contribucionPorcentaje.toFixed(1)}% del total de la materia)`
      };
      
      console.log(`📊 Ponderación calculada: ${calificacionObtenida}/10 × ${valorComponente} pts = ${ponderacionInfo.contribucion_puntos} pts`);
    }

    // 🔧 RESPUESTA FINAL CON INFORMACIÓN DE PONDERACIÓN
    const response = {
      id_actividad: actividadData.id_actividad,
      titulo: actividadData.titulo,
      descripcion: actividadData.descripcion || 'Sin descripción disponible',
      fecha_asignacion: actividadData.fecha_asignacion,
      fecha_entrega: actividadData.fecha_entrega,
      estado: 'Calificada',
      instrumento: actividadData.instrumento,
      tipoInstrumento: actividadData.tipoInstrumento,
      materia: actividadData.materia,
      docente: actividadData.docente,
      parcial: actividadData.parcial,
      puntos_total: actividadData.puntos_total,
      puntos_obtenidos: calificacionReal.puntos_obtenidos_total,
      calificacion: calificacionReal.calificacion_sobre_10,
      observaciones: observaciones,
      retroalimentacion: observaciones !== 'Sin observaciones registradas' ? observaciones : 'Sin retroalimentación específica',
      id_modalidad: actividadData.id_modalidad,
      modalidad_nombre: actividadData.id_modalidad === 1 ? 'Individual' : 
                       actividadData.id_modalidad === 2 ? 'Equipo' : 'Grupo',
      rubrica: rubrica,
      criterios_calificados: calificacionReal.criterios_calificados,
      
      // 🆕 INFORMACIÓN DE PONDERACIÓN
      ponderacion: ponderacionInfo,
      
      fuente_calificacion: 'CON_PONDERACION_REAL'
    };

    console.log(`✅ Actividad entregada: ${response.titulo}`);
    console.log(`📊 Ponderación: ${ponderacionInfo.valor_componente} pts (${ponderacionInfo.contribucion_porcentaje}%)`);

    res.json(response);

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ 
      mensaje: 'Error en el servidor',
      error: error.message 
    });
  }
};

// ===============================================
// 🔧 FUNCIÓN BACKEND COMPLETA CON PONDERACIÓN EN HISTORIAL
// ===============================================
const obtenerCalificacionesHistoricas = async (req, res) => {
  const { matricula } = req.params;
  const { todos_periodos } = req.query;

  try {
    const pool = await sql.connect(config);

    console.log(`🎓 === CALIFICACIONES HISTÓRICAS (PONDERACIÓN COMPLETA) ===`);

    // 🆕 DETECTAR PERÍODO AUTOMÁTICAMENTE
    const periodoInfo = await detectarPeriodoAutomatico(pool, matricula);
    console.log(`📅 Usando período detectado: ${periodoInfo.periodo}`);

    // Construir filtros dinámicos
    let whereClause = 'WHERE 1=1';
    
    if (!todos_periodos || todos_periodos !== 'true') {
      whereClause += ' AND i.vchPeriodo = @periodo_detectado';
      whereClause += ' AND m.vchCuatrimestre = @cuatrimestre_alumno';
      console.log(`📅 Filtrando solo período detectado: ${periodoInfo.periodo}`);
    } else {
      console.log(`📅 Obteniendo TODOS los períodos`);
    }

    // 🔧 CONSULTA MEJORADA: INCLUIR INFORMACIÓN COMPLETA DE PONDERACIÓN
    const result = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('periodo_detectado', sql.VarChar, periodoInfo.periodo)
      .input('cuatrimestre_alumno', sql.VarChar, periodoInfo.cuatrimestre)
      .input('grupo_alumno', sql.VarChar, periodoInfo.grupo)
      .query(`
        WITH TodasLasActividadesConPonderacion AS (
          -- MODALIDAD 1: INDIVIDUAL
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
            ins.nombre as instrumento,
            ti.nombre_tipo as tipoInstrumento,
            CONCAT(d.vchNombre, ' ', d.vchAPaterno, ' ', ISNULL(d.vchAMaterno, '')) AS Docente,
            
            -- 🆕 INFORMACIÓN COMPLETA DE PONDERACIÓN
            ISNULL(vce.valor_componente, 0) as valor_componente,
            ISNULL(vce.componente, 'Actividad') as tipo_componente,
            
            -- 🔧 CALIFICACIONES REALES O CERO
            ISNULL((
              SELECT SUM(eca.calificacion) 
              FROM tbl_evaluacion_criterioActividad eca
              INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
              WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
            ), 0) as puntos_obtenidos,
            i.valor_total as puntos_totales,
            
            -- 🔧 CALIFICACIÓN SOBRE 10 O CERO
            CASE 
              WHEN EXISTS (
                SELECT 1 FROM tbl_evaluacion_criterioActividad eca 
                INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
                WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
              ) THEN ROUND((
                SELECT SUM(eca.calificacion) 
                FROM tbl_evaluacion_criterioActividad eca
                INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
                WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
              ) * 10.0 / i.valor_total, 2)
              ELSE 0 
            END as calificacion_final,
            
            -- 🆕 CONTRIBUCIÓN PONDERADA CALCULADA
            CASE 
              WHEN EXISTS (
                SELECT 1 FROM tbl_evaluacion_criterioActividad eca 
                INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
                WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
              ) AND ISNULL(vce.valor_componente, 0) > 0 
              THEN ROUND((
                SELECT SUM(eca.calificacion) 
                FROM tbl_evaluacion_criterioActividad eca
                INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
                WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
              ) * 10.0 / i.valor_total * ISNULL(vce.valor_componente, 0) / 10.0, 2)
              ELSE 0 
            END as contribucion_obtenida,
            
            -- 🔧 ESTADO REAL
            CASE 
              WHEN EXISTS (
                SELECT 1 FROM tbl_evaluacion_criterioActividad eca 
                INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
                WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
              ) THEN 'Calificada'
              ELSE 'Pendiente'
            END as estado,
            
            -- 🔧 FECHA DE ENTREGA
            CONVERT(VARCHAR(19), ag.fecha_entrega, 120) as fecha_entrega,
            
            -- 🔧 MODALIDAD
            CASE 
              WHEN a.id_modalidad = 1 THEN 'Individual'
              WHEN a.id_modalidad = 2 THEN 'Equipo'
              WHEN a.id_modalidad = 3 THEN 'Grupo'
              ELSE 'Desconocida'
            END as modalidad,
            
            -- 🆕 CRITERIOS CALIFICADOS
            ISNULL((
              SELECT COUNT(*) 
              FROM tbl_evaluacion_criterioActividad eca
              INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
              WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
            ), 0) as criterios_calificados
            
          FROM tbl_actividades a
          INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
          INNER JOIN tbl_materias m ON i.vchClvMateria = m.vchClvMateria AND i.idPeriodo = m.idPeriodo
          INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
          INNER JOIN tbl_tipo_instrumento ti ON i.id_tipo_instrumento = ti.id_tipo_instrumento
          INNER JOIN tbl_docentes d ON d.vchClvTrabajador = a.vchClvTrabajador
          INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
          INNER JOIN tbl_actividad_alumno aa ON a.id_actividad = aa.id_actividad
          LEFT JOIN tbl_valor_componentes_evaluacion vce ON a.id_valor_componente = vce.id_valor_componente
          WHERE aa.vchMatricula = @matricula 
          AND a.id_modalidad = 1
          ${whereClause.replace('WHERE 1=1', '')}

          UNION ALL

          -- MODALIDAD 2: EQUIPO (estructura similar)
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
            ins.nombre as instrumento,
            ti.nombre_tipo as tipoInstrumento,
            CONCAT(d.vchNombre, ' ', d.vchAPaterno, ' ', ISNULL(d.vchAMaterno, '')) AS Docente,
            ISNULL(vce.valor_componente, 0) as valor_componente,
            ISNULL(vce.componente, 'Actividad') as tipo_componente,
            ISNULL((
              SELECT SUM(eca.calificacion) 
              FROM tbl_evaluacion_criterioActividad eca
              INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
              WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
            ), 0) as puntos_obtenidos,
            i.valor_total as puntos_totales,
            CASE 
              WHEN EXISTS (
                SELECT 1 FROM tbl_evaluacion_criterioActividad eca 
                INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
                WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
              ) THEN ROUND((
                SELECT SUM(eca.calificacion) 
                FROM tbl_evaluacion_criterioActividad eca
                INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
                WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
              ) * 10.0 / i.valor_total, 2)
              ELSE 0 
            END as calificacion_final,
            CASE 
              WHEN EXISTS (
                SELECT 1 FROM tbl_evaluacion_criterioActividad eca 
                INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
                WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
              ) AND ISNULL(vce.valor_componente, 0) > 0 
              THEN ROUND((
                SELECT SUM(eca.calificacion) 
                FROM tbl_evaluacion_criterioActividad eca
                INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
                WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
              ) * 10.0 / i.valor_total * ISNULL(vce.valor_componente, 0) / 10.0, 2)
              ELSE 0 
            END as contribucion_obtenida,
            CASE 
              WHEN EXISTS (
                SELECT 1 FROM tbl_evaluacion_criterioActividad eca 
                INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
                WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
              ) THEN 'Calificada'
              ELSE 'Pendiente'
            END as estado,
            CONVERT(VARCHAR(19), ag.fecha_entrega, 120) as fecha_entrega,
            CASE 
              WHEN a.id_modalidad = 1 THEN 'Individual'
              WHEN a.id_modalidad = 2 THEN 'Equipo'
              WHEN a.id_modalidad = 3 THEN 'Grupo'
              ELSE 'Desconocida'
            END as modalidad,
            ISNULL((
              SELECT COUNT(*) 
              FROM tbl_evaluacion_criterioActividad eca
              INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
              WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
            ), 0) as criterios_calificados
          FROM tbl_actividades a
          INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
          INNER JOIN tbl_materias m ON i.vchClvMateria = m.vchClvMateria AND i.idPeriodo = m.idPeriodo
          INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
          INNER JOIN tbl_tipo_instrumento ti ON i.id_tipo_instrumento = ti.id_tipo_instrumento
          INNER JOIN tbl_docentes d ON d.vchClvTrabajador = a.vchClvTrabajador
          INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
          INNER JOIN tbl_actividad_equipo ae ON a.id_actividad = ae.id_actividad
          INNER JOIN tbl_equipos e ON ae.id_equipo = e.id_equipo
          INNER JOIN tbl_equipo_alumno ea ON e.id_equipo = ea.id_equipo
          LEFT JOIN tbl_valor_componentes_evaluacion vce ON a.id_valor_componente = vce.id_valor_componente
          WHERE ea.vchMatricula = @matricula 
          AND a.id_modalidad = 2
          ${whereClause.replace('WHERE 1=1', '')}

          UNION ALL

          -- MODALIDAD 3: GRUPO (estructura similar)
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
            ins.nombre as instrumento,
            ti.nombre_tipo as tipoInstrumento,
            CONCAT(d.vchNombre, ' ', d.vchAPaterno, ' ', ISNULL(d.vchAMaterno, '')) AS Docente,
            ISNULL(vce.valor_componente, 0) as valor_componente,
            ISNULL(vce.componente, 'Actividad') as tipo_componente,
            ISNULL((
              SELECT SUM(eca.calificacion) 
              FROM tbl_evaluacion_criterioActividad eca
              INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
              WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
            ), 0) as puntos_obtenidos,
            i.valor_total as puntos_totales,
            CASE 
              WHEN EXISTS (
                SELECT 1 FROM tbl_evaluacion_criterioActividad eca 
                INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
                WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
              ) THEN ROUND((
                SELECT SUM(eca.calificacion) 
                FROM tbl_evaluacion_criterioActividad eca
                INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
                WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
              ) * 10.0 / i.valor_total, 2)
              ELSE 0 
            END as calificacion_final,
            CASE 
              WHEN EXISTS (
                SELECT 1 FROM tbl_evaluacion_criterioActividad eca 
                INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
                WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
              ) AND ISNULL(vce.valor_componente, 0) > 0 
              THEN ROUND((
                SELECT SUM(eca.calificacion) 
                FROM tbl_evaluacion_criterioActividad eca
                INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
                WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
              ) * 10.0 / i.valor_total * ISNULL(vce.valor_componente, 0) / 10.0, 2)
              ELSE 0 
            END as contribucion_obtenida,
            CASE 
              WHEN EXISTS (
                SELECT 1 FROM tbl_evaluacion_criterioActividad eca 
                INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
                WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
              ) THEN 'Calificada'
              ELSE 'Pendiente'
            END as estado,
            CONVERT(VARCHAR(19), ag.fecha_entrega, 120) as fecha_entrega,
            CASE 
              WHEN a.id_modalidad = 1 THEN 'Individual'
              WHEN a.id_modalidad = 2 THEN 'Equipo'
              WHEN a.id_modalidad = 3 THEN 'Grupo'
              ELSE 'Desconocida'
            END as modalidad,
            ISNULL((
              SELECT COUNT(*) 
              FROM tbl_evaluacion_criterioActividad eca
              INNER JOIN tbl_actividad_alumno aa_cal ON eca.id_actividad_alumno = aa_cal.id_actividad_alumno
              WHERE aa_cal.id_actividad = a.id_actividad AND aa_cal.vchMatricula = @matricula
            ), 0) as criterios_calificados
          FROM tbl_actividades a
          INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
          INNER JOIN tbl_materias m ON i.vchClvMateria = m.vchClvMateria AND i.idPeriodo = m.idPeriodo
          INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
          INNER JOIN tbl_tipo_instrumento ti ON i.id_tipo_instrumento = ti.id_tipo_instrumento
          INNER JOIN tbl_docentes d ON d.vchClvTrabajador = a.vchClvTrabajador
          INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
          INNER JOIN tbl_grupos g ON ag.id_grupo = g.id_grupo
          LEFT JOIN tbl_valor_componentes_evaluacion vce ON a.id_valor_componente = vce.id_valor_componente
          WHERE g.vchGrupo = @grupo_alumno 
          AND a.id_modalidad = 3
          ${whereClause.replace('WHERE 1=1', '')}
        )
        SELECT *
        FROM TodasLasActividadesConPonderacion
        ORDER BY periodo DESC, materia, parcial, fecha_entrega
      `);

    console.log(`📊 Actividades encontradas (con ponderación): ${result.recordset.length}`);

    if (result.recordset.length === 0) {
      return res.json([]);
    }

    // 🔧 AGRUPAR Y CALCULAR PROMEDIOS CON PONDERACIÓN COMPLETA
    const calificacionesPorPeriodo = {};
    
    result.recordset.forEach(act => {
      // Inicializar período
      if (!calificacionesPorPeriodo[act.periodo]) {
        calificacionesPorPeriodo[act.periodo] = {
          periodo: act.periodo,
          materias: {},
          promedio: 0
        };
      }
      
      // Inicializar materia
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
      
      // 🆕 AGREGAR ACTIVIDAD CON INFORMACIÓN COMPLETA DE PONDERACIÓN
      calificacionesPorPeriodo[act.periodo].materias[act.materia].actividades.push({
        id_actividad: act.id_actividad,
        titulo: act.titulo,
        calificacion: act.calificacion_final || 0,
        puntos_obtenidos: act.puntos_obtenidos || 0,
        puntos_total: act.puntos_totales,
        fecha_entrega: act.fecha_entrega,
        parcial: act.parcial,
        instrumento: act.instrumento,
        tipoInstrumento: act.tipoInstrumento,
        estado: act.estado,
        modalidad: act.modalidad,
        criterios_calificados: act.criterios_calificados || 0,
        // 🆕 INFORMACIÓN COMPLETA DE PONDERACIÓN
        valor_componente: act.valor_componente || 0,
        tipo_componente: act.tipo_componente || 'Actividad',
        contribucion_obtenida: act.contribucion_obtenida || 0
      });
    });

    // 🔧 CALCULAR PROMEDIOS CON PONDERACIÓN REAL
    const calificaciones = Object.values(calificacionesPorPeriodo).map(periodo => {
      const materiasList = Object.values(periodo.materias);
      
      materiasList.forEach(materia => {
        if (materia.actividades.length > 0) {
          // 🔧 CALCULAR PROMEDIO PONDERADO
          let sumaCalificacionesPonderadas = 0;
          let sumaPonderaciones = 0;
          
          materia.actividades.forEach(actividad => {
            const ponderacion = actividad.valor_componente || 1;
            sumaCalificacionesPonderadas += (actividad.calificacion * ponderacion);
            sumaPonderaciones += ponderacion;
            
            console.log(`📊 ${actividad.titulo}: Cal=${actividad.calificacion}, Pond=${ponderacion}, Contribución=${actividad.contribucion_obtenida}`);
          });
          
          materia.promedio = sumaPonderaciones > 0 
            ? Math.round((sumaCalificacionesPonderadas / sumaPonderaciones) * 10) / 10
            : 0;
          
          materia.calificacion = materia.promedio;
          
          if (materia.promedio >= 6) {
            materia.estado = 'Aprobada';
          } else if (materia.promedio > 0) {
            materia.estado = 'Reprobada';
          } else {
            materia.estado = 'En curso';
          }
        }
      });
      
      // Calcular promedio del período
      const materiasConCalificaciones = materiasList.filter(mat => mat.promedio > 0);
      if (materiasConCalificaciones.length > 0) {
        const sumaPromediosMaterias = materiasConCalificaciones.reduce((sum, mat) => sum + mat.promedio, 0);
        periodo.promedio = Math.round((sumaPromediosMaterias / materiasConCalificaciones.length) * 10) / 10;
      }
      
      periodo.materias = materiasList;
      
      // 🆕 AGREGAR INFORMACIÓN DE PERÍODO AUTOMÁTICO
      if (periodo.periodo === periodoInfo.periodo) {
        periodo.periodo_info = {
          detectado_automaticamente: periodoInfo.automatico,
          periodo_registrado: periodoInfo.periodo_registrado,
          periodo_detectado: periodoInfo.periodo,
          razon: periodoInfo.razon,
          timestamp: periodoInfo.timestamp
        };
      }
      
      return periodo;
    });

    calificaciones.sort((a, b) => b.periodo.localeCompare(a.periodo));

    console.log(`🎓 === FIN CALIFICACIONES (PONDERACIÓN COMPLETA) ===`);

    res.json(calificaciones);

  } catch (error) {
    console.error('❌ Error calificaciones históricas:', error);
    res.status(500).json({ 
      mensaje: 'Error en el servidor al obtener calificaciones',
      error: error.message 
    });
  }
};

// ===============================================
// FUNCIÓN SIN CAMBIOS: cambiarContrasena
// ===============================================
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
// 🧪 FUNCIÓN DE PRUEBA PARA FECHAS
// ===============================================
const probarCalculoEstado = () => {
  console.log('\n🧪 === PRUEBA DE CÁLCULO DE ESTADO ===');
  
  // Simular diferentes casos
  const ahora = new Date();
  const unaHoraDespues = new Date(ahora.getTime() + (60 * 60 * 1000)); // +1 hora
  const dosHorasAntes = new Date(ahora.getTime() - (2 * 60 * 60 * 1000)); // -2 horas
  
  console.log(`🕐 Hora actual: ${ahora.toLocaleString()}`);
  
  // Caso 1: Actividad que vence en 1 hora
  console.log('\n📝 CASO 1: Actividad que vence en 1 hora');
  const resultado1 = calcularEstadoDinamico(unaHoraDespues, false);
  console.log(`   Estado: ${resultado1.estado}`);
  console.log(`   Mensaje: ${resultado1.mensaje}`);
  
  // Caso 2: Actividad que venció hace 2 horas
  console.log('\n📝 CASO 2: Actividad que venció hace 2 horas');
  const resultado2 = calcularEstadoDinamico(dosHorasAntes, false);
  console.log(`   Estado: ${resultado2.estado}`);
  console.log(`   Mensaje: ${resultado2.mensaje}`);
  
  // Caso 3: Actividad calificada
  console.log('\n📝 CASO 3: Actividad calificada');
  const resultado3 = calcularEstadoDinamico(dosHorasAntes, true);
  console.log(`   Estado: ${resultado3.estado}`);
  console.log(`   Mensaje: ${resultado3.mensaje}`);
  
  return { resultado1, resultado2, resultado3 };
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
  // 🆕 EXPORTAR FUNCIONES AUXILIARES
  detectarPeriodoAutomatico,
  calcularEstadoDinamico,
  probarCalculoEstado,
  verificarEstadoActividad,
  probarConFechaReal
};