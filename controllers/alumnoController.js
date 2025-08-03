const { sql, config } = require('../db/sqlConfig');

// ===============================================
// 🔧 FUNCIÓN ADAPTADA: detectarPeriodoAutomatico CON SP
// ===============================================
const detectarPeriodoAutomatico = async (pool, matricula) => {
  try {
    console.log(`🔍 === DETECTANDO PERÍODO AUTOMÁTICO PARA ${matricula} ===`);
    
    // PASO 1: Obtener datos básicos del alumno usando SP
    const alumnoResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .execute('sp_detectarPeriodoAutomatico');

    if (alumnoResult.recordset.length === 0) {
      throw new Error('Alumno no encontrado');
    }

    const alumno = alumnoResult.recordset[0];
    console.log(`📋 Alumno: cuatrimestre=${alumno.cuatrimestre}, período_registrado=${alumno.periodo_registrado}`);

    // PASO 2: Detectar el período MÁS RECIENTE con actividades para el alumno usando SP
    const periodoMasReciente = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .execute('sp_periodoMasReciente');

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
    // Fallback al período registrado del alumno usando SP
    const fallbackResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .execute('sp_fallbackResult');
    
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
// FUNCIONES AUXILIARES PARA CALIFICACIONES REALES ADAPTADAS CON SP
// ===============================================

const obtenerCalificacionRealActividad = async (pool, idActividad, matricula) => {
  try {
    console.log(`📊 Buscando calificación real para actividad ${idActividad}, alumno ${matricula}`);
    
    const result = await pool.request()
      .input('idActividad', sql.Int, idActividad)
      .input('matricula', sql.VarChar, matricula)
      .execute('sp_obtenerCalificacionRealActividad');
    
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
      .execute('sp_obtenerCriteriosCalificadosReales');
    
    console.log(`📋 Criterios encontrados: ${result.recordset.length}`);
    return result.recordset;
  } catch (error) {
    console.log(`⚠️ Error al obtener criterios calificados: ${error.message}`);
    return [];
  }
};

// ===============================================
// 🔧 FUNCIÓN ADAPTADA: obtenerFechasCuatrimestre CON SP
// ===============================================
const obtenerFechasCuatrimestre = async (pool, periodo, cuatrimestre) => {
  try {
    console.log(`📅 Consultando fechas para periodo: ${periodo}, cuatrimestre: ${cuatrimestre}`);
    
    const periodoResult = await pool.request()
      .input('periodo', sql.VarChar, periodo)
      .input('cuatrimestre', sql.VarChar, cuatrimestre)
      .execute('sp_obtenerFechasCuatrimestre');

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
        .execute('sp_fechasResult');
        
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
// 🔧 FUNCIÓN CORREGIDA: obtenerDatosAlumno CON SP
// ===============================================
const obtenerDatosAlumno = async (req, res) => {
  const { matricula } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`🔍 === INICIO DATOS ALUMNO (SP CORREGIDO) ===`);
    console.log(`📋 Matrícula: ${matricula}`);

    // PASO 1: Ejecutar SP que incluye detección de período Y datos del alumno
    const alumnoResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .execute('sp_obtenerDatosAlumno');

    // El SP retorna múltiples recordsets:
    // recordsets[0]: resultado de sp_DetectarPeriodoAutomatico (periodo info)
    // recordsets[1]: datos del alumno (nombre, carrera, etc.)
    
    if (!alumnoResult.recordsets || alumnoResult.recordsets.length < 2) {
      return res.status(404).json({ mensaje: 'Error al obtener datos del alumno' });
    }

    // PASO 2: Extraer datos del período (primer recordset)
    const periodoData = alumnoResult.recordsets[0][0];
    if (!periodoData) {
      return res.status(404).json({ mensaje: 'No se pudo detectar período para el alumno' });
    }

    // PASO 3: Extraer datos del alumno (segundo recordset)  
    const alumnoData = alumnoResult.recordsets[1][0];
    if (!alumnoData) {
      return res.status(404).json({ mensaje: 'Alumno no encontrado' });
    }

    console.log(`✅ Alumno encontrado: ${alumnoData.nombre}`);
    console.log(`📅 Período detectado: ${periodoData.periodo_registrado}`);

    // PASO 4: Construir info del período
    const periodoInfo = {
      periodo: periodoData.periodo_registrado,
      cuatrimestre: periodoData.cuatrimestre,
      grupo: periodoData.grupo,
      periodo_registrado: periodoData.periodo_registrado,
      automatico: false, // SP ya maneja la lógica
      razon: 'Obtenido via SP integrado',
      timestamp: new Date().toISOString()
    };

    // PASO 5: Obtener fechas del cuatrimestre
    const fechasCuatrimestre = await obtenerFechasCuatrimestre(pool, periodoInfo.periodo, periodoInfo.cuatrimestre);

    // PASO 6: Obtener materias usando SP
    console.log(`🔍 Obteniendo materias del período: ${periodoInfo.periodo}`);
    
    const materiasResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('periodo_detectado', sql.VarChar, periodoInfo.periodo)
      .input('cuatrimestre_alumno', sql.VarChar, periodoInfo.cuatrimestre)
      .execute('sp_materiasResult');

    console.log(`📚 Materias encontradas: ${materiasResult.recordset.length}`);

    // PASO 7: Formatear materias
    const materias = materiasResult.recordset.map(m => ({
      nombre: m.nombreMateria,
      grupo: alumnoData.grupo,
      profesor: m.Docente,
      icono: m.nombreMateria.charAt(0),
      tipoAcceso: m.TipoAcceso
    }));

    console.log(`✅ ${materias.length} materias procesadas`);
    console.log(`🔍 === FIN DATOS ALUMNO (SP CORREGIDO) ===`);

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
      periodo_info: {
        detectado_automaticamente: periodoInfo.automatico,
        periodo_registrado: periodoInfo.periodo_registrado,
        periodo_detectado: periodoInfo.periodo,
        razon: periodoInfo.razon,
        timestamp: periodoInfo.timestamp
      },
      diagnostico: {
        fuente_materias: 'SP_MATERIAS_RESULT_CORREGIDO',
        total_materias_encontradas: materias.length,
        version_bd: 'SP_MULTIPLE_RECORDSETS_FIXED'
      }
    });

  } catch (err) {
    console.error('❌ Error al obtener datos del alumno (SP):', err);
    res.status(500).json({ mensaje: 'Error en el servidor al consultar alumno' });
  }
};

