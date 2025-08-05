const { sql, config } = require('../db/sqlConfig');

const obtenerDatosDocente = async (req, res) => {
  const { clave } = req.params;

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('clave', sql.VarChar, clave)
      .execute('sp_ObtenerDatosDocente');

    if (result.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Docente no encontrado' });
    }

    res.json({ nombre: result.recordset[0].nombre });
  } catch (err) {
    console.error('❌ Error al obtener datos del docente:', err);
    res.status(500).json({ mensaje: 'Error en el servidor' });
  }
};

const obtenerPerfilDocente = async (req, res) => {
  const { clave } = req.body;

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('clave', sql.VarChar, clave)
      .execute(`sp_obtenerPerfilDocente`);

    if (result.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Docente no encontrado' });
    }

    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Error al obtener perfil del docente:', err);
    res.status(500).json({ mensaje: 'Error en el servidor' });
  }
};

const obtenerMateriasPorDocente = async (req, res) => {
  const { clave } = req.params;

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('clave', sql.VarChar, clave)
      .execute(`sp_ObtenerMateriasPorDocente`);

    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Error al obtener materias del docente:', err);
    res.status(500).json({ mensaje: 'Error en el servidor' });
  }
};

const obtenerMateriasCompletas = async (req, res) => {
  const { clave } = req.params;

  try {
    const pool = await sql.connect(config);
    
    const periodoActualResult = await pool.request().execute(`sp_ObtenerPeriodoActual`);
    
    if (periodoActualResult.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'No se encontraron periodos asignados' });
    }
    
    const periodoActual = periodoActualResult.recordset[0].Periodo;
    console.log(`🗓️ Filtrando materias por periodo actual: ${periodoActual}`);

    const result = await pool.request()
      .input('clave', sql.VarChar, clave)
      .input('periodoActual', sql.VarChar, periodoActual)
      .execute(`sp_obtenerMateriasCompletas`);

    console.log(`✅ Encontradas ${result.recordset.length} materias del periodo actual (${periodoActual})`);
    
    const responseData = result.recordset.map(materia => ({
      ...materia,
      periodoInfo: `${periodoActual} - Cuatrimestre ${materia.vchCuatrimestre}`
    }));

    res.json(responseData);

  } catch (err) {
    console.error('❌ Error al obtener materias completas del periodo actual:', err);
    res.status(500).json({ mensaje: 'Error en el servidor' });
  }
};

const obtenerPeriodoActualInterno = async () => {
  try {
    const pool = await sql.connect(config);
    
    const periodoResult = await pool.request().query(`EXEC sp_ObtenerPeriodoActual;`);
    
    if (periodoResult.recordset.length === 0) {
      console.error('❌ No se encontraron periodos en la BD');
      return null;
    }

    const periodoActual = periodoResult.recordset[0].Periodo.toString();
    console.log(`📅 Periodo obtenido de BD: ${periodoActual}`);
    
    return periodoActual;

  } catch (err) {
    console.error('❌ Error al obtener periodo actual interno:', err);
    return null;
  }
};

const validarPeriodo = async (periodoRecibido) => {
  if (!periodoRecibido || 
      periodoRecibido === 'auto' || 
      periodoRecibido === 'null' || 
      periodoRecibido === 'undefined') {
    
    const periodoBD = await obtenerPeriodoActualInterno();
    if (periodoBD) {
      console.log(`✅ Usando periodo automático de BD: ${periodoBD}`);
      return periodoBD;
    }
  }

  if (periodoRecibido && periodoRecibido.length === 5) {
    const año = parseInt(periodoRecibido.substring(0, 4));
    const cuatrimestre = parseInt(periodoRecibido.substring(4));
    const añoActual = new Date().getFullYear();
    
    if (año >= 2020 && año <= añoActual + 2 && [1, 2, 3].includes(cuatrimestre)) {
      console.log(`✅ Usando periodo específico validado: ${periodoRecibido}`);
      return periodoRecibido;
    }
  }

  console.log(`⚠️ Periodo inválido: ${periodoRecibido}, obteniendo de BD...`);
  const periodoBD = await obtenerPeriodoActualInterno();
  return periodoBD || '20252';
};

const obtenerPeriodoActual = async (req, res) => {
  try {
    const pool = await sql.connect(config);
    
    const periodoResult = await pool.request().query(`EXEC sp_ObtenerPeriodoActual;`);
    
    if (periodoResult.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'No se encontraron periodos' });
    }

    const periodoActual = periodoResult.recordset[0].Periodo.toString();
    
    const año = periodoActual.substring(0, 4);
    const cuatrimestreNumero = periodoActual.substring(4, 5);
    
    const cuatrimestreInfo = await pool.request()
      .input('idPeriodo', sql.Int, parseInt(cuatrimestreNumero))
      .query(`EXEC sp_CuatrimestreInfo`);

    const infoCompleta = {
      periodoActual,
      año,
      cuatrimestreNumero,
      descripcion: `Año ${año}, Cuatrimestre ${cuatrimestreNumero}`,
      esPeriodoAutomatico: true,
      fechaConsulta: new Date().toISOString(),
      ...(cuatrimestreInfo.recordset.length > 0 && {
        mesInicia: cuatrimestreInfo.recordset[0].mesInicia,
        mesTermina: cuatrimestreInfo.recordset[0].mesTermina
      })
    };

    console.log(`📅 Periodo actual consultado vía endpoint: ${periodoActual}`);
    res.json(infoCompleta);

  } catch (err) {
    console.error('❌ Error al obtener periodo actual:', err);
    res.status(500).json({ mensaje: 'Error en el servidor' });
  }
};

const obtenerGruposPorMateriaDocente = async (req, res) => {
  const { clave, clvMateria } = req.params;

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('clave', sql.VarChar, clave)
      .input('clvMateria', sql.VarChar, clvMateria)
      .execute(`sp_ObtenerGruposPorMateriaDocente`);

    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Error al obtener grupos del docente:', err);
    res.status(500).json({ mensaje: 'Error en el servidor' });
  }
};

const obtenerComponentesPorMateria = async (req, res) => {
  const { claveDocente, claveMateria, parcial, periodo } = req.params;
  
  try {
    const pool = await sql.connect(config);
    
    let periodoReal = periodo;
    if (!periodo || periodo === 'auto' || periodo === 'null' || periodo === 'undefined') {
      console.log('🔄 Resolviendo periodo automático...');
      const periodoResult = await pool.request().execute('sp_ObtenerPeriodoActual');
      
      if (periodoResult.recordset.length === 0) {
        return res.status(400).json({ error: 'No se pudo obtener el periodo actual' });
      }
      
      periodoReal = periodoResult.recordset[0].Periodo.toString();
      console.log(`✅ Periodo resuelto: ${periodoReal}`);
    }
    
    const result = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parcial)
      .input('vchPeriodo', sql.VarChar, periodoReal)
      .input('claveDocente', sql.VarChar, claveDocente)
      .execute('sp_ObtenerComponentesMateria');
    
    const componentes = result.recordset || [];
    
    const componentesMapeados = componentes.map(comp => ({
      id_valor_componente: comp.id_valor_componente,
      nombre_componente: comp.nombre_componente,
      valor_componente: comp.valor_componente,
      id_componente: comp.id_valor_componente
    }));
    
    const sumaTotal = componentesMapeados.reduce((suma, comp) => suma + parseFloat(comp.valor_componente || 0), 0);
    const disponible = 10 - sumaTotal;
    
    const validacion = {
      esValido: sumaTotal <= 10,
      esCompleto: sumaTotal === 10,
      exceso: Math.max(0, sumaTotal - 10),
      faltante: Math.max(0, 10 - sumaTotal),
      progreso: (sumaTotal / 10 * 100).toFixed(1)
    };

    let estadisticas = null;
    if (componentesMapeados.length > 0) {
      const valores = componentesMapeados.map(c => parseFloat(c.valor_componente || 0));
      estadisticas = {
        totalComponentes: componentesMapeados.length,
        mayorComponente: Math.max(...valores),
        menorComponente: Math.min(...valores),
        promedioComponente: parseFloat((sumaTotal / componentesMapeados.length).toFixed(2))
      };
    }

    res.json({
      componentes: componentesMapeados || [],
      sumaTotal: parseFloat(sumaTotal.toFixed(2)),
      disponible: parseFloat(disponible.toFixed(2)),
      validacion,
      estadisticas,
      periodoUsado: periodoReal,
      debug: {
        periodoOriginal: periodo,
        periodoResuelto: periodoReal,
        componentesEncontrados: componentesMapeados.length
      }
    });

    await pool.close();

  } catch (error) {
    console.error('Error al obtener componentes:', error);
    res.status(500).json({
      error: 'Error interno del servidor al obtener componentes',
      componentes: [],
      sumaTotal: 0,
      disponible: 10,
      validacion: { esValido: true, esCompleto: false, exceso: 0, faltante: 10 }
    });
  }
};


const crearComponente = async (req, res) => {
  const { claveMateria, parcial, periodo, claveDocente, nombreComponente, valorComponente } = req.body;
  
  try {
    if (!valorComponente || valorComponente <= 0 || valorComponente > 10) {
      return res.status(400).json({
        error: 'El valor del componente debe estar entre 0.1 y 10 puntos',
        detalles: { valorRecibido: valorComponente },
        sugerencia: 'Ingresa un valor entre 0.1 y 10 puntos'
      });
    }

    const pool = await sql.connect(config);

    let periodoReal = periodo;
    if (!periodo || periodo === 'auto' || periodo === 'null' || periodo === 'undefined') {
      console.log('🔄 Resolviendo periodo automático...');
      const periodoResult = await pool.request().execute('sp_ObtenerPeriodoActual');
      
      if (periodoResult.recordset.length === 0) {
        return res.status(400).json({ error: 'No se pudo obtener el periodo actual' });
      }
      
      periodoReal = periodoResult.recordset[0].Periodo.toString();
      console.log(`✅ Periodo resuelto: ${periodoReal}`);
    }

    console.log('🔍 Obteniendo suma actual...');
    const sumResult = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parcial)
      .input('vchPeriodo', sql.VarChar, periodoReal)
      .input('claveDocente', sql.VarChar, claveDocente)
      .execute('sp_sumaComponentes');
    
    console.log('📊 Resultado SP:', sumResult);
    
    let sumaActual = 0;
    if (sumResult.recordset && sumResult.recordset.length > 0) {
      const record = sumResult.recordset[0];
      sumaActual = parseFloat(record.suma_actual || record.suma || record.total || record.sumaTotal || 0);
    }
    
    console.log('✅ Suma actual:', sumaActual);
    
    const nuevaSuma = sumaActual + parseFloat(valorComponente);
    const disponible = 10 - sumaActual;

    if (nuevaSuma > 10) {
      return res.status(400).json({
        error: `No se puede exceder los 10 puntos del parcial`,
        detalles: {
          sumaActual,
          valorIntentado: parseFloat(valorComponente),
          nuevaSuma,
          disponible,
          exceso: nuevaSuma - 10
        },
        sugerencia: `Máximo valor permitido: ${disponible} puntos`
      });
    }

    let valorFinal = parseFloat(valorComponente);
    let seAutoAjusto = false;
    
    if (nuevaSuma > 10 - 0.1 && nuevaSuma < 10) {
      valorFinal = disponible;
      seAutoAjusto = true;
    }

    console.log('📝 Creando componente...');
    const result = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parcial)
      .input('vchPeriodo', sql.VarChar, periodoReal)
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('nombreComponente', sql.VarChar, nombreComponente)
      .input('valorComponente', sql.Decimal(5,2), valorFinal)
      .execute('sp_InsertarComponenteEvaluacion');

    const nuevaSumaFinal = sumaActual + valorFinal;
    const nuevoDisponible = 10 - nuevaSumaFinal;
    
    let recomendacion = null;
    let felicitacion = null;
    
    if (nuevaSumaFinal === 10) {
      felicitacion = {
        tipo: 'perfecto',
        mensaje: '🎉 ¡Excelente! El parcial está completo con exactamente 10 puntos.'
      };
    } else if (nuevoDisponible <= 2) {
      recomendacion = {
        tipo: 'info',
        mensaje: `Quedan ${nuevoDisponible.toFixed(1)} puntos por asignar.`
      };
    }

    res.status(201).json({
      mensaje: seAutoAjusto 
        ? `Componente creado y auto-ajustado a ${valorFinal} puntos` 
        : 'Componente creado exitosamente',
      id_componente: result.recordset?.[0]?.id_componente || 'creado',
      periodoUsado: periodoReal,
      estadisticas: {
        valorAsignado: valorFinal,
        sumaNueva: nuevaSumaFinal,
        disponible: nuevoDisponible,
        progreso: (nuevaSumaFinal / 10 * 100).toFixed(1)
      },
      ajustes: seAutoAjusto ? {
        valorOriginal: parseFloat(valorComponente),
        valorFinal: valorFinal,
        razon: 'Auto-ajustado para optimizar la suma total'
      } : null,
      recomendacion,
      felicitacion
    });

  } catch (error) {
    console.error('Error al crear componente:', error);
    res.status(500).json({
      error: 'Error interno del servidor al crear el componente',
      detalles: { mensaje: error.message }
    });
  }
};

const validarParcial = async (req, res) => {
  const { claveDocente, claveMateria, parcial, periodo } = req.params;
  
  try {
    const pool = await sql.connect(config);

    console.log('🔍 Validando parcial...');
    
    const componentesResult = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parcial)
      .input('vchPeriodo', sql.VarChar, periodo)
      .input('claveDocente', sql.VarChar, claveDocente)
      .execute('sp_ObtenerComponentesMateria');
    
    const componentes = componentesResult.recordset || [];
    const sumaTotal = componentes.reduce((suma, comp) => suma + parseFloat(comp.valor_componente || 0), 0);
    const disponible = 10 - sumaTotal;
    const cantidadComponentes = componentes.length;

    const recomendaciones = [];

    if (sumaTotal === 10) {
      recomendaciones.push({
        tipo: 'perfecto',
        icono: '🎉',
        titulo: 'Parcial Perfecto',
        mensaje: 'El parcial suma exactamente 10 puntos. ¡Excelente configuración!',
        acciones: ['Ya puedes crear actividades para este parcial']
      });
    } else if (sumaTotal === 0) {
      recomendaciones.push({
        tipo: 'info',
        icono: '🚀',
        titulo: 'Comenzar Configuración',
        mensaje: 'Este parcial está vacío. Es hora de configurar los componentes de evaluación.',
        acciones: [
          'Agrega "Actividades" con 4-5 puntos',
          'Agrega "Examen" con 5-6 puntos',
          'Considera "Participación" con 1-2 puntos'
        ]
      });
    } else if (sumaTotal > 10) {
      recomendaciones.push({
        tipo: 'critico',
        icono: '⚠️',
        titulo: 'Exceso de Puntos',
        mensaje: `El parcial excede por ${(sumaTotal - 10).toFixed(1)} puntos.`,
        acciones: [
          'Reduce el valor de los componentes más altos',
          'Elimina componentes innecesarios'
        ]
      });
    } else if (disponible <= 2 && disponible > 0) {
      recomendaciones.push({
        tipo: 'advertencia',
        icono: '🔸',
        titulo: 'Casi Completo',
        mensaje: `Solo faltan ${disponible.toFixed(1)} puntos para completar.`,
        acciones: [`Agrega un componente con ${disponible.toFixed(1)} puntos`]
      });
    } else if (disponible > 2) {
      recomendaciones.push({
        tipo: 'sugerencia',
        icono: '💡',
        titulo: 'Parcial Incompleto',
        mensaje: `Faltan ${disponible.toFixed(1)} puntos por asignar.`,
        acciones: ['Agrega más componentes de evaluación']
      });
    }

    res.json({
      suma: sumaTotal,
      disponible,
      cantidadComponentes,
      estado: sumaTotal === 10 ? 'completo' : sumaTotal > 10 ? 'excedido' : 'incompleto',
      recomendaciones
    });

  } catch (error) {
    console.error('Error en validación de parcial:', error);
    res.status(500).json({
      error: 'Error al validar parcial',
      recomendaciones: []
    });
  }
};

const modificarComponente = async (req, res) => {
  const { idComponente } = req.params;
  const { nombreComponente, valorComponente } = req.body;
  
  try {
    if (!valorComponente || valorComponente <= 0 || valorComponente > 10) {
      return res.status(400).json({
        error: 'El valor del componente debe estar entre 0.1 y 10 puntos',
        detalles: { valorRecibido: valorComponente },
        sugerencia: 'Ingresa un valor entre 0.1 y 10 puntos'
      });
    }

    const pool = await sql.connect(config);

  const componenteInfo = await pool.request()
  .input('idComponente', sql.Int, idComponente)
  .execute('sp_ObtenerComponentePorId_movil');
    
    if (!componenteInfo.recordset || componenteInfo.recordset.length === 0) {
      await pool.close();
      return res.status(404).json({
        error: 'Componente no encontrado'
      });
    }

    const componente = componenteInfo.recordset[0];
    const valorAnterior = parseFloat(componente.valor_componente);

    const sumResult = await pool.request()
      .input('claveMateria', sql.VarChar, componente.vchClvMateria)
      .input('parcial', sql.Int, componente.parcial)
      .input('vchPeriodo', sql.VarChar, componente.vchPeriodo)
      .input('claveDocente', sql.VarChar, componente.vchClvTrabajador)
      .execute('sp_sumaComponentes');
    
    const sumaTotal = parseFloat(sumResult.recordset[0]?.suma_actual || sumResult.recordset[0]?.suma || 0);
    const sumaSinEsteComponente = sumaTotal - valorAnterior;
    const nuevaSuma = sumaSinEsteComponente + parseFloat(valorComponente);
    const disponibleSinEste = 10 - sumaSinEsteComponente;

    if (nuevaSuma > 10) {
      await pool.close();
      return res.status(400).json({
        error: `La modificación excedería los 10 puntos del parcial`,
        detalles: {
          valorAnterior,
          valorNuevo: parseFloat(valorComponente),
          sumaActual: sumaTotal,
          nuevaSuma,
          disponible: disponibleSinEste,
          exceso: nuevaSuma - 10
        },
        sugerencia: `Máximo valor permitido: ${disponibleSinEste} puntos`
      });
    }

    let valorFinal = parseFloat(valorComponente);
    let seAutoAjusto = false;
    
    if (nuevaSuma > 10 - 0.1 && nuevaSuma < 10) {
      valorFinal = disponibleSinEste;
      seAutoAjusto = true;
    }

    await pool.request()
      .input('idComponente', sql.Int, idComponente)
      .input('nombreComponente', sql.VarChar, nombreComponente)
      .input('valorComponente', sql.Decimal(5,2), valorFinal)
      .execute('sp_ActualizarComponente');

    const nuevaSumaFinal = sumaSinEsteComponente + valorFinal;
    const nuevoDisponible = 10 - nuevaSumaFinal;

    let recomendacion = null;
    let felicitacion = null;
    
    if (nuevaSumaFinal === 10) {
      felicitacion = {
        tipo: 'perfecto',
        mensaje: '✨ ¡Perfecto! El parcial ahora suma exactamente 10 puntos.'
      };
    } else if (nuevoDisponible <= 1) {
      recomendacion = {
        tipo: 'info',
        mensaje: `Solo quedan ${nuevoDisponible.toFixed(1)} puntos por asignar.`
      };
    }

    res.json({
      mensaje: seAutoAjusto 
        ? `Componente modificado y auto-ajustado a ${valorFinal} puntos` 
        : 'Componente modificado exitosamente',
      estadisticas: {
        valorAnterior,
        valorFinal,
        diferencia: valorFinal - valorAnterior,
        sumaNueva: nuevaSumaFinal,
        disponible: nuevoDisponible
      },
      ajustes: seAutoAjusto ? {
        valorIntentado: parseFloat(valorComponente),
        valorFinal: valorFinal,
        razon: 'Auto-ajustado para no exceder 10 puntos'
      } : null,
      recomendacion,
      felicitacion
    });

    await pool.close();

  } catch (error) {
    console.error('Error al modificar componente:', error);
    res.status(500).json({
      error: 'Error interno del servidor al modificar el componente'
    });
  }
};

const eliminarComponente = async (req, res) => {
  const { idComponente } = req.params;
  
  try {
    const pool = await sql.connect(config);

const componenteInfo = await pool.request()
  .input('idComponente', sql.Int, idComponente)
  .execute('sp_ObtenerComponentePorId_movil')
    
    if (!componenteInfo.recordset || componenteInfo.recordset.length === 0) {
      await pool.close();
      return res.status(404).json({
        error: 'Componente no encontrado'
      });
    }

    const componente = componenteInfo.recordset[0];
    const valorLiberado = parseFloat(componente?.valor_componente || 0);

    console.log('🔍 Verificando actividades vinculadas al componente específico...');
    
    const actividadesVinculadas = await pool.request()
  .input('idComponente', sql.Int, idComponente)
  .execute('sp_VerificarActividadesVinculadasComponente_movil');

    const cantidadActividades = actividadesVinculadas.recordset[0]?.cantidad || 0;
    const nombresActividades = actividadesVinculadas.recordset[0]?.nombres_actividades || '';

    if (cantidadActividades > 0) {
      await pool.close();
      
      return res.status(400).json({
        error: 'No se puede eliminar el componente porque tiene actividades vinculadas',
        detalles: {
          actividadesVinculadas: cantidadActividades,
          actividades: nombresActividades.split(', ').filter(nombre => nombre.trim())
        },
        soluciones: [
          'Elimina primero las actividades vinculadas',
          'O cambia las actividades a otro componente'
        ]
      });
    }

    console.log('✅ El componente no tiene actividades vinculadas, procediendo a eliminar...');

    const result = await pool.request()
      .input('idComponente', sql.Int, idComponente)
      .execute('sp_EliminarComponenteEvaluacion');

    const nuevaSumaResult = await pool.request()
      .input('claveMateria', sql.VarChar, componente.vchClvMateria)
      .input('parcial', sql.Int, componente.parcial)
      .input('vchPeriodo', sql.VarChar, componente.vchPeriodo)
      .input('claveDocente', sql.VarChar, componente.vchClvTrabajador)
      .execute('sp_sumaComponentes');

    const sumaNueva = parseFloat(nuevaSumaResult.recordset[0]?.suma_actual || nuevaSumaResult.recordset[0]?.suma || 0);
    const nuevoDisponible = 10 - sumaNueva;

    console.log(`✅ Componente eliminado. Nueva suma: ${sumaNueva}, Disponible: ${nuevoDisponible}`);

    res.json({
      mensaje: 'Componente eliminado exitosamente',
      impacto: {
        valorLiberado,
        sumaNueva,
        disponible: nuevoDisponible
      },
      recomendacion: nuevoDisponible > 0 ? {
        mensaje: `Tienes ${nuevoDisponible.toFixed(1)} puntos disponibles para asignar.`
      } : null
    });

    await pool.close();

  } catch (error) {
    console.error('Error al eliminar componente:', error);
    res.status(500).json({
      error: 'Error interno del servidor al eliminar el componente',
      detalle: error.message
    });
  }
};