// ===============================================
// 🔧 FUNCIÓN ADAPTADA: obtenerActividadesPorAlumno CON SP
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

    // 🔧 CONSULTA USANDO SP
    const result = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('materia', sql.VarChar, materia)
      .execute('sp_ObtenerActividadesPorAlumno');

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
        fuente_estado: 'SP_ACTIVIDADES_CORREGIDAS'
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

const obtenerDetalleActividad = async (req, res) => {
  const { matricula, idActividad } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`🔍 === DETALLE ACTIVIDAD (OBSERVACIONES CORREGIDAS) ===`);
    console.log(`📋 Parámetros: Matrícula: ${matricula}, ID Actividad: ${idActividad}`);

    // PASO 1: Ejecutar SP para obtener detalle de actividad
    const result = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('idActividad', sql.Int, idActividad)
      .execute('sp_obtenerDetalleActividad');

    if (result.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Actividad no encontrada o sin acceso' });
    }

    const actividad = result.recordset[0];

    // Verificar si hay error en el resultado del SP
    if (actividad.resultado === 'ERROR') {
      return res.status(404).json({ mensaje: actividad.mensaje });
    }

    // PASO 2: Verificar criterios definidos usando SP
    const criteriosDefinidos = await pool.request()
      .input('idInstrumento', sql.Int, actividad.id_instrumento)
      .execute('sp_ObtenerCriteriosSinCalificar');

    const totalCriteriosDefinidos = criteriosDefinidos.recordset.length;
    const instrumentoTieneCriterios = totalCriteriosDefinidos > 0;

    // PASO 3: Verificar calificación
    const calificacionReal = await obtenerCalificacionRealActividad(pool, idActividad, matricula);
    
    // 🔧 PASO 3.5: FIX OBSERVACIONES - Consulta directa para actividades calificadas
    let observacionesCorrectas = actividad.observaciones;
    
    if (calificacionReal !== null) {
      // Si está calificada, obtener observación directamente de la tabla específica del alumno
      try {
        console.log(`🔧 Actividad calificada - Obteniendo observación específica del alumno`);
        
        const observacionDirecta = await pool.request()
          .input('matricula', sql.VarChar, matricula)
          .input('idActividad', sql.Int, idActividad)
          .query(`
            SELECT observacion
            FROM tbl_actividad_alumno 
            WHERE vchMatricula = @matricula 
            AND id_actividad = @idActividad
          `);

        if (observacionDirecta.recordset.length > 0) {
          const observacionEspecifica = observacionDirecta.recordset[0].observacion;
          
          // Solo usar la observación si realmente tiene contenido
          if (observacionEspecifica && observacionEspecifica.trim() !== '' && observacionEspecifica !== 'Sin observaciones registradas') {
            observacionesCorrectas = observacionEspecifica.trim();
            console.log(`✅ Observación específica del alumno: "${observacionesCorrectas}"`);
          } else {
            observacionesCorrectas = null;
            console.log(`ℹ️ Este alumno no tiene observación específica`);
          }
        } else {
          observacionesCorrectas = null;
          console.log(`ℹ️ No se encontró registro para este alumno en la actividad`);
        }
        
      } catch (error) {
        console.log(`⚠️ Error al obtener observación específica:`, error.message);
        // Mantener las observaciones originales si hay error
      }
    } else {
      console.log(`ℹ️ Actividad no calificada - Usando observaciones originales`);
    }

    // PASO 4: Manejo de criterios
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
        rubrica = criteriosDefinidos.recordset.map(criterio => ({
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

    // PASO 5: Calcular estado dinámico con función corregida
    const estadoDinamico = calcularEstadoDinamico(
      actividad.fecha_entrega_raw,
      calificacionReal !== null,
      actividad.estado_original
    );

    // PASO 6: Respuesta CON OBSERVACIONES CORREGIDAS
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
      
      // 🔧 USAR OBSERVACIONES CORREGIDAS
      observaciones: observacionesCorrectas,
      
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
      
      fuente_calculo: 'SP_DETALLE_OBSERVACIONES_CORREGIDAS_CONTROLLER'
    };

    console.log(`✅ Detalle obtenido con observaciones CORREGIDAS: ${response.titulo}`);
    console.log(`💬 Observaciones corregidas incluidas: ${observacionesCorrectas ? 'SÍ' : 'NO'}`);
    console.log(`🔧 Fix aplicado desde controller - No afecta BD`);
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
// 🔧 FUNCIÓN ADAPTADA: obtenerActividadesEntregadas CON SP
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
      .execute('obtenerActividadesEntregadas');

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
// 🔧 ADAPTACIÓN COMPLETA DE LA FUNCIÓN obtenerActividadEntregada CON SP
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

    // 🔧 CONSULTA USANDO SP
    const actividadResult = await pool.request()
      .input('idActividad', sql.Int, idActividad)
      .input('matricula', sql.VarChar, matricula)
      .execute('obtenerActividadEntregada');

    if (actividadResult.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Actividad no encontrada' });
    }

    const actividadData = actividadResult.recordset[0];

    // Las observaciones vienen en el segundo recordset del SP
    let observaciones = null;
    if (actividadResult.recordsets.length > 1 && actividadResult.recordsets[1].length > 0) {
      observaciones = actividadResult.recordsets[1][0].observacion;
      console.log(`✅ Observaciones encontradas: "${observaciones}"`);
    } else {
      console.log(`ℹ️ Sin observaciones para actividad ${idActividad}, alumno ${matricula}`);
    }

    // 🆕 OBTENER TOTAL DE PUNTOS DE LA MATERIA PARA CALCULAR PORCENTAJE
    let totalPuntosMateria = 100; // Default
    if (actividadResult.recordsets.length > 2 && actividadResult.recordsets[2].length > 0) {
      totalPuntosMateria = actividadResult.recordsets[2][0].total_puntos_materia || 100;
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
      
      fuente_calificacion: 'SP_CON_PONDERACION_REAL'
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
// 🔧 FUNCIÓN ADAPTADA: obtenerCalificacionesHistoricas CON SP
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

    // 🔧 CONSULTA MEJORADA: INCLUIR INFORMACIÓN COMPLETA DE PONDERACIÓN USANDO SP
    const result = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('todos_periodos', sql.Bit, todos_periodos === 'true' ? 1 : 0)
      .execute('sp_ObtenerCalificacionesHistoricas');

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

const obtenerCalificacionesHistoricasPorParciales = async (req, res) => {
  const { matricula } = req.params;
  const { todos_periodos } = req.query;

  try {
    const pool = await sql.connect(config);

    console.log(`🎓 === CALIFICACIONES POR PARCIALES (LÓGICA INTELIGENTE VENCIDAS) ===`);

    // 🆕 DETECTAR PERÍODO AUTOMÁTICAMENTE
    const periodoInfo = await detectarPeriodoAutomatico(pool, matricula);
    console.log(`📅 Usando período detectado: ${periodoInfo.periodo}`);

    // 🔧 PRIMERA CONSULTA: OBTENER **TODAS** LAS ACTIVIDADES QUE EXISTEN USANDO SP
    const todasLasActividades = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('todos_periodos', sql.Bit, todos_periodos === 'true' ? 1 : 0)
      .execute('sp_ObtenerCalificacionesHistoricasPorParciales');

    console.log(`📊 TODAS las actividades encontradas: ${todasLasActividades.recordset.length}`);

    // 🔧 SEGUNDA CONSULTA: OBTENER **SOLO** LAS CALIFICACIONES EXISTENTES USANDO SP
    const calificacionesExistentes = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .execute('sp_ObtenerCalificacionesExistentes');

    console.log(`📊 Calificaciones existentes: ${calificacionesExistentes.recordset.length}`);

    // 🔧 MAPEAR CALIFICACIONES A LAS ACTIVIDADES
    const mapaCalificaciones = {};
    calificacionesExistentes.recordset.forEach(cal => {
      mapaCalificaciones[cal.id_actividad] = {
        calificacion: cal.calificacion_obtenida,
        criterios_calificados: cal.criterios_calificados,
        estado: 'Calificada'
      };
    });

    // 🔧 FUNCIÓN PARA EVALUAR SI UNA ACTIVIDAD ESTÁ VENCIDA
    const evaluarEstadoActividad = (fecha_entrega_raw, tiene_calificacion) => {
      if (tiene_calificacion) {
        return {
          estado: 'Calificada',
          estado_para_promedio: 'Calificada',
          incluir_en_promedio: true,
          razon: 'Actividad calificada'
        };
      }

      if (!fecha_entrega_raw) {
        return {
          estado: 'Pendiente',
          estado_para_promedio: 'Sin fecha',
          incluir_en_promedio: false,
          razon: 'Sin fecha de entrega definida'
        };
      }

      // Calcular si está vencida (usando la misma lógica que tienes en calcularEstadoDinamico)
      const ahora = new Date();
      const offsetMexico = -6; // UTC-6 para zona horaria de México
      const ahoraLocal = new Date(ahora.getTime() + (offsetMexico * 60 * 60 * 1000));
      
      let fechaLimite;
      try {
        fechaLimite = new Date(fecha_entrega_raw);
        if (isNaN(fechaLimite.getTime())) {
          return {
            estado: 'Pendiente',
            estado_para_promedio: 'Error fecha',
            incluir_en_promedio: false,
            razon: 'Error en fecha de entrega'
          };
        }
      } catch (error) {
        return {
          estado: 'Pendiente',
          estado_para_promedio: 'Error fecha',
          incluir_en_promedio: false,
          razon: 'Error parseando fecha'
        };
      }

      const diferenciaMilisegundos = fechaLimite.getTime() - ahoraLocal.getTime();
      
      if (diferenciaMilisegundos < 0) {
        // ❌ YA VENCIÓ - CONTAR COMO 0 EN EL PROMEDIO
        return {
          estado: 'Vencida',
          estado_para_promedio: 'Vencida (cuenta como 0)',
          incluir_en_promedio: true,
          calificacion_para_promedio: 0,
          razon: 'Actividad vencida, cuenta como 0 en promedio'
        };
      } else {
        // ✅ AÚN EN PLAZO - NO CONTAR EN EL PROMEDIO
        return {
          estado: 'Pendiente',
          estado_para_promedio: 'En plazo (no cuenta)',
          incluir_en_promedio: false,
          razon: 'Actividad en plazo, no afecta promedio actual'
        };
      }
    };

    // 🔧 COMBINAR ACTIVIDADES CON CALIFICACIONES Y EVALUACIÓN DE VENCIMIENTO
    const actividadesCompletas = todasLasActividades.recordset.map(actividad => {
      const calificacion = mapaCalificaciones[actividad.id_actividad];
      const evaluacion = evaluarEstadoActividad(actividad.fecha_entrega_raw, !!calificacion);
      
      return {
        id_actividad: actividad.id_actividad,
        titulo: actividad.titulo,
        materia: actividad.materia,
        periodo: actividad.periodo,
        parcial: actividad.parcial,
        instrumento: actividad.instrumento,
        tipoInstrumento: actividad.tipoInstrumento,
        Docente: actividad.Docente,
        valor_componente: parseFloat(actividad.valor_componente) || 2,
        tipo_componente: actividad.tipo_componente || 'Actividad',
        fecha_entrega: actividad.fecha_entrega,
        fecha_entrega_raw: actividad.fecha_entrega_raw,
        modalidad: actividad.modalidad,
        criterios_calificados: calificacion ? calificacion.criterios_calificados : 0,
        
        // ✅ LÓGICA INTELIGENTE PARA CALIFICACIONES
        calificacion: calificacion ? calificacion.calificacion : (evaluacion.calificacion_para_promedio || null),
        estado: evaluacion.estado,
        estado_para_promedio: evaluacion.estado_para_promedio,
        incluir_en_promedio: evaluacion.incluir_en_promedio,
        razon_inclusion: evaluacion.razon,
        
        contribucion_obtenida: calificacion ? (calificacion.calificacion * actividad.valor_componente / 10) : 0
      };
    });

    console.log(`📊 Actividades completas procesadas: ${actividadesCompletas.length}`);

    if (actividadesCompletas.length === 0) {
      return res.json([]);
    }

    // 🔧 PROCESAMIENTO: AGRUPAR Y CALCULAR PROMEDIOS PONDERADOS INTELIGENTES
    const periodosProcesados = {};
    
    actividadesCompletas.forEach(actividad => {
      // Inicializar período
      if (!periodosProcesados[actividad.periodo]) {
        periodosProcesados[actividad.periodo] = {
          periodo: actividad.periodo,
          materias: {},
          promedio_cuatrimestre: 0
        };
      }
      
      // Inicializar materia
      if (!periodosProcesados[actividad.periodo].materias[actividad.materia]) {
        periodosProcesados[actividad.periodo].materias[actividad.materia] = {
          nombre: actividad.materia,
          docente: actividad.Docente || 'Docente Asignado',
          //grupo: 'Grupo',
          creditos: 5,
          estado: 'En curso',
          parciales: {
            'Parcial 1': { actividades: [], calificacion_parcial: 0, total_ponderacion: 0, tiene_calificaciones: false },
            'Parcial 2': { actividades: [], calificacion_parcial: 0, total_ponderacion: 0, tiene_calificaciones: false },
            'Parcial 3': { actividades: [], calificacion_parcial: 0, total_ponderacion: 0, tiene_calificaciones: false }
          },
          promedio_materia: 0,
          calificacion_final_cuatrimestre: 0,
          parciales_con_calificaciones: 0
        };
      }
      
      // Agregar actividad al parcial correspondiente
      const materia = periodosProcesados[actividad.periodo].materias[actividad.materia];
      const parcial = materia.parciales[actividad.parcial];
      
      if (parcial) {
        parcial.actividades.push({
          id_actividad: actividad.id_actividad,
          titulo: actividad.titulo,
          calificacion: actividad.calificacion,
          fecha_entrega: actividad.fecha_entrega,
          instrumento: actividad.instrumento,
          tipoInstrumento: actividad.tipoInstrumento,
          estado: actividad.estado,
          estado_para_promedio: actividad.estado_para_promedio,
          incluir_en_promedio: actividad.incluir_en_promedio,
          razon_inclusion: actividad.razon_inclusion,
          modalidad: actividad.modalidad,
          criterios_calificados: actividad.criterios_calificados || 0,
          valor_componente: parseFloat(actividad.valor_componente) || 2,
          tipo_componente: actividad.tipo_componente || 'Actividad',
          contribucion_obtenida: actividad.contribucion_obtenida || 0
        });
      }
    });

    // ✅ CALCULAR PROMEDIOS PONDERADOS INTELIGENTES (CALIFICADAS + VENCIDAS)
    Object.values(periodosProcesados).forEach(periodo => {
      Object.values(periodo.materias).forEach(materia => {
        let sumaPromediosParciales = 0;
        let parcialesConCalificaciones = 0;
        
        // Calcular promedio ponderado de cada parcial
        Object.entries(materia.parciales).forEach(([nombreParcial, parcialData]) => {
          if (parcialData.actividades.length > 0) {
            // ✅ CÁLCULO INTELIGENTE: CALIFICADAS + VENCIDAS (como 0)
            let sumaCalificacionesPonderadas = 0;
            let sumaPonderaciones = 0;
            let totalActividades = parcialData.actividades.length;
            let actividadesIncluidas = 0;
            let actividadesCalificadas = 0;
            let actividadesVencidas = 0;
            let actividadesEnPlazo = 0;
            
            parcialData.actividades.forEach(actividad => {
              // ✅ INCLUIR SI: Está calificada O está vencida
              if (actividad.incluir_en_promedio) {
                const calificacion = actividad.calificacion || 0; // Vencidas = 0
                const ponderacion = actividad.valor_componente;
                
                sumaCalificacionesPonderadas += (calificacion * ponderacion);
                sumaPonderaciones += ponderacion;
                actividadesIncluidas++;
                
                if (actividad.estado === 'Calificada') {
                  actividadesCalificadas++;
                  console.log(`📊 INCLUIDA (Calificada) - ${actividad.titulo}: Cal=${calificacion}, Pond=${ponderacion}`);
                } else if (actividad.estado === 'Vencida') {
                  actividadesVencidas++;
                  console.log(`❌ INCLUIDA (Vencida=0) - ${actividad.titulo}: Cal=0, Pond=${ponderacion}`);
                }
              } else {
                actividadesEnPlazo++;
                console.log(`⏳ EXCLUIDA (En plazo) - ${actividad.titulo}: ${actividad.razon_inclusion}`);
              }
            });
            
            // ✅ PROMEDIO PONDERADO DEL PARCIAL: CALIFICADAS + VENCIDAS
            if (actividadesIncluidas > 0) {
              parcialData.calificacion_parcial = sumaPonderaciones > 0 
                ? (sumaCalificacionesPonderadas / sumaPonderaciones)
                : 0;
              parcialData.tiene_calificaciones = true;
              parcialesConCalificaciones++;
              sumaPromediosParciales += parcialData.calificacion_parcial;
            } else {
              parcialData.calificacion_parcial = 0;
              parcialData.tiene_calificaciones = false;
            }
            
            parcialData.total_ponderacion = sumaPonderaciones;
            
            console.log(`📋 ${nombreParcial}: ${sumaCalificacionesPonderadas.toFixed(2)} / ${sumaPonderaciones} = ${parcialData.calificacion_parcial.toFixed(2)}`);
            console.log(`📋 ${nombreParcial}: Total=${totalActividades}, Calificadas=${actividadesCalificadas}, Vencidas=${actividadesVencidas}, En plazo=${actividadesEnPlazo}`);
          } else {
            parcialData.calificacion_parcial = 0;
            parcialData.total_ponderacion = 0;
            parcialData.tiene_calificaciones = false;
          }
        });
        
        // ✅ PROMEDIO DE MATERIA: SOLO PARCIALES CON ACTIVIDADES EVALUABLES
        materia.parciales_con_calificaciones = parcialesConCalificaciones;
        
        if (parcialesConCalificaciones > 0) {
          materia.calificacion_final_cuatrimestre = sumaPromediosParciales / parcialesConCalificaciones;
        } else {
          materia.calificacion_final_cuatrimestre = 0;
        }
        
        materia.promedio_materia = materia.calificacion_final_cuatrimestre;
        materia.calificacion = materia.calificacion_final_cuatrimestre;
        
        // ✅ DETERMINAR ESTADO INTELIGENTE DE LA MATERIA
        if (parcialesConCalificaciones === 3) {
          // Todos los parciales evaluados
          materia.estado = materia.calificacion_final_cuatrimestre >= 6 ? 'Aprobada' : 'Reprobada';
        } else if (parcialesConCalificaciones > 0) {
          // Algunos parciales evaluados
          materia.estado = 'En curso';
        } else {
          // Ningún parcial evaluado
          materia.estado = 'En curso';
        }
        
        console.log(`🎓 ${materia.nombre}: Parciales evaluados = ${parcialesConCalificaciones}/3, Promedio = ${materia.calificacion_final_cuatrimestre.toFixed(2)} (${materia.estado})`);
      });
      
      // ✅ PROMEDIO DEL CUATRIMESTRE
      const materiasArray = Object.values(periodo.materias);
      const materiasConCalif = materiasArray.filter(m => m.calificacion_final_cuatrimestre > 0);
      
      if (materiasConCalif.length > 0) {
        const sumaCalificacionesMaterias = materiasConCalif.reduce((sum, mat) => sum + mat.calificacion_final_cuatrimestre, 0);
        periodo.promedio_cuatrimestre = sumaCalificacionesMaterias / materiasConCalif.length;
      } else {
        periodo.promedio_cuatrimestre = 0;
      }
      
      periodo.promedio = periodo.promedio_cuatrimestre;
      periodo.materias = materiasArray;
      
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
    });

    const calificacionesArray = Object.values(periodosProcesados);
    calificacionesArray.sort((a, b) => b.periodo.localeCompare(a.periodo));

    console.log(`🎓 === FIN CALIFICACIONES POR PARCIALES (LÓGICA INTELIGENTE VENCIDAS) ===`);

    res.json(calificacionesArray);

  } catch (error) {
    console.error('❌ Error calificaciones por parciales:', error);
    res.status(500).json({ 
      mensaje: 'Error en el servidor al obtener calificaciones por parciales',
      error: error.message 
    });
  }
};

// ===============================================
// FUNCIÓN ADAPTADA: cambiarContrasena CON SP
// ===============================================
const cambiarContrasena = async (req, res) => {
  const { matricula } = req.params;
  const { actual, nueva } = req.body;

  try {
    const pool = await sql.connect(config);

    const result = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('contrasena_actual', sql.VarChar, actual)
      .input('contrasena_nueva', sql.VarChar, nueva)
      .output('resultado', sql.Int)
      .execute('sp_CambiarContrasena');

    const resultado = result.output.resultado;

    switch (resultado) {
      case 0:
        res.json({ mensaje: 'Contraseña actualizada correctamente' });
        break;
      case 1:
        res.status(400).json({ mensaje: 'Contraseña actual incorrecta' });
        break;
      case 2:
        res.status(404).json({ mensaje: 'Alumno no encontrado' });
        break;
      default:
        res.status(500).json({ mensaje: 'Error desconocido' });
    }

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
  probarConFechaReal,
  obtenerCalificacionesHistoricasPorParciales
};