const validarComplecionParcial = async (req, res) => {
  const { claveMateria, parcial, periodo, claveDocente } = req.params;

  try {
    const pool = await sql.connect(config);

    const result = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parseInt(parcial))
      .input('vchPeriodo', sql.VarChar, periodo)
      .input('claveDocente', sql.VarChar, claveDocente)
      .execute(`sp_ValidarComplecionParcial`);

    const datos = result.recordset[0];
    const sumaTotal = parseFloat(datos.sumaTotal.toFixed(2));

    const actividadesResult = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parseInt(parcial))
      .input('vchPeriodo', sql.VarChar, periodo)
      .input('claveDocente', sql.VarChar, claveDocente)
      .execute(`sp_VerificarActividadesConComponentes`);

    const totalActividades = actividadesResult.recordset[0].totalActividades;

    const analisis = {
      parcial: parseInt(parcial),
      estadisticas: {
        totalComponentes: datos.totalComponentes,
        sumaTotal,
        disponible: parseFloat((10 - sumaTotal).toFixed(2)), 
        menorValor: datos.menorValor || 0,
        mayorValor: datos.mayorValor || 0,
        promedioValor: datos.totalComponentes > 0 ? parseFloat(datos.promedioValor.toFixed(2)) : 0
      },
      validacion: {
        esValido: sumaTotal <= 10,        
        esCompleto: sumaTotal === 10,    
        exceso: sumaTotal > 10 ? parseFloat((sumaTotal - 10).toFixed(2)) : 0,      
        faltante: sumaTotal < 10 ? parseFloat((10 - sumaTotal).toFixed(2)) : 0     
      },
      actividades: {
        total: totalActividades,
        hayActividades: totalActividades > 0
      },
      estado: getEstadoParcial(sumaTotal, datos.totalComponentes, totalActividades)
    };

    analisis.recomendaciones = generarRecomendaciones(analisis);

    res.json(analisis);

  } catch (error) {
    console.error('❌ Error al validar parcial:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

function getEstadoParcial(suma, componentes, actividades) {
  if (suma === 10 && componentes > 0) {           
    return actividades > 0 ? 'completo_con_actividades' : 'completo_sin_actividades';
  } else if (suma > 10) {                         
    return 'excedido';
  } else if (suma === 0) {
    return 'vacio';
  } else if (suma < 5) {                         
    return 'muy_incompleto';
  } else if (suma < 10) {                         
    return 'incompleto';
  }
  return 'indefinido';
}

function generarRecomendaciones(analisis) {
  const { estadisticas, validacion, actividades, estado } = analisis;
  const recomendaciones = [];

  switch (estado) {
    case 'vacio':
      recomendaciones.push({
        tipo: 'critico',
        icono: '🚨',
        titulo: 'Parcial sin componentes',
        mensaje: 'Este parcial no tiene componentes de evaluación',
        acciones: ['Agrega al menos 2-3 componentes básicos', 'Sugerencia: Actividades (4 pts), Examen (6 pts)'] 
      });
      break;

    case 'muy_incompleto':
      recomendaciones.push({
        tipo: 'advertencia',
        icono: '⚠️',
        titulo: 'Ponderación muy baja',
        mensaje: `Solo tienes ${estadisticas.sumaTotal} puntos asignados`, 
        acciones: [
          `Faltan ${validacion.faltante} puntos por asignar`,              
          'Considera agregar componentes importantes como Examen o Proyecto'
        ]
      });
      break;

    case 'incompleto':
      recomendaciones.push({
        tipo: 'info',
        icono: '📝',
        titulo: 'Casi completo',
        mensaje: `Te faltan ${validacion.faltante} puntos para completar`, 
        acciones: [
          validacion.faltante > 1 ? 'Agrega un componente mediano' : 'Agrega un componente pequeño', 
          'Opciones: Participación, Tareas, Asistencia'
        ]
      });
      break;

    case 'excedido':
      recomendaciones.push({
        tipo: 'error',
        icono: '❌',
        titulo: 'Ponderación excedida',
        mensaje: `Tienes ${validacion.exceso} puntos de más`,            
        acciones: [
          'Reduce el valor de algunos componentes',
          'O elimina componentes innecesarios'
        ]
      });
      break;

    case 'completo_sin_actividades':
      recomendaciones.push({
        tipo: 'exito',
        icono: '✅',
        titulo: '¡Ponderación completa!',
        mensaje: 'Tienes los 10 puntos configurados correctamente',      
        acciones: ['Ya puedes crear actividades para este parcial']
      });
      break;

    case 'completo_con_actividades':
      recomendaciones.push({
        tipo: 'perfecto',
        icono: '🎉',
        titulo: '¡Parcial completamente configurado!',
        mensaje: `10 puntos completos con ${actividades.total} actividades creadas`,
        acciones: ['El parcial está listo para calificaciones']
      });
      break;
  }

  if (estadisticas.totalComponentes === 1 && estadisticas.sumaTotal < 10) {
    recomendaciones.push({
      tipo: 'sugerencia',
      icono: '💡',
      titulo: 'Diversifica la evaluación',
      mensaje: 'Un solo componente puede ser riesgoso',
      acciones: ['Considera dividir en 2-3 componentes diferentes']
    });
  }

  if (estadisticas.mayorValor > 7) {                                    
    recomendaciones.push({
      tipo: 'advertencia',
      icono: '⚖️',
      titulo: 'Componente muy pesado',
      mensaje: `Un componente vale ${estadisticas.mayorValor} puntos`,   
      acciones: ['Considera balancear mejor la ponderación']
    });
  }

  if (estadisticas.totalComponentes > 6) {
    recomendaciones.push({
      tipo: 'info',
      icono: '🧮',
      titulo: 'Muchos componentes',
      mensaje: `Tienes ${estadisticas.totalComponentes} componentes`,
      acciones: ['Considera combinar algunos para simplificar']
    });
  }

  return recomendaciones;
}
const obtenerEstadisticasGeneralesDocente = async (req, res) => {
  const { claveDocente } = req.params;

  try {
    const pool = await sql.connect(config);

    const estadisticasParciales = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .execute(`sp_obtenerEstadisticasGeneralesDocente`);

    const resumen = {
      parcialesCompletos: estadisticasParciales.filter(p => p.estado === 'completo').length,
      parcialesIncompletos: estadisticasParciales.filter(p => p.estado === 'incompleto' || p.estado === 'muy_incompleto').length,
      parcialesExcedidos: estadisticasParciales.filter(p => p.estado === 'excedido').length,
      totalParciales: estadisticasParciales.length,
      detallePorMateria: {}
    };

    estadisticasParciales.forEach(parcial => {
      if (!resumen.detallePorMateria[parcial.vchClvMateria]) {
        resumen.detallePorMateria[parcial.vchClvMateria] = [];
      }
      resumen.detallePorMateria[parcial.vchClvMateria].push({
        parcial: parcial.parcial,
        componentes: parcial.totalComponentes,
        suma: parseFloat(parcial.sumaTotal.toFixed(2)),
        estado: parcial.estado
      });
    });

    res.json({
      resumen,
      estadisticasParciales: estadisticasParciales.map(p => ({
        ...p,
        sumaTotal: parseFloat(p.sumaTotal.toFixed(2))
      }))
    });

  } catch (error) {
    console.error('❌ Error al obtener estadísticas generales:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const clonarComponentesParcial = async (req, res) => {
  const { claveMateria, parcialOrigen, parcialDestino, periodo, claveDocente } = req.body;
  
  try {
    const pool = await sql.connect(config);

    const destinoCheck = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parcialDestino)
      .input('periodo', sql.VarChar, periodo)
      .input('claveDocente', sql.VarChar, claveDocente)
      .execute('sp_verificar_parcial_vacio');
    
    if (destinoCheck.recordset[0]?.cantidad > 0) {
      await pool.close();
      return res.status(400).json({
        error: 'El parcial destino ya tiene componentes configurados',
        sugerencia: 'Elimina primero los componentes existentes o elige otro parcial'
      });
    }

    const componentesOrigen = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parcialOrigen)
      .input('periodo', sql.VarChar, periodo)
      .execute('sp_obtener_componentes_materia');
    
    const componentes = componentesOrigen.recordset || [];
    
    if (componentes.length === 0) {
      await pool.close();
      return res.status(400).json({
        error: 'El parcial origen no tiene componentes para clonar',
        sugerencia: 'Configura primero los componentes del parcial origen'
      });
    }

    const sumaOrigen = componentes.reduce((suma, comp) => suma + parseFloat(comp.valor_componente || 0), 0);
    
    if (sumaOrigen !== 10) {
      await pool.close();
      return res.status(400).json({
        error: `El parcial origen suma ${sumaOrigen} puntos en lugar de 10`,
        sugerencia: 'Completa primero el parcial origen antes de clonarlo'
      });
    }

    const result = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcialOrigen', sql.Int, parcialOrigen)
      .input('parcialDestino', sql.Int, parcialDestino)
      .input('periodo', sql.VarChar, periodo)
      .input('claveDocente', sql.VarChar, claveDocente)
      .execute('sp_clonar_componentes_parcial');

    const componentesClonados = result.recordset[0]?.total || componentes.length;

    res.json({
      mensaje: `${componentesClonados} componentes clonados exitosamente`,
      total: componentesClonados,
      sumaTotal: 10,
      parcialOrigen,
      parcialDestino,
      detalles: {
        componentesClonados: componentes.map(c => ({
          nombre: c.nombre_componente,
          valor: c.valor_componente
        }))
      }
    });

    await pool.close();

  } catch (error) {
    console.error('Error al clonar componentes:', error);
    res.status(500).json({
      error: 'Error interno del servidor al clonar componentes'
    });
  }
};

const validarSumaComponentes = async (req, res) => {
  const { claveMateria, parcial, periodo, claveDocente } = req.params;

  try {
    const pool = await sql.connect(config);

    const result = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parseInt(parcial))
      .input('vchPeriodo', sql.VarChar, periodo)
      .input('claveDocente', sql.VarChar, claveDocente)
      .execute(`sp_validarSumaComponentes`);

    const datos = result.recordset[0];
    const sumaTotal = parseFloat(datos.sumaTotal.toFixed(2));

    res.json({
      totalComponentes: datos.totalComponentes,
      sumaTotal,
      disponible: parseFloat((100 - sumaTotal).toFixed(2)),
      detalleComponentes: datos.detalleComponentes,
      validacion: {
        esValido: sumaTotal <= 100,
        esCompleto: sumaTotal === 100,
        exceso: sumaTotal > 100 ? parseFloat((sumaTotal - 100).toFixed(2)) : 0,
        faltante: sumaTotal < 100 ? parseFloat((100 - sumaTotal).toFixed(2)) : 0
      },
      estado: sumaTotal === 100 ? 'completo' : 
              sumaTotal > 100 ? 'excedido' : 'incompleto'
    });

  } catch (error) {
    console.error('❌ Error al validar suma de componentes:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const obtenerComponentesParaDropdown = async (req, res) => {
  const { claveDocente, claveMateria, parcial, periodo } = req.params;

  try {
    const pool = await sql.connect(config);
    
    const result = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parseInt(parcial))
      .input('vchPeriodo', sql.VarChar, periodo)
      .execute(`sp_obtenerComponentesParaDropdown`);

    res.json(result.recordset);
  } catch (error) {
    console.error('❌ Error al obtener componentes para dropdown:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const formatearFechaParaSQL = (fecha) => {
  const año = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  const hora = String(fecha.getHours()).padStart(2, '0');
  const minuto = String(fecha.getMinutes()).padStart(2, '0');
  const segundo = String(fecha.getSeconds()).padStart(2, '0');
  
  return `${año}-${mes}-${dia} ${hora}:${minuto}:${segundo}`;
};

const crearActividadCompletaConComponente = async (req, res) => {
  const {
    titulo,
    descripcion,
    fechaEntrega,
    parcial,
    claveMateria,
    claveDocente,
    idInstrumento,
    idValorComponente,
    grupos,
    modalidad,
    equiposPorGrupo = {}
  } = req.body;

  try {
    const pool = await sql.connect(config);
    
    console.log('🚀 Iniciando creación de actividad con SP principal...');
    console.log('📅 fechaEntrega recibida del frontend:', fechaEntrega);

    let fechaEntregaParaSQL, fechaCreacionParaSQL, fechaAsignacionParaSQL;

    try {
      const ahoraCDMX = new Date();
      
      if (typeof fechaEntrega === 'string') {
        const match = fechaEntrega.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
        
        if (match) {
          const [, año, mes, dia, hora, minuto] = match;
          fechaEntregaParaSQL = new Date(parseInt(año), parseInt(mes) - 1, parseInt(dia), parseInt(hora), parseInt(minuto), 0, 0);
          console.log('✅ Fecha procesada:', fechaEntregaParaSQL);
        } else {
          throw new Error(`Formato de fecha inválido: ${fechaEntrega}`);
        }
      } else {
        fechaEntregaParaSQL = new Date(fechaEntrega);
      }
      
      fechaCreacionParaSQL = ahoraCDMX;
      fechaAsignacionParaSQL = ahoraCDMX;
      
      if (isNaN(fechaEntregaParaSQL.getTime()) || isNaN(fechaCreacionParaSQL.getTime())) {
        throw new Error('Fechas inválidas después del procesamiento');
      }
      
    } catch (error) {
      return res.status(400).json({
        error: 'Error al procesar fechas',
        fechaRecibida: fechaEntrega,
        detalle: error.message
      });
    }

    if (!idInstrumento || !idValorComponente) {
      return res.status(400).json({ 
        error: 'Faltan datos requeridos (instrumento o componente)'
      });
    }

    console.log('🎯 Ejecutando SP principal que maneja actividad + grupos + modalidad individual...');

    const formatearFechaParaSQL = (fecha) => {
  const año = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  const hora = String(fecha.getHours()).padStart(2, '0');
  const minuto = String(fecha.getMinutes()).padStart(2, '0');
  const segundo = String(fecha.getSeconds()).padStart(2, '0');
  return `${año}-${mes}-${dia} ${hora}:${minuto}:${segundo}`;
};

const fechaCreacionString = formatearFechaParaSQL(fechaCreacionParaSQL);
const fechaAsignacionString = formatearFechaParaSQL(fechaAsignacionParaSQL);
const fechaEntregaString = formatearFechaParaSQL(fechaEntregaParaSQL);
    const resultadoPrincipal = await pool.request()
      .input('titulo', sql.NVarChar, titulo)
      .input('descripcion', sql.NVarChar, descripcion)
      .input('fechaCreacion', sql.VarChar, fechaCreacionString)
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('idInstrumento', sql.Int, idInstrumento)
      .input('idValorComponente', sql.Int, idValorComponente)
      .input('modalidad', sql.Int, modalidad)
      .input('grupos', sql.VarChar, grupos.join(','))
      .input('fechaAsignacion', sql.VarChar, fechaAsignacionString)
      .input('fechaEntrega', sql.VarChar, fechaEntregaString)
      .execute('sp_numeroResult');

    const respuesta = resultadoPrincipal.recordset[0];

    if (respuesta.resultado === 'ERROR') {
      console.error('❌ Error en SP principal:', respuesta.mensaje);
      return res.status(500).json({
        error: 'Error al crear actividad',
        detalle: respuesta.mensaje
      });
    }

    const idActividad = respuesta.id_actividad;
    const numeroActividad = respuesta.numero_actividad;

    console.log('✅ SP principal ejecutado exitosamente:');
    console.log(`   📊 ID Actividad: ${idActividad}`);
    console.log(`   📊 Número: ${numeroActividad}`);
    console.log(`   📊 Grupos asignados: ${respuesta.grupos_asignados}`);
    console.log(`   📊 Alumnos asignados: ${respuesta.alumnos_asignados}`);

    if (modalidad === 2 && Object.keys(equiposPorGrupo).length > 0) {
      console.log('👥 Procesando equipos con SPs específicos en transacción...');
      
      const equipoTransaction = new sql.Transaction();
      
      try {
        await equipoTransaction.begin();
        
        for (const [claveGrupo, datosGrupo] of Object.entries(equiposPorGrupo)) {
          const grupoQuery = await pool.request()
  .input('clave', sql.VarChar, claveGrupo)
  .execute('sp_ObtenerIdGrupoPorClave_movil');


          if (grupoQuery.recordset.length === 0) continue;
          const idGrupo = grupoQuery.recordset[0].id_grupo;

          let equiposParaAsignar = [];
          
          if (datosGrupo.tipoSeleccion === 'actividad' && datosGrupo.idActividadAnterior) {
            console.log(`📋 Obteniendo equipos de actividad anterior: ${datosGrupo.idActividadAnterior}`);
            
            const equiposAnteriores = await equipoTransaction.request()
              .input('idActividadAnterior', sql.Int, datosGrupo.idActividadAnterior)
              .input('idGrupo', sql.Int, idGrupo)
              .execute('sp_equiposAnteriores');

            if (equiposAnteriores.recordset.length === 0) {
              throw new Error(`No se encontraron equipos de la actividad anterior para el grupo ${claveGrupo}`);
            }

            equiposParaAsignar = equiposAnteriores.recordset.map(e => e.id_equipo);
            console.log(`✅ Encontrados ${equiposParaAsignar.length} equipos anteriores`);

          } else if ((datosGrupo.tipoSeleccion === 'aleatorio' || datosGrupo.tipoSeleccion === 'manual') && datosGrupo.equiposNuevos) {
            console.log(`📋 Creando ${datosGrupo.equiposNuevos.length} equipos nuevos`);
            
            for (const equipoNuevo of datosGrupo.equiposNuevos) {
              if (!equipoNuevo.integrantes || equipoNuevo.integrantes.length === 0) {
                console.error(`❌ Equipo "${equipoNuevo.nombre}" no tiene integrantes`);
                continue;
              }

              const nombreEquipoUnico = `${equipoNuevo.nombre}_${Date.now()}`;
              
              const equipoCreado = await equipoTransaction.request()
                .input('idGrupo', sql.Int, idGrupo)
                .input('nombreEquipo', sql.NVarChar, nombreEquipoUnico)
                .execute('sp_equipoRecienCreado');

              if (equipoCreado.recordset.length === 0) {
                throw new Error(`No se pudo crear equipo "${equipoNuevo.nombre}"`);
              }

              const idEquipoCreado = equipoCreado.recordset[0].id_equipo;

              for (const integrante of equipoNuevo.integrantes) {
                if (!integrante.vchMatricula) continue;

                await equipoTransaction.request()
                  .input('idEquipo', sql.Int, idEquipoCreado)
                  .input('matricula', sql.VarChar, integrante.vchMatricula)
                  .execute('sp_asignarIntegranteEquipo');
              }

              equiposParaAsignar.push(idEquipoCreado);
              console.log(`✅ Equipo "${equipoNuevo.nombre}" creado (ID: ${idEquipoCreado})`);
            }
          }

          console.log(`🎯 Asignando ${equiposParaAsignar.length} equipos a la actividad`);

          for (const idEquipo of equiposParaAsignar) {
            const asignacionResult = await equipoTransaction.request()
              .input('idActividad', sql.Int, idActividad)
              .input('idEquipo', sql.Int, idEquipo)
              .input('idGrupo', sql.Int, idGrupo)
              .execute('sp_VerificarYAsignarEquipo');

            const resultado = asignacionResult.recordset[0];
            console.log(`${resultado.resultado}: ${resultado.mensaje}`);
          }

          console.log(`✅ Grupo ${claveGrupo}: ${equiposParaAsignar.length} equipos procesados`);
        }
        
        await equipoTransaction.commit();
        console.log('✅ Transacción de equipos completada exitosamente');
        
      } catch (equipoError) {
        await equipoTransaction.rollback();
        console.error('❌ Error en procesamiento de equipos, rollback realizado:', equipoError.message);
        return res.status(500).json({
          error: 'Error al procesar equipos',
          detalle: equipoError.message,
          nota: 'La actividad fue creada pero los equipos fallaron'
        });
      }
    }

    console.log('🔍 Ejecutando verificación automática...');
    
    try {
      const verificacionResult = await pool.request()
        .input('idActividad', sql.Int, idActividad)
        .execute('sp_VerificarFechaActividadAuto');

      const verificacion = verificacionResult.recordset[0];
      console.log(`🔍 ${verificacion.estado_validacion}: ${verificacion.validacion_resultado}`);
    } catch (verificacionError) {
      console.log('⚠️ Verificación automática no disponible, continuando...');
    }

    console.log('🎉 ¡Actividad creada exitosamente con SP optimizado!');

    res.status(201).json({ 
      mensaje: respuesta.mensaje,
      actividad: {
        idActividad,
        titulo,
        modalidad: modalidad === 1 ? 'Individual' : 'Equipo',
        numeroActividad,
        componente: idValorComponente,
        estadosConfigurados: true
      },
      estadisticas: {
        gruposAsignados: respuesta.grupos_asignados,
        alumnosAsignados: respuesta.alumnos_asignados,
        totalEntidades: modalidad === 1 ? respuesta.alumnos_asignados : Object.keys(equiposPorGrupo).length
      },
      debug: {
        spPrincipalUsado: 'sp_numeroResult',
        modalidad: modalidad === 1 ? 'Individual (manejada por SP)' : 'Equipo (SPs específicos)',
        fechaOriginal: fechaEntrega,
        fechaProcesada: fechaEntregaString
      }
    });

  } catch (error) {
    console.error('❌ Error general al crear actividad:', error);
    res.status(500).json({
      error: 'Error al crear actividad',
      detalle: error.message,
      fechaRecibida: fechaEntrega
    });
  }
};

const crearActividad = async (req, res) => {
  const {
    titulo,
    descripcion,
    fechaEntrega,
    parcial,
    claveMateria,
    claveDocente,
    formatoFDAC,
    grupos
  } = req.body;

  try {
    const pool = await sql.connect(config);

    const instrumentoResult = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parcial)
      .execute('sp_instrumentoQuery');

    if (instrumentoResult.recordset.length === 0) {
      return res.status(400).json({ 
        error: 'No se encontró instrumento para este docente/materia/parcial' 
      });
    }

    const idInstrumento = instrumentoResult.recordset[0].id_instrumento;

    const numeroResult = await pool.request()
      .execute('sp_numeroResult2');
    
    const numeroActividad = numeroResult.recordset[0].siguiente;

    const actividadResult = await pool.request()
      .input('titulo', sql.NVarChar, titulo)
      .input('descripcion', sql.NVarChar, descripcion)
      .input('fecha', sql.Date, new Date())
      .input('docente', sql.NVarChar, claveDocente)
      .input('idInstrumento', sql.Int, idInstrumento)
      .input('numero', sql.Int, numeroActividad)
      .input('modalidad', sql.Int, 1)
      .execute('sp_actividadResult');

    const idActividad = actividadResult.recordset[0].idActividad;

    let totalAlumnosAsignados = 0;

    for (const claveGrupo of grupos) {
      const grupoQuery = await pool.request()
        .input('clave', sql.VarChar, claveGrupo)
        .query('SELECT TOP 1 id_grupo FROM tbl_grupos WHERE vchGrupo = @clave');

      if (grupoQuery.recordset.length === 0) continue;
      const idGrupo = grupoQuery.recordset[0].id_grupo;

      await pool.request()
        .input('idActividad', sql.Int, idActividad)
        .input('idGrupo', sql.Int, idGrupo)
        .input('fechaAsignacion', sql.DateTime, new Date())
        .input('fechaEntrega', sql.DateTime, fechaEntrega)
        .execute('sp_InsertarActividadGrupo');

      const periodoResult = await pool.request()
        .input('claveDocente', sql.VarChar, claveDocente)
        .input('claveMateria', sql.VarChar, claveMateria)
        .execute('sp_periodoResult');

      if (periodoResult.recordset.length === 0) continue;
      const { vchCuatrimestre, Periodo } = periodoResult.recordset[0];

      const alumnosResult = await pool.request()
        .input('idGrupo', sql.Int, idGrupo)
        .input('cuatrimestre', sql.VarChar, vchCuatrimestre)
        .input('periodo', sql.VarChar, Periodo)
        .execute('sp_alumnosResult');

      for (const alumno of alumnosResult.recordset) {
        await pool.request()
          .input('idActividad', sql.Int, idActividad)
          .input('matricula', sql.VarChar, alumno.vchMatricula)
          .input('idEstado', sql.Int, 1)
          .execute('sp_AsignarAlumnoActividadPendiente');
        
        totalAlumnosAsignados++;
      }
    }

    console.log(`✅ Actividad creada usando SPs: ID=${idActividad}, Alumnos=${totalAlumnosAsignados}`);

    res.status(201).json({ 
      mensaje: 'Actividad creada correctamente con estados iniciales usando SPs', 
      actividad: {
        idActividad,
        titulo,
        numeroActividad,
        modalidad: 'Individual',
        parcial,
        estadosConfigurados: true
      },
      estadisticas: {
        gruposAsignados: grupos.length,
        alumnosAsignados: totalAlumnosAsignados
      },
      debug: {
        idInstrumentoObtenido: idInstrumento,
        spUtilizados: [
          'sp_instrumentoQuery',
          'sp_numeroResult2', 
          'sp_actividadResult',
          'sp_InsertarActividadGrupo',
          'sp_periodoResult',
          'sp_alumnosResult',
          'sp_AsignarAlumnoActividadPendiente'
        ]
      }
    });

  } catch (error) {
    console.error('❌ Error al crear actividad simple:', error);
    res.status(500).json({ 
      mensaje: 'Error interno al registrar la actividad',
      detalle: error.message
    });
  }
};

const guardarObservacionAlumno = async (req, res) => {
  const { idActividadAlumno, observacion } = req.body;

  try {
    const pool = await sql.connect(config);
    
    console.log(`💬 Guardando observación para alumno - ID: ${idActividadAlumno}`);

    await pool.request()
      .input('idActividadAlumno', sql.Int, idActividadAlumno)
      .input('observacion', sql.NVarChar, observacion || null)
      .execute(`sp_ActualizarObservacionAlumno`);

    console.log('✅ Observación de alumno guardada correctamente');
    res.json({ mensaje: 'Observación guardada correctamente' });

  } catch (error) {
    console.error('❌ Error al guardar observación del alumno:', error);
    res.status(500).json({ error: 'Error al guardar observación' });
  }
};

const guardarObservacionEquipo = async (req, res) => {
  const { idActividadEquipo, observacion } = req.body;

  try {
    const pool = await sql.connect(config);
    
    console.log(`💬 Guardando observación para equipo - ID: ${idActividadEquipo}`);

    await pool.request()
      .input('idActividadEquipo', sql.Int, idActividadEquipo)
      .input('observacion', sql.NVarChar, observacion || null)
      .execute(`sp_GuardarObservacionEquipo`);

    console.log('✅ Observación de equipo guardada correctamente');
    res.json({ mensaje: 'Observación del equipo guardada correctamente' });

  } catch (error) {
    console.error('❌ Error al guardar observación del equipo:', error);
    res.status(500).json({ error: 'Error al guardar observación' });
  }
};

const obtenerObservacionAlumno = async (req, res) => {
  const { idActividadAlumno } = req.params;

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('idActividadAlumno', sql.Int, idActividadAlumno)
      .execute(`sp_obtenerObservacionAlumno`);

    res.json({ 
      observacion: result.recordset[0]?.observacion || '' 
    });

  } catch (error) {
    console.error('❌ Error al obtener observación del alumno:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const obtenerObservacionEquipo = async (req, res) => {
  const { idActividadEquipo } = req.params;

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('idActividadEquipo', sql.Int, idActividadEquipo)
      .execute(`sp_obtenerObservacionEquipo`);

    res.json({ 
      observacion: result.recordset[0]?.observacion || '' 
    });

  } catch (error) {
    console.error('❌ Error al obtener observación del equipo:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const obtenerConcentradoFinal = async (req, res) => {
  const { parcial, grupo, periodo, cuatrimestre, materia } = req.params;

  try {
    const pool = await sql.connect(config);
    
    console.log(`📊 Ejecutando sp_FiltrarConcentradoFinal con: Parcial=${parcial}, Grupo=${grupo}, Periodo=${periodo}, Cuatrimestre=${cuatrimestre}, Materia=${materia}`);

    const result = await pool.request()
      .input('Parcial', sql.Int, parseInt(parcial))
      .input('Grupo', sql.VarChar, grupo)
      .input('Periodo', sql.VarChar, periodo)
      .input('Cuatrimestre', sql.VarChar, cuatrimestre)
      .input('Materia', sql.VarChar, materia)
      .execute('sp_FiltrarConcentradoFinal');

    console.log(`✅ Concentrado obtenido: ${result.recordset.length} registros`);
    res.json(result.recordset);

  } catch (error) {
    console.error('❌ Error al obtener concentrado final:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const obtenerCalificacionesActividad = async (req, res) => {
  const { parcial, grupo, periodo, cuatrimestre, materia } = req.params;

  try {
    const pool = await sql.connect(config);
    
    console.log(`📋 Ejecutando sp_FiltrarCalificacion_Actividad con: Parcial=${parcial}, Grupo=${grupo}, Periodo=${periodo}, Cuatrimestre=${cuatrimestre}, Materia=${materia}`);

    const result = await pool.request()
      .input('Parcial', sql.Int, parseInt(parcial))
      .input('Grupo', sql.VarChar, grupo)
      .input('Periodo', sql.VarChar, periodo)
      .input('Cuatrimestre', sql.VarChar, cuatrimestre)
      .input('Materia', sql.VarChar, materia)
      .execute('sp_FiltrarCalificacion_Actividad');

    console.log(`✅ Calificaciones obtenidas: ${result.recordset.length} registros`);
    res.json(result.recordset);

  } catch (error) {
    console.error('❌ Error al obtener calificaciones de actividad:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const obtenerListasCotejo = async (req, res) => {
  const { claveDocente, claveMateria } = req.params;

  try {
    const pool = await sql.connect(config);

    const result = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .execute(`sp_obtenerListasCotejo`);

    res.json(result.recordset);
  } catch (error) {
    console.error('❌ Error al obtener listas de cotejo:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const obtenerActividadesPorGrupo = async (req, res) => {
  const { claveDocente, claveMateria, idGrupo } = req.params;
  const { parcial, modalidad } = req.query;

  try {
    const pool = await sql.connect(config);
    
    console.log(`📊 Cargando actividades para grupo específico: ${idGrupo}`);
    
    const request = pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('idGrupo', sql.Int, idGrupo);
    
    if (parcial) {
      request.input('parcial', sql.Int, parcial);
    } else {
      request.input('parcial', sql.Int, null);
    }
    
    if (modalidad) {
      request.input('modalidad', sql.Int, modalidad);
    } else {
      request.input('modalidad', sql.Int, null);
    }

    const result = await request.execute('sp_obtenerActividadesPorGrupo');

    const actividadesPorParcial = {};
    
    result.recordset.forEach(actividad => {
      const parcial = actividad.parcial;
      
      if (!actividadesPorParcial[parcial]) {
        actividadesPorParcial[parcial] = {
          numero: parcial,
          nombre: `Parcial ${parcial}`,
          actividades: [],
          estadisticas: {
            total: 0,
            pendientes: 0,
            completadas: 0,
            vencidas: 0
          }
        };
      }

      const estado = actividad.estadoActividad;
      
      actividadesPorParcial[parcial].actividades.push({
        id_actividad: actividad.id_actividad,
        titulo: actividad.titulo,
        descripcion: actividad.descripcion,
        fecha_entrega: actividad.fecha_entrega,
        fecha_asignacion: actividad.fecha_asignacion,
        numero_actividad: actividad.numero_actividad,
        modalidad: (actividad.id_modalidad === 2) ? 'equipo' : 'individual',
        estado: estado,
        
        estadisticasDetalladas: {
          pendientes: actividad.alumnosPendientes || 0,
          entregadosATiempo: actividad.entregadosATiempo || 0,
          noEntregados: actividad.noEntregados || 0,
          entregadosTarde: actividad.entregadosTarde || 0,
          total: actividad.totalEntregas || 0
        },
        
        porcentajeCompletado: actividad.porcentajeCompletado || 0,
        diasRestantes: actividad.diasRestantes,
        grupo: actividad.vchGrupo,
        instrumento: actividad.nombre_instrumento,
        componente: actividad.nombre_componente || 'Sin componente',
        parcial: actividad.parcial,
        
        urgente: actividad.diasRestantes <= 2 && estado === 'activa',
        requiereAtencion: (actividad.alumnosPendientes || 0) > 0 && actividad.diasRestantes < 0
      });

      actividadesPorParcial[parcial].estadisticas.total++;
      if (estado === 'activa') actividadesPorParcial[parcial].estadisticas.pendientes++;
      if (estado === 'completada') actividadesPorParcial[parcial].estadisticas.completadas++;
      if (estado === 'vencida' || estado === 'pendiente_vencida') actividadesPorParcial[parcial].estadisticas.vencidas++;
    });

    const estadisticasGlobales = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('idGrupo', sql.Int, idGrupo)
      .execute(`sp_obtenerEstadisticasGlobalesPorGrupo`);

    const stats = estadisticasGlobales.recordset[0] || {
      actividadesCompletas: 0,
      totalPendientes: 0,
      actividadesVencidas: 0,
      totalActividades: 0
    };

    const parciales = Object.keys(actividadesPorParcial)
      .map(Number)
      .sort((a, b) => a - b)
      .map(parcial => actividadesPorParcial[parcial]);

    console.log(`✅ Estadísticas calculadas para grupo ${idGrupo}:`, stats);
    console.log(`📊 Parciales procesados: ${parciales.length}`);

    res.json({
      parciales,
      estadisticas: {
        totalActividades: stats.totalActividades,
        completas: stats.actividadesCompletas,
        pendientes: stats.totalPendientes,
        vencidas: stats.actividadesVencidas
      },
      metadata: {
        grupoEspecifico: idGrupo,
        sistemaEstados: 'optimizado_v2_por_grupo',
        usaTriggers: true,
        estadosDisponibles: {
          1: 'Pendiente',
          2: 'Entregado',
          3: 'No Entregado', 
          4: 'Entregado fuera de tiempo'
        }
      }
    });

  } catch (error) {
    console.error('❌ Error al obtener actividades por grupo:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const cambiarContrasenaDocente = async (req, res) => {
  const { usuario, contrasenaActual, nuevaContrasena } = req.body;

  try {
    const pool = await sql.connect(config);
    
    const result = await pool.request()
      .input('usuario', sql.VarChar, usuario)
      .input('contrasenaActual', sql.VarChar, contrasenaActual)
      .input('nuevaContrasena', sql.VarChar, nuevaContrasena)
      .execute('sp_cambiarContrasenaDocente');

    const mensaje = result.recordset[0]?.mensaje || 'Contraseña actualizada correctamente';
    
    res.json({ 
      mensaje: mensaje,
      success: true 
    });

  } catch (err) {
    console.error('❌ Error al cambiar contraseña:', err);
    
    if (err.message && err.message.includes('La contraseña actual es incorrecta')) {
      return res.status(400).json({ 
        mensaje: 'La contraseña actual es incorrecta',
        success: false 
      });
    }
    
    res.status(500).json({ 
      mensaje: 'Error en el servidor',
      success: false 
    });
  }
};

const obtenerEquiposPorGrupo = async (req, res) => {
  const { claveDocente, claveMateria, idGrupo } = req.params;

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('idGrupo', sql.Int, idGrupo)
      .execute(`sp_obtenerEquiposPorGrupo`);

    res.json(result.recordset);
  } catch (error) {
    console.error('❌ Error al obtener equipos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const obtenerAlumnosPorGrupo = async (req, res) => {
  const { claveDocente, claveMateria, idGrupo } = req.params;

  try {
    const pool = await sql.connect(config);
    
    const result = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('idGrupo', sql.Int, idGrupo)
      .execute('sp_obtenerAlumnosPorGrupo');

    res.json(result.recordset);

  } catch (error) {
    console.error('❌ Error al obtener alumnos:', error);
    
    if (error.message && error.message.includes('No se encontró la relación docente-materia')) {
      return res.status(404).json({ 
        error: 'No se encontró la relación docente-materia' 
      });
    }
    
    res.status(500).json({ 
      error: 'Error del servidor' 
    });
  }
};

const simularEquiposAleatorios = async (req, res) => {
  const { idGrupo, cantidadEquipos, claveDocente, claveMateria } = req.body;

  try {
    const pool = await sql.connect(config);

    const result = await pool.request()
      .input('idGrupo', sql.Int, idGrupo)
      .input('cantidadEquipos', sql.Int, cantidadEquipos)
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .execute('sp_simularEquiposAleatorios');

    const alumnos = result.recordset;
    
    if (alumnos.length === 0) {
      return res.status(400).json({ error: 'No hay alumnos disponibles' });
    }

    const alumnosPorEquipo = Math.floor(alumnos.length / cantidadEquipos);
    const alumnosSobrantes = alumnos.length % cantidadEquipos;

    const equiposSimulados = [];
    let indiceAlumno = 0;

    for (let i = 1; i <= cantidadEquipos; i++) {
      const integrantesEnEsteEquipo = alumnosPorEquipo + (i <= alumnosSobrantes ? 1 : 0);
      
      const integrantes = [];
      for (let j = 0; j < integrantesEnEsteEquipo; j++) {
        integrantes.push(alumnos[indiceAlumno]);
        indiceAlumno++;
      }

      equiposSimulados.push({
        id_temporal: Date.now() + i,
        nombre: `Equipo ${i}`,
        integrantes,
        esNuevo: true
      });
    }

    res.json({
      equiposSimulados,
      distribucion: {
        totalAlumnos: alumnos.length,
        equiposCreados: cantidadEquipos,
        alumnosPorEquipo,
        equiposConIntegranteExtra: alumnosSobrantes
      }
    });

  } catch (error) {
    console.error('❌ Error al simular equipos:', error);
    
    if (error.message && error.message.includes('No se encontró la relación docente-materia')) {
      return res.status(404).json({ 
        error: 'No se encontró la relación docente-materia' 
      });
    }
    
    res.status(500).json({ 
      error: 'Error del servidor' 
    });
  }
};

const obtenerActividadesConEquiposPorGrupo = async (req, res) => {
  const { claveDocente, claveMateria, idGrupo } = req.params;

  try {
    const pool = await sql.connect(config);
    
    console.log(`🔍 Obteniendo actividades con equipos para grupo específico: ${idGrupo}`);
    
    const result = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('idGrupo', sql.Int, idGrupo)
      .execute('sp_obtenerActividadesConEquiposPorGrupo');

    console.log(`✅ Actividades con equipos encontradas para grupo ${idGrupo}: ${result.recordset.length}`);
    
    if (result.recordset.length > 0) {
      console.log('📋 Actividades con equipos del grupo:', result.recordset.map(act => ({
        titulo: act.titulo,
        numero: act.numero_actividad,
        equipos: act.total_equipos,
        nombres: act.nombres_equipos
      })));
    } else {
      console.log(`⚠️ No se encontraron actividades con equipos para el grupo ${idGrupo}`);
    }

    res.json(result.recordset);
  } catch (error) {
    console.error('❌ Error al obtener actividades con equipos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const obtenerDatosActividad = async (req, res) => {
  const { idActividad } = req.params;

  try {
    const pool = await sql.connect(config);
    
    const result = await pool.request()
      .input('idActividad', sql.Int, idActividad)
      .execute('sp_obtenerDatosActividad');

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Actividad no encontrada' });
    }

    res.json(result.recordset[0]);
  } catch (error) {
    console.error('❌ Error al obtener datos de actividad:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const obtenerCriteriosActividad = async (req, res) => {
  const { idActividad } = req.params;

  try {
    const pool = await sql.connect(config);
    
    const result = await pool.request()
      .input('idActividad', sql.Int, idActividad)
      .execute('sp_obtenerCriteriosActividad');

    res.json(result.recordset);
    
  } catch (error) {
    console.error('❌ Error al obtener criterios:', error);
    
    if (error.message && error.message.includes('Instrumento no encontrado')) {
      return res.status(404).json({ 
        error: 'Instrumento no encontrado' 
      });
    }
    
    res.status(500).json({ 
      error: 'Error del servidor' 
    });
  }
};

const obtenerEquiposParaCalificar = async (req, res) => {
  const { idActividad } = req.params;
  const { idGrupo } = req.query;

  try {
    const pool = await sql.connect(config);
    
    console.log(`🔍 Obteniendo equipos para calificar: Actividad=${idActividad}, Grupo=${idGrupo}`);

    const request = pool.request()
      .input('idActividad', sql.Int, idActividad);

    if (idGrupo) {
      request.input('idGrupo', sql.Int, parseInt(idGrupo));
      console.log(`🎯 Filtrando por ID de grupo numérico: ${idGrupo}`);
    } else {
      request.input('idGrupo', sql.Int, null);
    }

    const result = await request.execute('sp_obtenerEquiposParaCalificar');

    console.log(`✅ Equipos encontrados para grupo ID ${idGrupo}: ${result.recordset.length}`);
    
    if (result.recordset.length > 0) {
      console.log('📋 Equipos encontrados:', result.recordset.map(e => ({
        nombre: e.nombre_equipo,
        grupoNombre: e.vchGrupo,
        grupoId: e.id_grupo
      })));
    } else {
      console.log('⚠️ No se encontraron equipos para esta actividad y grupo');
    }

    res.json(result.recordset);
  } catch (error) {
    console.error('❌ Error al obtener equipos para calificar:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const obtenerAlumnosParaCalificar = async (req, res) => {
  const { idActividad } = req.params;

  try {
    const pool = await sql.connect(config);
    
    const result = await pool.request()
      .input('idActividad', sql.Int, idActividad)
      .execute('sp_obtenerAlumnosParaCalificar');

    res.json(result.recordset);
  } catch (error) {
    console.error('❌ Error al obtener alumnos para calificar:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};


const obtenerCalificacionesAlumno = async (req, res) => {
  const { idActividadAlumno } = req.params;

  try {
    const pool = await sql.connect(config);
    
    const result = await pool.request()
      .input('idActividadAlumno', sql.Int, idActividadAlumno)
      .execute('sp_ObtenerCalificacionesAlumno');

    const calificaciones = result.recordsets[0];
    const observacionData = result.recordsets[1];

    res.json({
      calificaciones: calificaciones,
      observacion: observacionData[0]?.observacion || null
    });

  } catch (error) {
    console.error('❌ Error al obtener calificaciones del alumno:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const obtenerCalificacionesEquipo = async (req, res) => {
  const { idActividadEquipo } = req.params;

  try {
    const pool = await sql.connect(config);
    
    const result = await pool.request()
      .input('idActividadEquipo', sql.Int, idActividadEquipo)
      .execute('sp_ObtenerCalificacionesEquipo');

    const calificaciones = result.recordsets[0];
    const observacionData = result.recordsets[1];

    res.json({
      calificaciones: calificaciones,
      observacion: observacionData[0]?.observacion || null
    });

  } catch (error) {
    console.error('❌ Error al obtener calificaciones del equipo:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const guardarCalificacionesAlumno = async (req, res) => {
  const { idActividadAlumno, calificaciones, observacion } = req.body;

  const transaction = new sql.Transaction();

  try {
    const pool = await sql.connect(config);
    await transaction.begin();

    console.log(`📝 Guardando calificaciones para alumno ID: ${idActividadAlumno}`);
    console.log(`💬 OBSERVACIÓN RECIBIDA DEL FRONTEND:`, observacion);
    console.log(`📊 CALIFICACIONES:`, calificaciones);

    await transaction.request()
      .input('idActividadAlumno', sql.Int, idActividadAlumno)
      .execute('sp_EliminarCalificacionesAlumno');

    for (const cal of calificaciones) {
      await transaction.request()
        .input('idActividadAlumno', sql.Int, idActividadAlumno)
        .input('idCriterio', sql.Int, cal.id_criterio)
        .input('calificacion', sql.Float, cal.calificacion || 0)
        .execute('sp_InsertarCalificacion');
    }

    await transaction.request()
      .input('idActividadAlumno', sql.Int, idActividadAlumno)
      .input('nuevoEstado', sql.Int, 2)
      .input('observacion', sql.NVarChar, observacion || null)
      .execute('sp_ActualizarEstadoYObservacion');

    await transaction.commit();
    
    console.log(`✅ Calificaciones guardadas y estado actualizado a "Entregado"`);
    console.log(`💬 Observación final guardada: "${observacion}"`);
    
    res.json({ 
      mensaje: 'Calificaciones y observación guardadas correctamente',
      estadoActualizado: 'Entregado',
      observacionGuardada: observacion
    });

  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error al guardar calificaciones del alumno:', error);
    res.status(500).json({ error: 'Error al guardar calificaciones' });
  }
};

const guardarCalificacionesEquipo = async (req, res) => {
  const { idActividadEquipo, idEquipo, calificaciones, observacion, integrantesPersonalizados } = req.body;

  const transaction = new sql.Transaction();

  try {
    const pool = await sql.connect(config);
    await transaction.begin();

    console.log('🔄 Guardando calificaciones de equipo...');
    console.log('📋 idActividadEquipo:', idActividadEquipo);
    console.log('👥 idEquipo:', idEquipo);
    console.log('📊 Calificaciones:', calificaciones);
    console.log('💬 Observación:', observacion);
    console.log('🎯 Integrantes personalizados:', integrantesPersonalizados);

    await transaction.request()
      .input('idActividadEquipo', sql.Int, idActividadEquipo)
      .execute('sp_EliminarCalificacionesEquipo');

    const integrantesResult = await transaction.request()
      .input('idEquipo', sql.Int, idEquipo)
      .execute('sp_ObtenerIntegrantesEquipo');

    const integrantes = integrantesResult.recordset;
    console.log(`👥 Integrantes del equipo: ${integrantes.length}`);

    if (integrantes.length === 0) {
      throw new Error('No se encontraron integrantes en el equipo');
    }

    const actividadResult = await transaction.request()
      .input('idActividadEquipo', sql.Int, idActividadEquipo)
      .execute('sp_ObtenerIdActividadEquipo');

    if (actividadResult.recordset.length === 0) {
      throw new Error('Actividad equipo no encontrada');
    }

    const idActividad = actividadResult.recordset[0].id_actividad;

    for (const cal of calificaciones) {
      await transaction.request()
        .input('idEquipo', sql.Int, idEquipo)
        .input('idActividadEquipo', sql.Int, idActividadEquipo)
        .input('idCriterio', sql.Int, cal.id_criterio)
        .input('calificacion', sql.Float, cal.calificacion || 0)
        .execute('sp_InsertarCalificacionEquipo');
    }

    await transaction.request()
      .input('idActividadEquipo', sql.Int, idActividadEquipo)
      .input('nuevoEstado', sql.Int, 2)
      .input('observacion', sql.NVarChar, observacion || null)
      .execute('sp_ActualizarEstadoYObservacionEquipo');

    console.log('🔧 Mapeando matrículas temporales a reales...');
    const integrantesPersonalizadosConMatriculasReales = [];

    if (integrantesPersonalizados && integrantesPersonalizados.length > 0) {
      for (let i = 0; i < integrantes.length && i < integrantesPersonalizados.length; i++) {
        const integranteReal = integrantes[i];
        const integrantePersonalizado = integrantesPersonalizados[i];
        
        integrantesPersonalizadosConMatriculasReales.push({
          vchMatricula: integranteReal.vchMatricula,
          tieneCalificacionPersonalizada: integrantePersonalizado.tieneCalificacionPersonalizada || false,
          observacionesPersonalizadas: integrantePersonalizado.observacionesPersonalizadas || '',
          criteriosPersonalizados: integrantePersonalizado.criteriosPersonalizados || {}
        });
        
        console.log(`🔄 Mapeado: ${integrantePersonalizado.vchMatricula} → ${integranteReal.vchMatricula}`);
      }
    }

    console.log('✅ Mapeo completado:', integrantesPersonalizadosConMatriculasReales);

    for (const integrante of integrantes) {
      console.log(`📝 Procesando calificaciones para ${integrante.vchMatricula}`);

      const integrantePersonalizado = integrantesPersonalizadosConMatriculasReales?.find(
        ip => ip.vchMatricula === integrante.vchMatricula
      );

      const tieneCalificacionPersonalizada = integrantePersonalizado?.tieneCalificacionPersonalizada || false;
      const observacionPersonalizada = integrantePersonalizado?.observacionesPersonalizadas || observacion;

      console.log(`🎯 ${integrante.vchMatricula} - Personalizada: ${tieneCalificacionPersonalizada}`);

      const actividadAlumnoResult = await transaction.request()
        .input('idActividad', sql.Int, idActividad)
        .input('matricula', sql.VarChar, integrante.vchMatricula)
        .execute('sp_VerificarActividadAlumno');

      let idActividadAlumno;

      if (actividadAlumnoResult.recordset.length === 0) {
        await transaction.request()
          .input('idActividad', sql.Int, idActividad)
          .input('matricula', sql.VarChar, integrante.vchMatricula)
          .input('estadoInicial', sql.Int, 2)
          .input('observacion', sql.NVarChar, observacionPersonalizada || null)
          .execute('sp_CrearActividadAlumno');
        
        const nuevoIdResult = await transaction.request()
          .input('idActividad', sql.Int, idActividad)
          .input('matricula', sql.VarChar, integrante.vchMatricula)
          .execute('sp_ObtenerIdActividadAlumno');
        
        idActividadAlumno = nuevoIdResult.recordset[0].id_actividad_alumno;
        console.log(`✅ Creado tbl_actividad_alumno para ${integrante.vchMatricula}: ${idActividadAlumno}`);
      } else {
        idActividadAlumno = actividadAlumnoResult.recordset[0].id_actividad_alumno;
        
        await transaction.request()
          .input('idActividadAlumno', sql.Int, idActividadAlumno)
          .input('nuevoEstado', sql.Int, 2)
          .input('observacion', sql.NVarChar, observacionPersonalizada || null)
          .execute('sp_ActualizarEstadoObservacionAlumno');
        
        console.log(`✅ Actualizando tbl_actividad_alumno existente: ${idActividadAlumno}`);
      }

      await transaction.request()
        .input('idActividadAlumno', sql.Int, idActividadAlumno)
        .execute('sp_EliminarCalificacionesIndividualesAlumno');

      if (tieneCalificacionPersonalizada && integrantePersonalizado.criteriosPersonalizados) {
        console.log(`🌟 Aplicando calificaciones PERSONALIZADAS para ${integrante.vchMatricula}`);
        
        for (const [idCriterio, calificacionPersonalizada] of Object.entries(integrantePersonalizado.criteriosPersonalizados)) {
          await transaction.request()
            .input('idActividadAlumno', sql.Int, idActividadAlumno)
            .input('idCriterio', sql.Int, parseInt(idCriterio))
            .input('calificacion', sql.Float, calificacionPersonalizada)
            .execute('sp_InsertarCalificacion');
          
          console.log(`   ✅ Criterio ${idCriterio}: ${calificacionPersonalizada} puntos`);
        }
      } else {
        console.log(`📊 Aplicando calificaciones del EQUIPO para ${integrante.vchMatricula}`);
        
        for (const cal of calificaciones) {
          await transaction.request()
            .input('idActividadAlumno', sql.Int, idActividadAlumno)
            .input('idCriterio', sql.Int, cal.id_criterio)
            .input('calificacion', sql.Float, cal.calificacion)
            .execute('sp_InsertarCalificacion');
        }
      }
    }

    await transaction.commit();
    
    const integrantesPersonalizadosCount = integrantesPersonalizadosConMatriculasReales?.filter(ip => ip.tieneCalificacionPersonalizada).length || 0;
    const integrantesGeneralesCount = integrantes.length - integrantesPersonalizadosCount;
    
    console.log('✅ Calificaciones del equipo guardadas correctamente');
    console.log(`📊 Integrantes con calificación personalizada: ${integrantesPersonalizadosCount}`);
    console.log(`📊 Integrantes con calificación del equipo: ${integrantesGeneralesCount}`);
    console.log(`🔧 Criterios calificados: ${calificaciones.length}`);
    console.log(`🎯 Estados actualizados a "Entregado"`);
    
    res.json({ 
      mensaje: 'Calificaciones del equipo guardadas correctamente',
      integrantes_calificados: integrantes.length,
      criterios_calificados: calificaciones.length,
      estadoActualizado: 'Entregado',
      observacionGuardada: observacion,
      calificacionesIndividuales: {
        personalizadas: integrantesPersonalizadosCount,
        generales: integrantesGeneralesCount,
        total: integrantes.length
      },
      detalle: integrantesPersonalizadosCount > 0 ? 
        `Se aplicaron ${integrantesPersonalizadosCount} calificaciones personalizadas y ${integrantesGeneralesCount} calificaciones generales` :
        `Se replicaron las calificaciones del equipo a ${integrantes.length} integrantes`
    });

  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error al guardar calificaciones del equipo:', error);
    res.status(500).json({ 
      error: 'Error al guardar calificaciones del equipo',
      detalle: error.message 
    });
  }
};

const obtenerPeriodosDocente = async (req, res) => {
  const { clave } = req.params;

  try {
    const pool = await sql.connect(config);
    
    const result = await pool.request()
      .input('clave', sql.VarChar, clave)
      .execute('sp_ObtenerPeriodosDocente');

    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Error al obtener periodos del docente:', err);
    res.status(500).json({ mensaje: 'Error en el servidor' });
  }
};

const obtenerMateriasCompletasPorPeriodo = async (req, res) => {
  const { clave, periodo } = req.params;

  try {
    const pool = await sql.connect(config);

    const result = await pool.request()
      .input('clave', sql.VarChar, clave)
      .input('periodo', sql.VarChar, periodo || '20251')
      .execute('sp_ObtenerMateriasCompletasPorPeriodo');

    console.log(`✅ Encontradas ${result.recordset.length} materias del periodo ${periodo || '20251'}`);
    res.json(result.recordset);

  } catch (err) {
    console.error('❌ Error al obtener materias por periodo específico:', err);
    res.status(500).json({ mensaje: 'Error en el servidor' });
  }
};

const obtenerEstadisticasGrupo = async (req, res) => {
  const { claveDocente, claveMateria, idGrupo } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`📊 Calculando estadísticas optimizadas para: Docente=${claveDocente}, Materia=${claveMateria}, Grupo=${idGrupo}`);

    const result = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('idGrupo', sql.Int, idGrupo)
      .execute('sp_ObtenerEstadisticasGrupo');

    const stats = result.recordset[0] || {
      actividadesCompletas: 0,
      totalPendientes: 0,
      actividadesVencidas: 0,
      totalActividades: 0,
      totalEntregados: 0,
      totalNoEntregados: 0,
      totalEntregadosTarde: 0,
      actividadesActivasConPendientes: 0
    };

    console.log(`✅ Estadísticas calculadas:`, stats);

    res.json({
      ...stats,
      metadata: {
        grupoId: parseInt(idGrupo),
        timestamp: new Date().toISOString(),
        sistemaEstados: 'optimizado_triggers_v2',
        porcentajeCompletado: stats.totalActividades > 0 ?
          Math.round((stats.actividadesCompletas / stats.totalActividades) * 100) : 0,
        requiereAtencion: stats.actividadesVencidas > 0 || stats.totalPendientes > 10,
        
        distribucionEstados: {
          pendientes: stats.totalPendientes,
          entregados: stats.totalEntregados,
          noEntregados: stats.totalNoEntregados,
          entregadosTarde: stats.totalEntregadosTarde
        }
      }
    });

  } catch (error) {
    console.error('❌ Error al obtener estadísticas del grupo:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const obtenerCalificacionesIntegrantesEquipo = async (req, res) => {
  const { idActividadEquipo } = req.params;

  try {
    const pool = await sql.connect(config);
    
    console.log(`📊 Obteniendo calificaciones individuales para equipo ID: ${idActividadEquipo}`);

    const result = await pool.request()
      .input('idActividadEquipo', sql.Int, idActividadEquipo)
      .execute('sp_ObtenerCalificacionesIntegrantesEquipo');

    const integrantesData = result.recordsets[0];
    const calificacionesDetalladas = result.recordsets[1];

    const valorTotal = 10;

    const integrantes = integrantesData.map(integrante => {
      const calificacionesPorCriterio = calificacionesDetalladas
        .filter(cal => cal.vchMatricula === integrante.vchMatricula)
        .map(cal => ({
          id_criterio: cal.id_criterio,
          nombre_criterio: cal.nombre_criterio,
          calificacion: cal.calificacion,
          valor_maximo: cal.valor_maximo
        }));

      return {
        ...integrante,
        calificacionesPorCriterio,
        porcentajeIndividual: integrante.calificacionTotalIndividual ? 
          Math.round((integrante.calificacionTotalIndividual / valorTotal) * 100) : 0
      };
    });

    const integrantesConCalificacion = integrantes.filter(i => i.tieneCalificacionIndividual);
    const estadisticasEquipo = {
      totalIntegrantes: integrantes.length,
      integrantesCalificados: integrantesConCalificacion.length,
      integrantesSinCalificar: integrantes.length - integrantesConCalificacion.length,
      promedioEquipo: integrantesConCalificacion.length > 0 ? 
        parseFloat((integrantesConCalificacion.reduce((sum, i) => sum + (i.calificacionTotalIndividual || 0), 0) / integrantesConCalificacion.length).toFixed(2)) : 0,
      calificacionMaxima: integrantesConCalificacion.length > 0 ? 
        Math.max(...integrantesConCalificacion.map(i => i.calificacionTotalIndividual || 0)) : 0,
      calificacionMinima: integrantesConCalificacion.length > 0 ? 
        Math.min(...integrantesConCalificacion.map(i => i.calificacionTotalIndividual || 0)) : 0
    };

    console.log(`✅ Obtenidas calificaciones de ${integrantes.length} integrantes`);
    console.log(`📊 Promedio del equipo: ${estadisticasEquipo.promedioEquipo}`);

    res.json({
      equipo: {
        id_equipo: integrantesData[0]?.id_equipo,
        nombre_equipo: integrantesData[0]?.nombre_equipo,
        observacion_equipo: integrantesData[0]?.observacion_equipo
      },
      integrantes,
      estadisticasEquipo,
      metadata: {
        totalIntegrantes: integrantes.length,
        tieneCalificacionesIndividuales: integrantes.some(i => i.tieneCalificacionIndividual),
        tieneCalificacionesVariadas: estadisticasEquipo.calificacionMaxima !== estadisticasEquipo.calificacionMinima,
        valorTotalInstrumento: valorTotal
      }
    });

  } catch (error) {
    console.error('❌ Error al obtener calificaciones de integrantes:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const obtenerComparativaEquipoIndividual = async (req, res) => {
  const { idActividadEquipo } = req.params;

  try {
    const pool = await sql.connect(config);
    
    console.log(`📊 Generando comparativa equipo vs individual para ID: ${idActividadEquipo}`);

    const result = await pool.request()
      .input('idActividadEquipo', sql.Int, idActividadEquipo)
      .execute('sp_ObtenerComparativaEquipoIndividual');

    const calificacionEquipo = result.recordset[0] || {
      nombre_equipo: 'Equipo',
      calificacionTotalEquipo: 0,
      criteriosCalificados: 0
    };

    res.json({
      calificacionEquipo,
      mensaje: 'Comparativa disponible'
    });

  } catch (error) {
    console.error('❌ Error al generar comparativa:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const obtenerEstadisticasCentroControl = async (req, res) => {
  const { claveDocente, claveMateria } = req.params;

  try {
    const pool = await sql.connect(config);
    
    console.log(`📊 Obteniendo estadísticas REALES: Docente=${claveDocente}, Materia=${claveMateria}`);

    const result = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .execute('sp_ObtenerEstadisticasCentroControl');

    const estadisticas = result.recordset[0] || {
      total_grupos: 0,
      total_alumnos: 0,
      total_por_calificar: 0,
      actividades_urgentes: 0,
      total_actividades: 0,
      proximas_a_vencer: 0,
      actividades_criticas: 0
    };

    console.log(`✅ Estadísticas REALES calculadas:`);
    console.log(`   📊 Grupos: ${estadisticas.total_grupos}`);
    console.log(`   📝 Por calificar: ${estadisticas.total_por_calificar}`);
    console.log(`   🚨 Urgentes: ${estadisticas.actividades_urgentes}`);
    console.log(`   🔥 Críticas: ${estadisticas.actividades_criticas}`);

    res.json({
      estadisticas,
      timestamp: new Date().toISOString(),
      resumen: {
        grupos: estadisticas.total_grupos,
        porCalificar: estadisticas.total_por_calificar,
        urgentes: estadisticas.actividades_urgentes,
        criticas: estadisticas.actividades_criticas,
        proximasVencer: estadisticas.proximas_a_vencer
      }
    });

  } catch (error) {
    console.error('❌ Error al obtener estadísticas REALES del centro de control:', error);
    res.status(500).json({ 
      error: 'Error del servidor',
      mensaje: 'No se pudieron obtener las estadísticas reales',
      detalle: error.message 
    });
  }
};

const guardarComponentesMasivo = async (req, res) => {
  const { 
    claveMateria, 
    parcial, 
    periodo, 
    claveDocente, 
    operaciones
  } = req.body;

  let pool;
  let transaction;

  try {
    pool = await sql.connect(config);
    
    let periodoReal = periodo;
    if (!periodo || periodo === 'auto' || periodo === 'null' || periodo === 'undefined') {
      console.log('🔄 Resolviendo periodo automático...');
      const periodoResult = await pool.request().execute('sp_ObtenerPeriodoActual');
      
      if (periodoResult.recordset.length === 0) {
        return res.status(400).json({ error: 'No se pudo obtener el periodo actual' });
      }
      
      periodoReal = periodoResult.recordset[0].Periodo.toString();
      console.log(`✅ Periodo resuelto: ${periodoReal}`);
    }
    
    transaction = new sql.Transaction(pool);
    await transaction.begin();

    console.log(`🔄 Iniciando guardado masivo: ${operaciones.length} operaciones`);
    console.log(`📅 Usando periodo: ${periodoReal}`);

    const operacionesCrear = operaciones.filter(op => op.tipo === 'crear');
    const operacionesModificar = operaciones.filter(op => op.tipo === 'modificar');
    const operacionesEliminar = operaciones.filter(op => op.tipo === 'eliminar');

    let sumaFinal = 0;

    const componentesActualesResult = await transaction.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parcial)
      .input('vchPeriodo', sql.VarChar, periodoReal)
      .input('claveDocente', sql.VarChar, claveDocente)
      .execute('sp_ObtenerComponentesMateria');

    const componentesActuales = componentesActualesResult.recordset || [];
    
    componentesActuales.forEach(comp => {
      const seElimina = operacionesEliminar.some(op => op.id === comp.id_valor_componente);
      const seModifica = operacionesModificar.some(op => op.id === comp.id_valor_componente);
      
      if (!seElimina && !seModifica) {
        sumaFinal += parseFloat(comp.valor_componente || 0);
      }
    });

    operacionesCrear.forEach(op => {
      sumaFinal += parseFloat(op.valorComponente || 0);
    });

    operacionesModificar.forEach(op => {
      sumaFinal += parseFloat(op.valorComponente || 0);
    });

    console.log(`📊 Suma final calculada: ${sumaFinal}`);

    if (Math.abs(sumaFinal - 10) > 0.01) {
      await transaction.rollback();
      return res.status(400).json({
        error: `La suma final debe ser exactamente 10 puntos`,
        detalles: {
          sumaCalculada: sumaFinal,
          diferencia: sumaFinal - 10,
          operacionesRecibidas: operaciones.length
        },
        sugerencia: `Ajusta los valores para que sumen exactamente 10 puntos`
      });
    }

    let componentesCreados = 0;
    let componentesModificados = 0;
    let componentesEliminados = 0;
    const errores = [];

    for (const operacion of operacionesEliminar) {
      try {
        console.log(`🗑️ Eliminando componente ID: ${operacion.id}`);
        
        const vinculaciones = await transaction.request()
  .input('idComponente', sql.Int, operacion.id)
  .execute('sp_ContarActividadesComponente_movil');

        if (vinculaciones.recordset[0]?.cantidad > 0) {
          errores.push({
            operacion: 'eliminar',
            id: operacion.id,
            error: 'Tiene actividades vinculadas'
          });
          continue;
        }

        await transaction.request()
          .input('idComponente', sql.Int, operacion.id)
          .execute('sp_EliminarComponenteEvaluacion');

        componentesEliminados++;
        console.log(`✅ Componente ${operacion.id} eliminado`);

      } catch (error) {
        console.error(`❌ Error al eliminar componente ${operacion.id}:`, error);
        errores.push({
          operacion: 'eliminar',
          id: operacion.id,
          error: error.message
        });
      }
    }

    for (const operacion of operacionesCrear) {
      try {
        console.log(`🆕 Creando componente: ${operacion.nombreComponente}`);

        await transaction.request()
          .input('claveMateria', sql.VarChar, claveMateria)
          .input('parcial', sql.Int, parcial)
          .input('vchPeriodo', sql.VarChar, periodoReal)
          .input('claveDocente', sql.VarChar, claveDocente)
          .input('nombreComponente', sql.VarChar, operacion.nombreComponente)
          .input('valorComponente', sql.Decimal(5,2), operacion.valorComponente)
          .execute('sp_InsertarComponenteEvaluacion');

        componentesCreados++;
        console.log(`✅ Componente "${operacion.nombreComponente}" creado`);

      } catch (error) {
        console.error(`❌ Error al crear componente "${operacion.nombreComponente}":`, error);
        errores.push({
          operacion: 'crear',
          nombre: operacion.nombreComponente,
          error: error.message
        });
      }
    }

    for (const operacion of operacionesModificar) {
      try {
        console.log(`✏️ Modificando componente ID: ${operacion.id}`);

        await transaction.request()
          .input('idComponente', sql.Int, operacion.id)
          .input('nombreComponente', sql.VarChar, operacion.nombreComponente)
          .input('valorComponente', sql.Decimal(5,2), operacion.valorComponente)
          .execute('sp_ActualizarComponente');

        componentesModificados++;
        console.log(`✅ Componente ${operacion.id} modificado`);

      } catch (error) {
        console.error(`❌ Error al modificar componente ${operacion.id}:`, error);
        errores.push({
          operacion: 'modificar',
          id: operacion.id,
          error: error.message
        });
      }
    }

    const erroresTotales = errores.length;
    const operacionesTotales = operaciones.length;
    const operacionesExitosas = componentesCreados + componentesModificados + componentesEliminados;

    if (erroresTotales > 0 && operacionesExitosas === 0) {
      await transaction.rollback();
      return res.status(500).json({
        error: 'Todas las operaciones fallaron',
        errores,
        estadisticas: {
          operacionesIntentadas: operacionesTotales,
          operacionesExitosas: 0,
          errores: erroresTotales
        }
      });
    }

    await transaction.commit();

    const estadoFinalResult = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parcial)
      .input('vchPeriodo', sql.VarChar, periodoReal)
      .input('claveDocente', sql.VarChar, claveDocente)
      .execute('sp_sumaComponentes');

    const sumaFinalReal = parseFloat(estadoFinalResult.recordset[0]?.suma_actual || estadoFinalResult.recordset[0]?.suma || 0);

    const respuesta = {
      mensaje: erroresTotales === 0 ? 
        'Todos los componentes fueron guardados exitosamente' :
        `${operacionesExitosas} operaciones exitosas, ${erroresTotales} con errores`,
      
      estadisticas: {
        operacionesIntentadas: operacionesTotales,
        operacionesExitosas,
        errores: erroresTotales,
        componentesCreados,
        componentesModificados,
        componentesEliminados
      },

      estadoFinal: {
        sumaTotal: sumaFinalReal,
        disponible: 10 - sumaFinalReal,
        esCompleto: Math.abs(sumaFinalReal - 10) < 0.01,
        esValido: sumaFinalReal <= 10
      },

      periodoUsado: periodoReal,
      debug: {
        periodoOriginal: periodo,
        periodoResuelto: periodoReal
      },

      ...(erroresTotales > 0 && { errores }),

      ...(erroresTotales === 0 && Math.abs(sumaFinalReal - 10) < 0.01 && {
        felicitacion: {
          mensaje: '🎉 ¡Perfecto! Parcial configurado con exactamente 10 puntos',
          tipo: 'exito_completo'
        }
      })
    };

    console.log(`✅ Guardado masivo completado:`);
    console.log(`   📊 Creados: ${componentesCreados}`);
    console.log(`   ✏️ Modificados: ${componentesModificados}`);
    console.log(`   🗑️ Eliminados: ${componentesEliminados}`);
    console.log(`   ❌ Errores: ${erroresTotales}`);
    console.log(`   🎯 Suma final: ${sumaFinalReal} pts`);
    console.log(`   📅 Periodo usado: ${periodoReal}`);

    res.json(respuesta);

  } catch (error) {
    console.error('❌ Error crítico en guardado masivo:', error);
    
    if (transaction) {
      try {
        await transaction.rollback();
        console.log('🔄 Rollback ejecutado correctamente');
      } catch (rollbackError) {
        console.error('❌ Error en rollback:', rollbackError);
      }
    }
    
    res.status(500).json({
      error: 'Error crítico durante el guardado masivo',
      detalle: error.message,
      momento: 'Durante la transacción principal'
    });
  }
};

const validarOperacionesMasivas = async (req, res) => {
  const { 
    claveMateria, 
    parcial, 
    periodo, 
    claveDocente, 
    operaciones 
  } = req.body;

  let pool;

  try {
    pool = await sql.connect(config);

    const componentesActualesResult = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parcial)
      .input('vchPeriodo', sql.VarChar, periodo)
      .input('claveDocente', sql.VarChar, claveDocente)
      .execute('sp_ObtenerComponentesMateria');

    const componentesActuales = componentesActualesResult.recordset || [];

    const operacionesCrear = operaciones.filter(op => op.tipo === 'crear');
    const operacionesModificar = operaciones.filter(op => op.tipo === 'modificar');
    const operacionesEliminar = operaciones.filter(op => op.tipo === 'eliminar');

    let sumaSimulada = 0;
    const advertencias = [];
    const erroresPotenciales = [];

    componentesActuales.forEach(comp => {
      const seElimina = operacionesEliminar.some(op => op.id === comp.id_valor_componente);
      const seModifica = operacionesModificar.find(op => op.id === comp.id_valor_componente);
      
      if (seElimina) {
      } else if (seModifica) {
        sumaSimulada += parseFloat(seModifica.valorComponente || 0);
      } else {
        sumaSimulada += parseFloat(comp.valor_componente || 0);
      }
    });

    operacionesCrear.forEach(op => {
      sumaSimulada += parseFloat(op.valorComponente || 0);
    });

    for (const operacion of operacionesEliminar) {
      try {
        const vinculaciones = await pool.request()
          .input('idComponente', sql.Int, operacion.id)
          .execute('sp_VerificarActividadesConComponentes');

        if (vinculaciones.recordset[0]?.cantidad > 0) {
          erroresPotenciales.push({
            tipo: 'eliminar_con_actividades',
            id: operacion.id,
            actividades: vinculaciones.recordset[0].cantidad,
            mensaje: `El componente ID ${operacion.id} tiene ${vinculaciones.recordset[0].cantidad} actividades vinculadas`
          });
        }
      } catch (error) {
        console.error(`❌ Error validando componente ${operacion.id}:`, error);
        erroresPotenciales.push({
          tipo: 'error_validacion',
          id: operacion.id,
          mensaje: `Error al validar componente: ${error.message}`
        });
      }
    }

    const todosLosNombres = [
      ...operacionesCrear.map(op => op.nombreComponente),
      ...operacionesModificar.map(op => op.nombreComponente),
      ...componentesActuales
        .filter(comp => 
          !operacionesEliminar.some(op => op.id === comp.id_valor_componente) &&
          !operacionesModificar.some(op => op.id === comp.id_valor_componente)
        )
        .map(comp => comp.nombre_componente)
    ];

    const nombresDuplicados = todosLosNombres.filter((nombre, index) => 
      todosLosNombres.indexOf(nombre) !== index
    );

    if (nombresDuplicados.length > 0) {
      advertencias.push({
        tipo: 'nombres_duplicados',
        nombres: [...new Set(nombresDuplicados)],
        mensaje: 'Se detectaron nombres de componentes duplicados'
      });
    }

    const validacion = {
      esValida: erroresPotenciales.length === 0,
      sumaFinal: parseFloat(sumaSimulada.toFixed(2)),
      sumaPerfecta: Math.abs(sumaSimulada - 10) < 0.01,
      diferencia: sumaSimulada - 10,
      
      operaciones: {
        crear: operacionesCrear.length,
        modificar: operacionesModificar.length,
        eliminar: operacionesEliminar.length,
        total: operaciones.length
      },

      erroresPotenciales,
      advertencias,

      recomendacion: 
        Math.abs(sumaSimulada - 10) > 0.01 ? 
          `Ajusta los valores para sumar exactamente 10 puntos (actualmente: ${sumaSimulada})` :
        erroresPotenciales.length > 0 ?
          'Corrige los errores antes de guardar' :
          '✅ Listo para guardar'
    };

    res.json(validacion);

  } catch (error) {
    console.error('❌ Error al validar operaciones:', error);
    res.status(500).json({
      error: 'Error al validar operaciones',
      detalle: error.message
    });
  }
};

module.exports = {
  obtenerDatosDocente,
  obtenerPerfilDocente,
  cambiarContrasenaDocente,
  
  obtenerMateriasPorDocente,
  obtenerMateriasCompletas,
  obtenerPeriodoActual,
  obtenerPeriodosDocente,
  obtenerMateriasCompletasPorPeriodo,
  
  obtenerComponentesPorMateria,
  crearComponente,
  modificarComponente,
  eliminarComponente,
  validarSumaComponentes,
  obtenerComponentesParaDropdown,
  validarComplecionParcial,
  obtenerEstadisticasGeneralesDocente,
  clonarComponentesParcial,
   guardarComponentesMasivo,
  validarOperacionesMasivas,
  
  obtenerGruposPorMateriaDocente,
  obtenerListasCotejo,
  obtenerActividadesPorGrupo,
  obtenerEstadisticasGrupo,
  
  crearActividad,
  crearActividadCompletaConComponente,
  
  obtenerEquiposPorGrupo,
  obtenerAlumnosPorGrupo,
  simularEquiposAleatorios,
  obtenerActividadesConEquiposPorGrupo,

  obtenerDatosActividad,
  obtenerCriteriosActividad,
  obtenerAlumnosParaCalificar,
  obtenerEquiposParaCalificar,
  obtenerCalificacionesAlumno,
  obtenerCalificacionesEquipo,
  guardarCalificacionesAlumno,
  guardarCalificacionesEquipo,
  validarParcial, 

  guardarObservacionAlumno,
  guardarObservacionEquipo,
  obtenerObservacionAlumno,
  obtenerObservacionEquipo,
  obtenerComparativaEquipoIndividual,
  obtenerCalificacionesIntegrantesEquipo,

  obtenerConcentradoFinal,
  obtenerCalificacionesActividad,
  obtenerEstadisticasCentroControl
};