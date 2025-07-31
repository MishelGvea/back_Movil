const { sql, config } = require('../db/sqlConfig');



// ===============================================
// FUNCIONES EXISTENTES (SIN MODIFICAR)
// ===============================================
// Obtener datos del docente
const obtenerDatosDocente = async (req, res) => {
  const { clave } = req.params;

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('clave', sql.VarChar, clave)
      .execute('sp_ObtenerDatosDocente'); // ← Ejecutar el procedimiento

    if (result.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Docente no encontrado' });
    }

    res.json({ nombre: result.recordset[0].nombre });
  } catch (err) {
    console.error('❌ Error al obtener datos del docente:', err);
    res.status(500).json({ mensaje: 'Error en el servidor' });
  }
};

// Obtener perfil completo del docente con materias
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

// Obtener materias asignadas al docente (sin filtro de periodo)
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

// 🆕 FUNCIÓN PRINCIPAL: Obtener materias completas del PERIODO ACTUAL
const obtenerMateriasCompletas = async (req, res) => {
  const { clave } = req.params;

  try {
    const pool = await sql.connect(config);
    
    // Obtener el periodo más reciente (actual) desde la base de datos
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
    
    // Agregar información del periodo para debugging
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

// 🆕 FUNCIÓN AUXILIAR: Obtener información del periodo actual
const obtenerPeriodoActualInterno = async () => {
  try {
    const pool = await sql.connect(config);
    
    // Obtener el periodo más reciente usando tu SP existente
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

/**
 * Validar y obtener periodo correcto (con fallback)
 * @param {string} periodoRecibido - Periodo recibido del frontend
 * @returns {Promise<string>} Periodo validado
 */
const validarPeriodo = async (periodoRecibido) => {
  // Si se envía 'auto' o no se envía periodo, obtener de BD
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

  // Si se envía un periodo específico, validarlo
  if (periodoRecibido && periodoRecibido.length === 5) {
    const año = parseInt(periodoRecibido.substring(0, 4));
    const cuatrimestre = parseInt(periodoRecibido.substring(4));
    const añoActual = new Date().getFullYear();
    
    // Validar rango razonable
    if (año >= 2020 && año <= añoActual + 2 && [1, 2, 3].includes(cuatrimestre)) {
      console.log(`✅ Usando periodo específico validado: ${periodoRecibido}`);
      return periodoRecibido;
    }
  }

  // Fallback: obtener de BD
  console.log(`⚠️ Periodo inválido: ${periodoRecibido}, obteniendo de BD...`);
  const periodoBD = await obtenerPeriodoActualInterno();
  return periodoBD || '20252'; // Último fallback
};

/**
 * Endpoint para obtener información completa del periodo actual
 * Tu función original mejorada
 */
const obtenerPeriodoActual = async (req, res) => {
  try {
    const pool = await sql.connect(config);
    
    // Obtener el periodo más reciente
    const periodoResult = await pool.request().query(`EXEC sp_ObtenerPeriodoActual;`);
    
    if (periodoResult.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'No se encontraron periodos' });
    }

    const periodoActual = periodoResult.recordset[0].Periodo.toString();
    
    // Extraer año y cuatrimestre del periodo
    const año = periodoActual.substring(0, 4);
    const cuatrimestreNumero = periodoActual.substring(4, 5);
    
    // Obtener información del cuatrimestre desde tbl_periodos
    const cuatrimestreInfo = await pool.request()
      .input('idPeriodo', sql.Int, parseInt(cuatrimestreNumero))
      .query(`EXEC sp_CuatrimestreInfo`);

    const infoCompleta = {
      periodoActual,
      año,
      cuatrimestreNumero,
      descripcion: `Año ${año}, Cuatrimestre ${cuatrimestreNumero}`,
      // 🆕 Información adicional útil
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

// Obtener grupos que atiende el docente en una materia
// En tu docenteController.js, modifica obtenerGruposPorMateriaDocente:

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
// ===============================================
// 🆕 FUNCIONES CRUD PARA GESTIÓN DE COMPONENTES
// ===============================================

// Obtener todos los componentes de un docente/materia/parcial/periodo
const obtenerComponentesPorMateria = async (req, res) => {
  const { claveMateria, parcial, periodo: periodoRecibido, claveDocente } = req.params;

  try {
    // 🆕 USAR TU LÓGICA DE PERIODO CON BD
    const periodo = await validarPeriodo(periodoRecibido);
    
    if (!periodo) {
      return res.status(500).json({ 
        error: 'No se pudo determinar el periodo actual' 
      });
    }
    
    const pool = await sql.connect(config);
    
    console.log(`🔍 Buscando componentes: Materia=${claveMateria}, Parcial=${parcial}, Periodo=${periodo}, Docente=${claveDocente}`);

    const result = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parseInt(parcial))
      .input('vchPeriodo', sql.VarChar, periodo) // 🆕 Usar periodo de BD
      .input('claveDocente', sql.VarChar, claveDocente)
      .execute(`sp_ObtenerComponentesMateria`);

    // Calcular suma total de valores
    const sumaTotal = result.recordset.reduce((suma, comp) => suma + (comp.valor_componente || 0), 0);

    console.log(`✅ Componentes encontrados: ${result.recordset.length}, Suma total: ${sumaTotal}% (Periodo BD: ${periodo})`);
    
    res.json({
      componentes: result.recordset,
      sumaTotal: parseFloat(sumaTotal.toFixed(2)),
      disponible: parseFloat((100 - sumaTotal).toFixed(2)),
      validacion: {
        esValido: sumaTotal <= 100,
        esCompleto: sumaTotal === 100,
        exceso: sumaTotal > 100 ? parseFloat((sumaTotal - 100).toFixed(2)) : 0,
        faltante: sumaTotal < 100 ? parseFloat((100 - sumaTotal).toFixed(2)) : 0
      },
      estadisticas: {
        totalComponentes: result.recordset.length,
        mayorComponente: result.recordset.length > 0 ? Math.max(...result.recordset.map(c => c.valor_componente)) : 0,
        menorComponente: result.recordset.length > 0 ? Math.min(...result.recordset.map(c => c.valor_componente)) : 0,
        promedioComponente: result.recordset.length > 0 ? parseFloat((sumaTotal / result.recordset.length).toFixed(2)) : 0
      },
      // 🆕 INFORMACIÓN DEL PERIODO USADO (de BD)
      periodoInfo: {
        periodoUsado: periodo,
        esAutomatico: periodoRecibido === 'auto' || !periodoRecibido,
        origen: 'baseDatos'
      }
    });

  } catch (error) {
    console.error('❌ Error al obtener componentes:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const crearComponente = async (req, res) => {
  const { 
    claveMateria, 
    parcial, 
    periodo: periodoRecibido, 
    claveDocente,
    nombreComponente,
    valorComponente 
  } = req.body;

  try {
    // 🆕 USAR TU LÓGICA DE PERIODO CON BD
    const periodo = await validarPeriodo(periodoRecibido);
    
    if (!periodo) {
      return res.status(500).json({ 
        error: 'No se pudo determinar el periodo actual' 
      });
    }
    
    const pool = await sql.connect(config);
    
    console.log(`🆕 Creando componente: ${nombreComponente} - ${valorComponente}% (Periodo BD: ${periodo})`);

    // 1. 🛡️ VALIDACIONES BÁSICAS (igual que antes)
    if (!nombreComponente || !nombreComponente.trim()) {
      return res.status(400).json({ 
        error: 'El nombre del componente es obligatorio' 
      });
    }

    if (!valorComponente || isNaN(valorComponente)) {
      return res.status(400).json({ 
        error: 'El valor del componente debe ser un número válido' 
      });
    }

    const valor = parseFloat(valorComponente);
    if (valor <= 0 || valor > 100) {
      return res.status(400).json({ 
        error: 'El valor del componente debe estar entre 0.1 y 100' 
      });
    }

    // 2. 🔍 VERIFICAR SUMA ACTUAL DE COMPONENTES EXISTENTES (con periodo de BD)
    const sumaActualResult = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parseInt(parcial))
      .input('vchPeriodo', sql.VarChar, periodo) // 🆕 Usar periodo de BD
      .input('claveDocente', sql.VarChar, claveDocente)
      .execute(`sp_sumaComponentes`);

    const sumaActual = sumaActualResult.recordset[0].sumaActual;
    const totalComponentes = sumaActualResult.recordset[0].totalComponentes;
    const nuevaSuma = parseFloat((sumaActual + valor).toFixed(2));

    // 3. 🚨 VALIDACIONES AVANZADAS DE NEGOCIO (igual que antes)
    if (nuevaSuma > 100) {
      return res.status(400).json({ 
        error: `❌ La suma no puede exceder 100%`,
        detalles: {
          sumaActual: parseFloat(sumaActual.toFixed(2)),
          valorIntentando: valor,
          sumaPropuesta: nuevaSuma,
          exceso: parseFloat((nuevaSuma - 100).toFixed(2)),
          disponible: parseFloat((100 - sumaActual).toFixed(2)),
          sugerencia: `El valor máximo permitido es ${(100 - sumaActual).toFixed(2)}%`
        }
      });
    }

    if (totalComponentes > 0 && valor < 5) {
      return res.status(400).json({ 
        error: '⚠️ Valor muy pequeño',
        detalles: {
          valorMinimo: 5,
          valorIntentando: valor,
          razon: 'Para mantener un balance adecuado, cada componente debe valer al menos 5%'
        }
      });
    }

    if (totalComponentes >= 8) {
      return res.status(400).json({ 
        error: '📊 Límite de componentes alcanzado',
        detalles: {
          limiteMaximo: 8,
          componentesActuales: totalComponentes,
          sugerencia: 'Considera combinar o eliminar componentes existentes'
        }
      });
    }

    // 4. 🔒 VERIFICAR NOMBRE ÚNICO
    const existeResult = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parseInt(parcial))
      .input('vchPeriodo', sql.VarChar, periodo) // 🆕 Usar periodo de BD
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('nombreComponente', sql.NVarChar, nombreComponente.trim())
      .execute(`sp_existeResult`);

    if (existeResult.recordset[0].existe > 0) {
      return res.status(400).json({ 
        error: `🔄 Componente duplicado`,
        detalles: {
          nombreExistente: existeResult.recordset[0].nombreExistente,
          nombreIntentando: nombreComponente.trim(),
          sugerencia: 'Usa un nombre diferente o modifica el componente existente'
        }
      });
    }

    // 5. 💾 INSERTAR EL NUEVO COMPONENTE
    await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parseInt(parcial))
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('vchPeriodo', sql.VarChar, periodo) // 🆕 Usar periodo de BD
      .input('nombreComponente', sql.NVarChar, nombreComponente.trim())
      .input('valorComponente', sql.Decimal(4,2), valor)
      .execute(`sp_InsertarComponenteEvaluacion`);

    console.log(`✅ Componente creado: ${nombreComponente} - ${valor}% (Periodo BD: ${periodo})`);

    // 6. 🎯 RESPUESTA DETALLADA CON RECOMENDACIONES
    const respuesta = {
      mensaje: '✅ Componente creado correctamente',
      componente: {
        nombre: nombreComponente.trim(),
        valor: valor
      },
      estadisticas: {
        sumaAnterior: parseFloat(sumaActual.toFixed(2)),
        sumaNueva: nuevaSuma,
        disponible: parseFloat((100 - nuevaSuma).toFixed(2)),
        componentesTotales: totalComponentes + 1,
        progreso: parseFloat(((nuevaSuma / 100) * 100).toFixed(1))
      },
      // 🆕 INFO DEL PERIODO (de BD)
      periodoInfo: {
        periodoUsado: periodo,
        esAutomatico: periodoRecibido === 'auto' || !periodoRecibido,
        origen: 'baseDatos'
      }
    };

    // 🔮 RECOMENDACIONES INTELIGENTES (igual que antes)
    if (nuevaSuma < 100) {
      const faltante = 100 - nuevaSuma;
      respuesta.recomendacion = {
        tipo: 'completar',
        mensaje: `Te faltan ${faltante.toFixed(2)}% para completar el 100%`,
        sugerencias: [
          faltante > 20 ? 'Considera agregar un componente de "Examen" o "Proyecto"' : null,
          faltante <= 20 && faltante > 10 ? 'Puedes agregar "Participación" o "Tareas"' : null,
          faltante <= 10 ? 'Un componente pequeño como "Asistencia" completaría el 100%' : null
        ].filter(Boolean)
      };
    } else if (nuevaSuma === 100) {
      respuesta.felicitacion = {
        mensaje: '🎉 ¡Perfecto! Has completado el 100% de la ponderación',
        estado: 'completo'
      };
    }

    res.status(201).json(respuesta);

  } catch (error) {
    console.error('❌ Error al crear componente:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

// 🆕 NUEVA FUNCIÓN PARA VALIDAR PARCIAL CON TU LÓGICA
const validarParcial = async (req, res) => {
  const { claveMateria, parcial, periodo: periodoRecibido, claveDocente } = req.params;

  try {
    // 🆕 USAR TU LÓGICA DE PERIODO CON BD
    const periodo = await validarPeriodo(periodoRecibido);
    
    if (!periodo) {
      return res.status(500).json({ 
        error: 'No se pudo determinar el periodo actual' 
      });
    }
    
    const pool = await sql.connect(config);
    
    // Aquí puedes implementar lógica de recomendaciones específicas
    const recomendaciones = [];
    
    console.log(`🔍 Validando parcial: Materia=${claveMateria}, Parcial=${parcial}, Periodo=${periodo}`);
    
    res.json({
      recomendaciones,
      periodoInfo: {
        periodoUsado: periodo,
        esAutomatico: periodoRecibido === 'auto' || !periodoRecibido,
        origen: 'baseDatos'
      }
    });

  } catch (error) {
    console.error('❌ Error al validar parcial:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};
// Modificar un componente existente
const modificarComponente = async (req, res) => {
  const { idComponente } = req.params;
  const { nombreComponente, valorComponente } = req.body;

  try {
    const pool = await sql.connect(config);
    
    console.log(`🔄 Modificando componente ID: ${idComponente}`);

    // 1. 🛡️ VALIDACIONES BÁSICAS
    if (!nombreComponente || !nombreComponente.trim()) {
      return res.status(400).json({ 
        error: 'El nombre del componente es obligatorio' 
      });
    }

    const valor = parseFloat(valorComponente);
    if (isNaN(valor) || valor <= 0 || valor > 100) {
      return res.status(400).json({ 
        error: 'El valor del componente debe estar entre 0.1 y 100' 
      });
    }

    // 2. 🔍 OBTENER DATOS ACTUALES DEL COMPONENTE
    const componenteActualResult = await pool.request()
      .input('idComponente', sql.Int, parseInt(idComponente))
      .execute(`sp_componenteActualResult`);

    if (componenteActualResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Componente no encontrado' });
    }

    const componenteActual = componenteActualResult.recordset[0];

    // 3. 🚨 VERIFICAR SI EL COMPONENTE ESTÁ SIENDO USADO EN ACTIVIDADES
    const actividadesResult = await pool.request()
      .input('idComponente', sql.Int, parseInt(idComponente))
      .execute(`sp_actividadesResult`);

    const { totalActividades, titulosActividades } = actividadesResult.recordset[0];

    // 3.1 Si hay actividades, restringir cambios drásticos
    if (totalActividades > 0) {
      const cambioValor = Math.abs(valor - componenteActual.valor_componente);
      
      if (cambioValor > 15) {
        return res.status(400).json({ 
          error: '🔒 Cambio de valor muy drástico',
          detalles: {
            valorActual: componenteActual.valor_componente,
            valorPropuesto: valor,
            cambio: parseFloat(cambioValor.toFixed(2)),
            limitePermitido: 15,
            actividadesAfectadas: totalActividades,
            razon: 'Este componente tiene actividades asignadas. Los cambios grandes pueden afectar las calificaciones.'
          },
          sugerencia: `Considera hacer un cambio menor (máximo ±15%) o crear un nuevo componente`
        });
      }

      // Advertencia sobre actividades afectadas
      console.log(`⚠️ Modificando componente con ${totalActividades} actividades: ${titulosActividades}`);
    }

    // 4. 📊 VERIFICAR SUMA TOTAL EXCLUYENDO EL COMPONENTE ACTUAL
    const sumaOtrosResult = await pool.request()
      .input('claveMateria', sql.VarChar, componenteActual.vchClvMateria)
      .input('parcial', sql.Int, componenteActual.parcial)
      .input('vchPeriodo', sql.VarChar, componenteActual.vchPeriodo)
      .input('claveDocente', sql.VarChar, componenteActual.vchClvTrabajador)
      .input('idComponente', sql.Int, parseInt(idComponente))
      .execute(`sp_sumaOtrosResult`);

    const sumaOtros = sumaOtrosResult.recordset[0].sumaOtros;
    const nuevaSuma = parseFloat((sumaOtros + valor).toFixed(2));

    // 5. 🚨 VALIDAR QUE NO EXCEDA 100%
    if (nuevaSuma > 100) {
      return res.status(400).json({ 
        error: `❌ La suma no puede exceder 100%`,
        detalles: {
          otrosComponentes: parseFloat(sumaOtros.toFixed(2)),
          valorPropuesto: valor,
          sumaPropuesta: nuevaSuma,
          exceso: parseFloat((nuevaSuma - 100).toFixed(2)),
          disponible: parseFloat((100 - sumaOtros).toFixed(2)),
          valorMaximo: parseFloat((100 - sumaOtros).toFixed(2))
        }
      });
    }

    // 6. 🔒 VERIFICAR NOMBRE ÚNICO (excluyendo el actual)
    if (nombreComponente.trim().toUpperCase() !== componenteActual.componente.trim().toUpperCase()) {
      const existeResult = await pool.request()
        .input('claveMateria', sql.VarChar, componenteActual.vchClvMateria)
        .input('parcial', sql.Int, componenteActual.parcial)
        .input('vchPeriodo', sql.VarChar, componenteActual.vchPeriodo)
        .input('claveDocente', sql.VarChar, componenteActual.vchClvTrabajador)
        .input('nombreComponente', sql.NVarChar, nombreComponente.trim())
        .input('idComponente', sql.Int, parseInt(idComponente))
        .execute(`sp_verificarNombre`);

      if (existeResult.recordset[0].existe > 0) {
        return res.status(400).json({ 
          error: `🔄 Ya existe otro componente con ese nombre en este parcial` 
        });
      }
    }

    // 7. 💾 ACTUALIZAR EL COMPONENTE
    await pool.request()
      .input('idComponente', sql.Int, parseInt(idComponente))
      .input('nombreComponente', sql.NVarChar, nombreComponente.trim())
      .input('valorComponente', sql.Decimal(4,2), valor)
      .execute(`sp_ActualizarComponente`);

    console.log(`✅ Componente modificado: ${nombreComponente} - ${valor}%`);
    
    // 8. 🎯 RESPUESTA DETALLADA
    const respuesta = {
      mensaje: totalActividades > 0 ? 
        `✅ Componente modificado (${totalActividades} actividades afectadas)` : 
        '✅ Componente modificado correctamente',
      cambios: {
        nombre: {
          anterior: componenteActual.componente,
          nuevo: nombreComponente.trim(),
          cambio: componenteActual.componente !== nombreComponente.trim()
        },
        valor: {
          anterior: componenteActual.valor_componente,
          nuevo: valor,
          diferencia: parseFloat((valor - componenteActual.valor_componente).toFixed(2))
        }
      },
      estadisticas: {
        sumaOtros: parseFloat(sumaOtros.toFixed(2)),
        sumaNueva: nuevaSuma,
        disponible: parseFloat((100 - nuevaSuma).toFixed(2))
      }
    };

    if (totalActividades > 0) {
      respuesta.advertencia = {
        actividadesAfectadas: totalActividades,
        mensaje: 'Las calificaciones de las actividades existentes podrían verse afectadas',
        recomendacion: 'Revisa las calificaciones después de este cambio'
      };
    }

    res.json(respuesta);

  } catch (error) {
    console.error('❌ Error al modificar componente:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const eliminarComponente = async (req, res) => {
  const { idComponente } = req.params;

  try {
    const pool = await sql.connect(config);
    
    console.log(`🗑️ Eliminando componente ID: ${idComponente}`);

    // 1. 🔍 VERIFICAR QUE EL COMPONENTE EXISTE
    const componenteResult = await pool.request()
      .input('idComponente', sql.Int, parseInt(idComponente))
      .execute(`sp_ComponenteResult`);

    if (componenteResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Componente no encontrado' });
    }

    const componente = componenteResult.recordset[0];

    // 2. 🚨 VERIFICACIÓN CRÍTICA: ACTIVIDADES ASOCIADAS
    const actividadesResult = await pool.request()
      .input('idComponente', sql.Int, parseInt(idComponente))
      .execute(`sp_actividadesResult`);

    const { totalActividades, titulosActividades, idsActividades } = actividadesResult.recordset[0];

    if (totalActividades > 0) {
      return res.status(400).json({ 
        error: `🔒 No se puede eliminar el componente "${componente.componente}"`,
        razon: 'PROTECCIÓN DE DATOS',
        detalles: {
          actividadesVinculadas: totalActividades,
          actividades: titulosActividades ? titulosActividades.split(',').map(t => t.trim()) : [],
          impacto: 'La eliminación afectaría las calificaciones de los estudiantes'
        },
        soluciones: [
          'Elimina primero todas las actividades que usan este componente',
          'Modifica las actividades para usar otro componente',
          'Cambia el valor del componente a 0% en lugar de eliminarlo'
        ],
        codigoDeSeguridad: 'COMPONENT_IN_USE'
      });
    }

    // 3. 📊 VERIFICAR IMPACTO EN LA SUMA TOTAL
    const sumaActualResult = await pool.request()
      .input('claveMateria', sql.VarChar, componente.vchClvMateria)
      .input('parcial', sql.Int, componente.parcial)
      .input('vchPeriodo', sql.VarChar, componente.vchPeriodo)
      .input('claveDocente', sql.VarChar, componente.vchClvTrabajador)
      .execute(`sp_sumaActualResult`);

    const sumaActual = sumaActualResult.recordset[0].sumaTotal;
    const totalComponentes = sumaActualResult.recordset[0].totalComponentes;
    const nuevaSuma = sumaActual - componente.valor_componente;

    // 4. ⚠️ VALIDACIÓN: ¿QUEDARÁ INCOMPLETO EL PARCIAL?
    if (totalComponentes === 1) {
      return res.status(400).json({ 
        error: `⚠️ No puedes eliminar el único componente del parcial`,
        detalles: {
          componentesRestantes: 0,
          impacto: 'El parcial quedaría sin componentes de evaluación',
          sugerencia: 'Modifica el componente existente o agrega otro antes de eliminar este'
        }
      });
    }

    // 5. 🔥 ADVERTENCIA SOBRE PÉRDIDA DE PORCENTAJE
    if (sumaActual === 100 && componente.valor_componente > 0) {
      console.log(`⚠️ ADVERTENCIA: Se perderá ${componente.valor_componente}% de la ponderación total`);
    }

    // 6. 🗑️ PROCEDER CON LA ELIMINACIÓN
    await pool.request()
      .input('idComponente', sql.Int, parseInt(idComponente))
      .execute(`sp_EliminarComponenteEvaluacion`);

    console.log(`✅ Componente eliminado: ${componente.componente} - ${componente.valor_componente}%`);
    console.log(`📊 Nueva suma total: ${nuevaSuma}%`);

    // 7. 🎯 RESPUESTA DETALLADA CON RECOMENDACIONES
    const respuesta = {
      mensaje: '✅ Componente eliminado correctamente',
      componenteEliminado: {
        nombre: componente.componente,
        valor: componente.valor_componente
      },
      impacto: {
        sumaAnterior: parseFloat(sumaActual.toFixed(2)),
        sumaNueva: parseFloat(nuevaSuma.toFixed(2)),
        valorLiberado: componente.valor_componente,
        disponible: parseFloat((100 - nuevaSuma).toFixed(2)),
        componentesRestantes: totalComponentes - 1
      }
    };

    // 🔮 RECOMENDACIONES INTELIGENTES POST-ELIMINACIÓN
    if (nuevaSuma < 100) {
      const faltante = 100 - nuevaSuma;
      respuesta.recomendacion = {
        tipo: 'rebalancear',
        mensaje: `Considera redistribuir el ${faltante.toFixed(2)}% liberado`,
        opciones: [
          'Incrementar el valor de un componente existente',
          'Crear un nuevo componente con el valor liberado',
          `Distribuir proporcionalmente entre los ${totalComponentes - 1} componentes restantes`
        ]
      };
    }

    if (nuevaSuma < 50) {
      respuesta.alerta = {
        tipo: 'suma_muy_baja',
        mensaje: '⚠️ La suma total está muy baja. Considera agregar más componentes.',
        sumaTotalActual: parseFloat(nuevaSuma.toFixed(2))
      };
    }

    res.json(respuesta);

  } catch (error) {
    console.error('❌ Error al eliminar componente:', error);
    res.status(500).json({ error: 'Error del servidor' });
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

    // Verificar actividades que usan estos componentes
    const actividadesResult = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parseInt(parcial))
      .input('vchPeriodo', sql.VarChar, periodo)
      .input('claveDocente', sql.VarChar, claveDocente)
      .execute(`sp_VerificarActividadesConComponentes`);

    const totalActividades = actividadesResult.recordset[0].totalActividades;

    // 🎯 ANÁLISIS COMPLETO DE VALIDACIÓN
    const analisis = {
      parcial: parseInt(parcial),
      estadisticas: {
        totalComponentes: datos.totalComponentes,
        sumaTotal,
        disponible: parseFloat((100 - sumaTotal).toFixed(2)),
        menorValor: datos.menorValor || 0,
        mayorValor: datos.mayorValor || 0,
        promedioValor: datos.totalComponentes > 0 ? parseFloat(datos.promedioValor.toFixed(2)) : 0
      },
      validacion: {
        esValido: sumaTotal <= 100,
        esCompleto: sumaTotal === 100,
        exceso: sumaTotal > 100 ? parseFloat((sumaTotal - 100).toFixed(2)) : 0,
        faltante: sumaTotal < 100 ? parseFloat((100 - sumaTotal).toFixed(2)) : 0
      },
      actividades: {
        total: totalActividades,
        hayActividades: totalActividades > 0
      },
      estado: getEstadoParcial(sumaTotal, datos.totalComponentes, totalActividades)
    };

    // 🔮 RECOMENDACIONES PERSONALIZADAS
    analisis.recomendaciones = generarRecomendaciones(analisis);

    res.json(analisis);

  } catch (error) {
    console.error('❌ Error al validar parcial:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

// 🧠 FUNCIÓN AUXILIAR: Determinar estado del parcial
function getEstadoParcial(suma, componentes, actividades) {
  if (suma === 100 && componentes > 0) {
    return actividades > 0 ? 'completo_con_actividades' : 'completo_sin_actividades';
  } else if (suma > 100) {
    return 'excedido';
  } else if (suma === 0) {
    return 'vacio';
  } else if (suma < 50) {
    return 'muy_incompleto';
  } else if (suma < 100) {
    return 'incompleto';
  }
  return 'indefinido';
}

// 🎯 FUNCIÓN AUXILIAR: Generar recomendaciones inteligentes
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
        acciones: ['Agrega al menos 2-3 componentes básicos', 'Sugerencia: Actividades (40%), Examen (60%)']
      });
      break;

    case 'muy_incompleto':
      recomendaciones.push({
        tipo: 'advertencia',
        icono: '⚠️',
        titulo: 'Ponderación muy baja',
        mensaje: `Solo tienes ${estadisticas.sumaTotal}% asignado`,
        acciones: [
          `Faltan ${validacion.faltante}% por asignar`,
          'Considera agregar componentes importantes como Examen o Proyecto'
        ]
      });
      break;

    case 'incompleto':
      recomendaciones.push({
        tipo: 'info',
        icono: '📝',
        titulo: 'Casi completo',
        mensaje: `Te faltan ${validacion.faltante}% para completar`,
        acciones: [
          validacion.faltante > 10 ? 'Agrega un componente mediano' : 'Agrega un componente pequeño',
          'Opciones: Participación, Tareas, Asistencia'
        ]
      });
      break;

    case 'excedido':
      recomendaciones.push({
        tipo: 'error',
        icono: '❌',
        titulo: 'Ponderación excedida',
        mensaje: `Tienes ${validacion.exceso}% de más`,
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
        mensaje: 'Tienes el 100% configurado correctamente',
        acciones: ['Ya puedes crear actividades para este parcial']
      });
      break;

    case 'completo_con_actividades':
      recomendaciones.push({
        tipo: 'perfecto',
        icono: '🎉',
        titulo: '¡Parcial completamente configurado!',
        mensaje: `100% ponderado con ${actividades.total} actividades creadas`,
        acciones: ['El parcial está listo para calificaciones']
      });
      break;
  }

  // 🔍 RECOMENDACIONES ADICIONALES SEGÚN ANÁLISIS
  if (estadisticas.totalComponentes === 1 && estadisticas.sumaTotal < 100) {
    recomendaciones.push({
      tipo: 'sugerencia',
      icono: '💡',
      titulo: 'Diversifica la evaluación',
      mensaje: 'Un solo componente puede ser riesgoso',
      acciones: ['Considera dividir en 2-3 componentes diferentes']
    });
  }

  if (estadisticas.mayorValor > 70) {
    recomendaciones.push({
      tipo: 'advertencia',
      icono: '⚖️',
      titulo: 'Componente muy pesado',
      mensaje: `Un componente vale ${estadisticas.mayorValor}%`,
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

// 🆕 FUNCIÓN: Obtener estadísticas generales del docente
const obtenerEstadisticasGeneralesDocente = async (req, res) => {
  const { claveDocente } = req.params;

  try {
    const pool = await sql.connect(config);

    // Estadísticas por parcial
    const estadisticasParciales = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .execute(`sp_obtenerEstadisticasGeneralesDocente`);

    // Resumen general
    const resumen = {
      parcialesCompletos: estadisticasParciales.filter(p => p.estado === 'completo').length,
      parcialesIncompletos: estadisticasParciales.filter(p => p.estado === 'incompleto' || p.estado === 'muy_incompleto').length,
      parcialesExcedidos: estadisticasParciales.filter(p => p.estado === 'excedido').length,
      totalParciales: estadisticasParciales.length,
      detallePorMateria: {}
    };

    // Agrupar por materia
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

// 🆕 FUNCIÓN: Clonar componentes de un parcial a otro
// 🔧 REEMPLAZAR tu función clonarComponentesParcial con esta versión:
const clonarComponentesParcial = async (req, res) => {
  const { 
    claveMateria, 
    parcialOrigen, 
    parcialDestino, 
    periodo: periodoRecibido, // 🆕 CAMBIAR NOMBRE
    claveDocente 
  } = req.body;

  try {
    // 🆕 USAR PERIODO AUTOMÁTICO DE BD
    const periodo = await validarPeriodo(periodoRecibido);
    
    if (!periodo) {
      return res.status(500).json({ 
        error: 'No se pudo determinar el periodo actual' 
      });
    }

    console.log(`📋 Clonando componentes: ${parcialOrigen} → ${parcialDestino} (Periodo BD: ${periodo})`);

    const pool = await sql.connect(config);

    // 🚀 EJECUTAR EL STORED PROCEDURE (hace todo: verifica, valida y clona)
    const result = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcialOrigen', sql.Int, parcialOrigen)
      .input('parcialDestino', sql.Int, parcialDestino)
      .input('periodo', sql.VarChar, periodo) // 🆕 USAR PERIODO VALIDADO
      .input('claveDocente', sql.VarChar, claveDocente)
      .execute('sp_componentesClonados');

    const respuesta = result.recordset[0];

    // 🎯 MANEJAR RESPUESTA DEL STORED PROCEDURE
    if (respuesta.resultado === 'ERROR') {
      return res.status(400).json({ 
        error: respuesta.mensaje,
        componentesClonados: respuesta.componentesClonados || 0,
        // 🆕 INFORMACIÓN DEL PERIODO
        periodoInfo: {
          periodoUsado: periodo,
          esAutomatico: periodoRecibido === 'auto' || !periodoRecibido,
          origen: 'baseDatos'
        }
      });
    }

    // ✅ CASO EXITOSO: Procesar los componentes clonados
    const componentesClonados = result.recordset.map(componente => ({
      nombre: componente.nombre || componente.componente,
      valor: componente.valor || componente.valor_componente
    }));

    // 🧮 CALCULAR SUMA TOTAL
    const sumaTotal = componentesClonados.reduce((sum, c) => sum + parseFloat(c.valor || 0), 0);

    console.log(`✅ Clonación completada: ${componentesClonados.length} componentes (Periodo BD: ${periodo})`);

    res.json({
      mensaje: respuesta.mensaje,
      componentesClonados,
      total: componentesClonados.length,
      sumaTotal: parseFloat(sumaTotal.toFixed(2)),
      // 🆕 INFORMACIÓN DEL PERIODO USADO
      periodoInfo: {
        periodoUsado: periodo,
        esAutomatico: periodoRecibido === 'auto' || !periodoRecibido,
        origen: 'baseDatos'
      }
    });

  } catch (error) {
    console.error('❌ Error al clonar componentes:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

// Validar suma total de componentes (función auxiliar)
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

// Obtener componentes para dropdown en crear actividad
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

// ===============================================
// 🔧 FUNCIONES DE CREACIÓN DE ACTIVIDADES - CORREGIDAS
// ===============================================

// 🔧 FUNCIÓN AUXILIAR: Formatear fechas sin UTC
const formatearFechaParaSQL = (fecha) => {
  const año = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  const hora = String(fecha.getHours()).padStart(2, '0');
  const minuto = String(fecha.getMinutes()).padStart(2, '0');
  const segundo = String(fecha.getSeconds()).padStart(2, '0');
  
  return `${año}-${mes}-${dia} ${hora}:${minuto}:${segundo}`;
};

// 🔧 FUNCIÓN COMPLETAMENTE CORREGIDA: crearActividadCompletaConComponente
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

    // ===============================================
    // 🇲🇽 PASO 1: PROCESAR FECHAS COMO HORA LOCAL 
    // ===============================================
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

    // ===============================================
    // VALIDACIONES
    // ===============================================
    if (!idInstrumento || !idValorComponente) {
      return res.status(400).json({ 
        error: 'Faltan datos requeridos (instrumento o componente)'
      });
    }

    // ===============================================
    // 🚀 PASO 2: USAR SP PRINCIPAL (hace el 80% del trabajo)
    // ===============================================
    console.log('🎯 Ejecutando SP principal que maneja actividad + grupos + modalidad individual...');

    // Formatear fechas para SQL Server (formato que espera el SP)
    const fechaCreacionString = fechaCreacionParaSQL.toISOString().slice(0, 19).replace('T', ' ');
    const fechaAsignacionString = fechaAsignacionParaSQL.toISOString().slice(0, 19).replace('T', ' ');
    const fechaEntregaString = fechaEntregaParaSQL.toISOString().slice(0, 19).replace('T', ' ');

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

    // 🚨 VERIFICAR SI EL SP PRINCIPAL FALLÓ
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

    // ===============================================
    // 🚀 PASO 3: MODALIDAD EQUIPO - CON TRANSACCIÓN SEPARADA
    // ===============================================
    if (modalidad === 2 && Object.keys(equiposPorGrupo).length > 0) {
      console.log('👥 Procesando equipos con SPs específicos en transacción...');
      
      const equipoTransaction = new sql.Transaction();
      
      try {
        await equipoTransaction.begin();
        
        for (const [claveGrupo, datosGrupo] of Object.entries(equiposPorGrupo)) {
          const grupoQuery = await pool.request()
            .input('clave', sql.VarChar, claveGrupo)
            .query('SELECT TOP 1 id_grupo FROM tbl_grupos WHERE vchGrupo = @clave');

          if (grupoQuery.recordset.length === 0) continue;
          const idGrupo = grupoQuery.recordset[0].id_grupo;

          let equiposParaAsignar = [];
          
          // 🔧 CASO 1: Usar equipos de actividad anterior
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

          // 🔧 CASO 2: Crear equipos nuevos
          } else if ((datosGrupo.tipoSeleccion === 'aleatorio' || datosGrupo.tipoSeleccion === 'manual') && datosGrupo.equiposNuevos) {
            console.log(`📋 Creando ${datosGrupo.equiposNuevos.length} equipos nuevos`);
            
            for (const equipoNuevo of datosGrupo.equiposNuevos) {
              if (!equipoNuevo.integrantes || equipoNuevo.integrantes.length === 0) {
                console.error(`❌ Equipo "${equipoNuevo.nombre}" no tiene integrantes`);
                continue;
              }

              const nombreEquipoUnico = `${equipoNuevo.nombre}_${Date.now()}`;
              
              // 🚀 SP: Crear equipo
              const equipoCreado = await equipoTransaction.request()
                .input('idGrupo', sql.Int, idGrupo)
                .input('nombreEquipo', sql.NVarChar, nombreEquipoUnico)
                .execute('sp_equipoRecienCreado');

              if (equipoCreado.recordset.length === 0) {
                throw new Error(`No se pudo crear equipo "${equipoNuevo.nombre}"`);
              }

              const idEquipoCreado = equipoCreado.recordset[0].id_equipo;

              // 🚀 SP: Asignar integrantes
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

          // 🚀 SP: Asignar equipos a la actividad
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

    // ===============================================
    // 🚀 PASO 4: VERIFICACIÓN FINAL
    // ===============================================
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

    // ===============================================
    // 🎉 RESPUESTA EXITOSA
    // ===============================================
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

// 🔧 FUNCIÓN CORREGIDA: crearActividad (versión original sin componente)
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

    // 🚀 PASO 1: Obtener instrumento usando SP
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

    // 🚀 PASO 2: Obtener siguiente número de actividad usando SP
    const numeroResult = await pool.request()
      .execute('sp_numeroResult2');
    
    const numeroActividad = numeroResult.recordset[0].siguiente;

    // 🚀 PASO 3: Crear actividad usando SP
    const actividadResult = await pool.request()
      .input('titulo', sql.NVarChar, titulo)
      .input('descripcion', sql.NVarChar, descripcion)
      .input('fecha', sql.Date, new Date())
      .input('docente', sql.NVarChar, claveDocente)
      .input('idInstrumento', sql.Int, idInstrumento)
      .input('numero', sql.Int, numeroActividad)
      .input('modalidad', sql.Int, 1) // Siempre individual
      .execute('sp_actividadResult');

    const idActividad = actividadResult.recordset[0].idActividad;

    // 🚀 PASO 4: Procesar cada grupo usando SPs
    let totalAlumnosAsignados = 0;

    for (const claveGrupo of grupos) {
      // Obtener ID de grupo
      const grupoQuery = await pool.request()
        .input('clave', sql.VarChar, claveGrupo)
        .query('SELECT TOP 1 id_grupo FROM tbl_grupos WHERE vchGrupo = @clave');

      if (grupoQuery.recordset.length === 0) continue;
      const idGrupo = grupoQuery.recordset[0].id_grupo;

      // 🚀 SP: Insertar actividad-grupo
      await pool.request()
        .input('idActividad', sql.Int, idActividad)
        .input('idGrupo', sql.Int, idGrupo)
        .input('fechaAsignacion', sql.DateTime, new Date())
        .input('fechaEntrega', sql.DateTime, fechaEntrega)
        .execute('sp_InsertarActividadGrupo');

      // 🚀 SP: Obtener periodo/cuatrimestre
      const periodoResult = await pool.request()
        .input('claveDocente', sql.VarChar, claveDocente)
        .input('claveMateria', sql.VarChar, claveMateria)
        .execute('sp_periodoResult');

      if (periodoResult.recordset.length === 0) continue;
      const { vchCuatrimestre, Periodo } = periodoResult.recordset[0];

      // 🚀 SP: Obtener alumnos del grupo
      const alumnosResult = await pool.request()
        .input('idGrupo', sql.Int, idGrupo)
        .input('cuatrimestre', sql.VarChar, vchCuatrimestre)
        .input('periodo', sql.VarChar, Periodo)
        .execute('sp_alumnosResult');

      // 🚀 SP: Asignar cada alumno con estado PENDIENTE
      for (const alumno of alumnosResult.recordset) {
        await pool.request()
          .input('idActividad', sql.Int, idActividad)
          .input('matricula', sql.VarChar, alumno.vchMatricula)
          .input('idEstado', sql.Int, 1) // 1 = PENDIENTE
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
// ===============================================
// 🆕 FUNCIONES PARA OBSERVACIONES
// ===============================================

// Guardar observación de alumno individual
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

// Guardar observación de equipo
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

// Obtener observación existente de alumno
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

// Obtener observación existente de equipo
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

// ===============================================
// 🆕 FUNCIONES PARA PROCEDIMIENTOS ALMACENADOS
// ===============================================

// Ejecutar procedimiento para concentrado final
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

// ===============================================
// CONTINUACIÓN DEL CONTROLLER - PARTE 2
// ===============================================

// Ejecutar procedimiento para calificaciones de actividad
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

// ===============================================
// FUNCIONES EXISTENTES OPTIMIZADAS
// ===============================================

// Obtener listas de cotejo
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

// 🔧 FUNCIÓN OPTIMIZADA: obtenerActividadesPorGrupo - CON SISTEMA DE ESTADOS V2
// 🔧 FUNCIÓN OPTIMIZADA: obtenerActividadesPorGrupo - CON CONTEO CORRECTO POR GRUPO
const obtenerActividadesPorGrupo = async (req, res) => {
  const { claveDocente, claveMateria, idGrupo } = req.params;
  const { parcial, modalidad } = req.query;

  try {
    const pool = await sql.connect(config);
    
    console.log(`📊 Cargando actividades para grupo específico: ${idGrupo}`);
    
    // 🎯 CONFIGURAR PARÁMETROS PARA EL STORED PROCEDURE
    const request = pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('idGrupo', sql.Int, idGrupo);
    
    // Agregar parámetros opcionales (null si no se proporcionan)
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

    // 🚀 EJECUTAR EL STORED PROCEDURE
    const result = await request.execute('sp_obtenerActividadesPorGrupo');

    // 🎯 PROCESAR RESULTADOS CON ESTADÍSTICAS FILTRADAS POR GRUPO
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

      // ✅ USAR ESTADO REAL CALCULADO PARA EL GRUPO
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
        
        // 📊 ESTADÍSTICAS DETALLADAS FILTRADAS POR GRUPO
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
        
        // 🚨 INDICADORES DE ATENCIÓN
        urgente: actividad.diasRestantes <= 2 && estado === 'activa',
        requiereAtencion: (actividad.alumnosPendientes || 0) > 0 && actividad.diasRestantes < 0
      });

      // Actualizar estadísticas del parcial
      actividadesPorParcial[parcial].estadisticas.total++;
      if (estado === 'activa') actividadesPorParcial[parcial].estadisticas.pendientes++;
      if (estado === 'completada') actividadesPorParcial[parcial].estadisticas.completadas++;
      if (estado === 'vencida' || estado === 'pendiente_vencida') actividadesPorParcial[parcial].estadisticas.vencidas++;
    });

    // 🎯 ESTADÍSTICAS GLOBALES OPTIMIZADAS - FILTRADAS POR GRUPO
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

    // Convertir parciales a array ordenado
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
      // 🎯 METADATOS CON EL NUEVO SISTEMA
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

// Cambiar contraseña del docente
const cambiarContrasenaDocente = async (req, res) => {
  const { usuario, contrasenaActual, nuevaContrasena } = req.body;

  try {
    const pool = await sql.connect(config);
    
    // 🚀 EJECUTAR EL STORED PROCEDURE
    const result = await pool.request()
      .input('usuario', sql.VarChar, usuario)
      .input('contrasenaActual', sql.VarChar, contrasenaActual)
      .input('nuevaContrasena', sql.VarChar, nuevaContrasena)
      .execute('sp_cambiarContrasenaDocente');

    // ✅ Si llega aquí, la operación fue exitosa
    const mensaje = result.recordset[0]?.mensaje || 'Contraseña actualizada correctamente';
    
    res.json({ 
      mensaje: mensaje,
      success: true 
    });

  } catch (err) {
    console.error('❌ Error al cambiar contraseña:', err);
    
    // 🎯 MANEJAR ERRORES DEL STORED PROCEDURE
    if (err.message && err.message.includes('La contraseña actual es incorrecta')) {
      return res.status(400).json({ 
        mensaje: 'La contraseña actual es incorrecta',
        success: false 
      });
    }
    
    // Error genérico del servidor
    res.status(500).json({ 
      mensaje: 'Error en el servidor',
      success: false 
    });
  }
};
// ===============================================
// FUNCIONES PARA MANEJO DE EQUIPOS
// ===============================================

// Obtener equipos existentes de un grupo específico
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

// Obtener alumnos disponibles de un grupo
const obtenerAlumnosPorGrupo = async (req, res) => {
  const { claveDocente, claveMateria, idGrupo } = req.params;

  try {
    const pool = await sql.connect(config);
    
    // 🚀 EJECUTAR EL STORED PROCEDURE (combina ambas consultas)
    const result = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('idGrupo', sql.Int, idGrupo)
      .execute('sp_obtenerAlumnosPorGrupo');

    // ✅ Retornar los alumnos encontrados
    res.json(result.recordset);

  } catch (error) {
    console.error('❌ Error al obtener alumnos:', error);
    
    // 🎯 MANEJAR ERROR ESPECÍFICO DEL STORED PROCEDURE
    if (error.message && error.message.includes('No se encontró la relación docente-materia')) {
      return res.status(404).json({ 
        error: 'No se encontró la relación docente-materia' 
      });
    }
    
    // Error genérico del servidor
    res.status(500).json({ 
      error: 'Error del servidor' 
    });
  }
};

// Simular equipos aleatorios (sin insertar en BD)
const simularEquiposAleatorios = async (req, res) => {
  const { idGrupo, cantidadEquipos, claveDocente, claveMateria } = req.body;

  try {
    const pool = await sql.connect(config);

    // 🚀 EJECUTAR EL STORED PROCEDURE (combina periodo + alumnos aleatorizados)
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

    // 🎯 LÓGICA DE DISTRIBUCIÓN EN EQUIPOS (ya vienen aleatorizados del SP)
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
        id_temporal: Date.now() + i, // ID temporal único
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
    
    // 🎯 MANEJAR ERRORES ESPECÍFICOS DEL STORED PROCEDURE
    if (error.message && error.message.includes('No se encontró la relación docente-materia')) {
      return res.status(404).json({ 
        error: 'No se encontró la relación docente-materia' 
      });
    }
    
    // Error genérico del servidor
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
    
    // 🚀 EJECUTAR EL STORED PROCEDURE
    const result = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('idGrupo', sql.Int, idGrupo)
      .execute('sp_obtenerActividadesConEquiposPorGrupo');

    console.log(`✅ Actividades con equipos encontradas para grupo ${idGrupo}: ${result.recordset.length}`);
    
    // 🆕 DEBUG: Mostrar detalles de las actividades encontradas
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

// ===============================================
// FUNCIONES PARA CALIFICAR ACTIVIDADES - CORREGIDAS
// ===============================================

// 🔧 CORREGIDO: Obtener datos de actividad para calificar

const obtenerDatosActividad = async (req, res) => {
  const { idActividad } = req.params;

  try {
    const pool = await sql.connect(config);
    
    // 🚀 EJECUTAR EL STORED PROCEDURE
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

// Obtener criterios de evaluación de una actividad
const obtenerCriteriosActividad = async (req, res) => {
  const { idActividad } = req.params;

  try {
    const pool = await sql.connect(config);
    
    // 🚀 EJECUTAR EL STORED PROCEDURE (combina ambas consultas)
    const result = await pool.request()
      .input('idActividad', sql.Int, idActividad)
      .execute('sp_obtenerCriteriosActividad');

    // ✅ Los criterios ya vienen con el formato correcto del SP
    res.json(result.recordset);
    
  } catch (error) {
    console.error('❌ Error al obtener criterios:', error);
    
    // 🎯 MANEJAR ERROR ESPECÍFICO DEL STORED PROCEDURE
    if (error.message && error.message.includes('Instrumento no encontrado')) {
      return res.status(404).json({ 
        error: 'Instrumento no encontrado' 
      });
    }
    
    // Error genérico del servidor
    res.status(500).json({ 
      error: 'Error del servidor' 
    });
  }
};

// Obtener equipos para calificar (modalidad equipo) - CÁLCULO COMPLETAMENTE CORREGIDO
// Obtener equipos para calificar (modalidad equipo) - CÁLCULO COMPLETAMENTE CORREGIDO
// Obtener equipos para calificar - FILTRO CORREGIDO
const obtenerEquiposParaCalificar = async (req, res) => {
  const { idActividad } = req.params;
  const { idGrupo } = req.query; // 🔧 PARÁMETRO DEL GRUPO

  try {
    const pool = await sql.connect(config);
    
    console.log(`🔍 Obteniendo equipos para calificar: Actividad=${idActividad}, Grupo=${idGrupo}`);

    // 🚀 EJECUTAR EL STORED PROCEDURE (combina todas las consultas)
    const request = pool.request()
      .input('idActividad', sql.Int, idActividad);

    // 🆕 AGREGAR FILTRO POR GRUPO SI SE PROPORCIONA
    if (idGrupo) {
      request.input('idGrupo', sql.Int, parseInt(idGrupo));
      console.log(`🎯 Filtrando por ID de grupo numérico: ${idGrupo}`);
    } else {
      request.input('idGrupo', sql.Int, null);
    }

    const result = await request.execute('sp_obtenerEquiposParaCalificar');

    console.log(`✅ Equipos encontrados para grupo ID ${idGrupo}: ${result.recordset.length}`);
    
    // 🆕 DEBUG: Mostrar detalles de los equipos encontrados
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
// Obtener alumnos para calificar (modalidad individual) - CÁLCULO COMPLETAMENTE CORREGIDO
const obtenerAlumnosParaCalificar = async (req, res) => {
  const { idActividad } = req.params;

  try {
    const pool = await sql.connect(config);
    
    // 🚀 EJECUTAR EL STORED PROCEDURE (combina todas las consultas)
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
    
    // 🚀 EJECUTAR EL STORED PROCEDURE (devuelve múltiples conjuntos de resultados)
    const result = await pool.request()
      .input('idActividadAlumno', sql.Int, idActividadAlumno)
      .execute('sp_ObtenerCalificacionesAlumno');

    // 📊 EXTRAER LOS DOS CONJUNTOS DE RESULTADOS
    const calificaciones = result.recordsets[0]; // Primer SELECT: calificaciones
    const observacionData = result.recordsets[1]; // Segundo SELECT: observación

    // 🆕 RESPUESTA COMPLETA CON OBSERVACIÓN
    res.json({
      calificaciones: calificaciones,
      observacion: observacionData[0]?.observacion || null
    });

  } catch (error) {
    console.error('❌ Error al obtener calificaciones del alumno:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};
// Obtener calificaciones existentes de un equipo - CORREGIDA
// Obtener calificaciones existentes de un equipo - CORREGIDA
const obtenerCalificacionesEquipo = async (req, res) => {
  const { idActividadEquipo } = req.params;

  try {
    const pool = await sql.connect(config);
    
    // 🚀 EJECUTAR EL STORED PROCEDURE (devuelve múltiples conjuntos de resultados)
    const result = await pool.request()
      .input('idActividadEquipo', sql.Int, idActividadEquipo)
      .execute('sp_ObtenerCalificacionesEquipo');

    // 📊 EXTRAER LOS DOS CONJUNTOS DE RESULTADOS
    const calificaciones = result.recordsets[0]; // Primer SELECT: calificaciones
    const observacionData = result.recordsets[1]; // Segundo SELECT: observación

    // 🆕 RESPUESTA COMPLETA CON OBSERVACIÓN
    res.json({
      calificaciones: calificaciones,
      observacion: observacionData[0]?.observacion || null
    });

  } catch (error) {
    console.error('❌ Error al obtener calificaciones del equipo:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

// 🔧 CORREGIDO: Guardar calificaciones de un alumno - CON ACTUALIZACIÓN DE ESTADO
// 🔧 CORREGIDO: Guardar calificaciones de un alumno - CON OBSERVACIONES
const guardarCalificacionesAlumno = async (req, res) => {
  const { idActividadAlumno, calificaciones, observacion } = req.body; // 🆕 AGREGAR observacion
  // calificaciones = [{ id_criterio: 1, calificacion: 2.0 }, ...]

  const transaction = new sql.Transaction();

  try {
    const pool = await sql.connect(config);
    await transaction.begin();

    console.log(`📝 Guardando calificaciones para alumno ID: ${idActividadAlumno}`);
    console.log(`💬 OBSERVACIÓN RECIBIDA DEL FRONTEND:`, observacion); // 🆕 DEBUG LOG
    console.log(`📊 CALIFICACIONES:`, calificaciones);

    // Eliminar calificaciones existentes
    await transaction.request()
      .input('idActividadAlumno', sql.Int, idActividadAlumno)
      .query(`
        DELETE FROM tbl_evaluacion_criterioActividad 
        WHERE id_actividad_alumno = @idActividadAlumno
      `);

    // Insertar nuevas calificaciones
    for (const cal of calificaciones) {
      await transaction.request()
        .input('idActividadAlumno', sql.Int, idActividadAlumno)
        .input('idCriterio', sql.Int, cal.id_criterio)
        .input('calificacion', sql.Float, cal.calificacion)
        .query(`
          INSERT INTO tbl_evaluacion_criterioActividad (
            id_actividad_alumno, id_criterio, calificacion
          ) VALUES (@idActividadAlumno, @idCriterio, @calificacion)
        `);
    }

    // 🆕 ACTUALIZAR ESTADO Y OBSERVACIÓN EN UNA SOLA QUERY
    await transaction.request()
      .input('idActividadAlumno', sql.Int, idActividadAlumno)
      .input('nuevoEstado', sql.Int, 2) // 2 = Entregado
      .input('observacion', sql.NVarChar, observacion || null) // 🆕 OBSERVACIÓN
      .query(`
        UPDATE tbl_actividad_alumno 
        SET id_estado = @nuevoEstado, observacion = @observacion 
        WHERE id_actividad_alumno = @idActividadAlumno
      `);

    await transaction.commit();
    
    console.log(`✅ Calificaciones guardadas y estado actualizado a "Entregado"`);
    console.log(`💬 Observación final guardada: "${observacion}"`); // 🆕 CONFIRMACIÓN LOG
    
    res.json({ 
      mensaje: 'Calificaciones y observación guardadas correctamente',
      estadoActualizado: 'Entregado',
      observacionGuardada: observacion // 🆕 RESPUESTA CON CONFIRMACIÓN
    });

  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error al guardar calificaciones del alumno:', error);
    res.status(500).json({ error: 'Error al guardar calificaciones' });
  }
};

const guardarCalificacionesEquipo = async (req, res) => {
  // 🔧 CORREGIDO: Recibir integrantesPersonalizados
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
    console.log('🎯 Integrantes personalizados:', integrantesPersonalizados); // 🆕 DEBUG

    // PASO 1: Eliminar calificaciones existentes del equipo
    await transaction.request()
      .input('idActividadEquipo', sql.Int, idActividadEquipo)
      .query(`
        DELETE FROM tbl_evaluacion_criterioActividadEquipo 
        WHERE id_actividad_equipo = @idActividadEquipo
      `);

    // PASO 2: Obtener todos los integrantes del equipo
    const integrantesResult = await transaction.request()
      .input('idEquipo', sql.Int, idEquipo)
      .query(`
        SELECT ea.vchMatricula
        FROM tbl_equipo_alumno ea
        WHERE ea.id_equipo = @idEquipo
      `);

    const integrantes = integrantesResult.recordset;
    console.log(`👥 Integrantes del equipo: ${integrantes.length}`);

    if (integrantes.length === 0) {
      throw new Error('No se encontraron integrantes en el equipo');
    }

    // PASO 3: Obtener la actividad para verificar modalidad
    const actividadResult = await transaction.request()
      .input('idActividadEquipo', sql.Int, idActividadEquipo)
      .query(`
        SELECT ae.id_actividad
        FROM tbl_actividad_equipo ae
        WHERE ae.id_actividad_equipo = @idActividadEquipo
      `);

    if (actividadResult.recordset.length === 0) {
      throw new Error('Actividad equipo no encontrada');
    }

    const idActividad = actividadResult.recordset[0].id_actividad;

    // PASO 4: Insertar nuevas calificaciones en tabla de equipos
    for (const cal of calificaciones) {
      await transaction.request()
        .input('idEquipo', sql.Int, idEquipo)
        .input('idActividadEquipo', sql.Int, idActividadEquipo)
        .input('idCriterio', sql.Int, cal.id_criterio)
        .input('calificacion', sql.Float, cal.calificacion)
        .query(`
          INSERT INTO tbl_evaluacion_criterioActividadEquipo (
            id_equipo, id_actividad_equipo, id_criterio, calificacion
          ) VALUES (@idEquipo, @idActividadEquipo, @idCriterio, @calificacion)
        `);
    }

    // PASO 5: Actualizar estado y observación del equipo
    await transaction.request()
      .input('idActividadEquipo', sql.Int, idActividadEquipo)
      .input('nuevoEstado', sql.Int, 2) // 2 = Entregado
      .input('observacion', sql.NVarChar, observacion || null)
      .query(`
        UPDATE tbl_actividad_equipo 
        SET id_estado = @nuevoEstado, observacion = @observacion 
        WHERE id_actividad_equipo = @idActividadEquipo
      `);

    // 🔧 PASO 6.5: MAPEAR MATRÍCULAS TEMPORALES A REALES
    console.log('🔧 Mapeando matrículas temporales a reales...');
    const integrantesPersonalizadosConMatriculasReales = [];

    if (integrantesPersonalizados && integrantesPersonalizados.length > 0) {
      for (let i = 0; i < integrantes.length && i < integrantesPersonalizados.length; i++) {
        const integranteReal = integrantes[i];
        const integrantePersonalizado = integrantesPersonalizados[i];
        
        integrantesPersonalizadosConMatriculasReales.push({
          vchMatricula: integranteReal.vchMatricula, // ← USAR MATRÍCULA REAL
          tieneCalificacionPersonalizada: integrantePersonalizado.tieneCalificacionPersonalizada || false,
          observacionesPersonalizadas: integrantePersonalizado.observacionesPersonalizadas || '',
          criteriosPersonalizados: integrantePersonalizado.criteriosPersonalizados || {}
        });
        
        console.log(`🔄 Mapeado: ${integrantePersonalizado.vchMatricula} → ${integranteReal.vchMatricula}`);
      }
    }

    console.log('✅ Mapeo completado:', integrantesPersonalizadosConMatriculasReales);

    // 🔧 PASO 6 CORREGIDO: PROCESAR CALIFICACIONES INDIVIDUALES O GRUPALES
    for (const integrante of integrantes) {
      console.log(`📝 Procesando calificaciones para ${integrante.vchMatricula}`);

      // 🎯 BUSCAR SI ESTE INTEGRANTE TIENE CALIFICACIONES PERSONALIZADAS (CORREGIDO)
      const integrantePersonalizado = integrantesPersonalizadosConMatriculasReales?.find(
        ip => ip.vchMatricula === integrante.vchMatricula
      );

      const tieneCalificacionPersonalizada = integrantePersonalizado?.tieneCalificacionPersonalizada || false;
      const observacionPersonalizada = integrantePersonalizado?.observacionesPersonalizadas || observacion;

      console.log(`🎯 ${integrante.vchMatricula} - Personalizada: ${tieneCalificacionPersonalizada}`);

      // Verificar si existe registro en tbl_actividad_alumno
      const actividadAlumnoResult = await transaction.request()
        .input('idActividad', sql.Int, idActividad)
        .input('matricula', sql.VarChar, integrante.vchMatricula)
        .query(`
          SELECT id_actividad_alumno
          FROM tbl_actividad_alumno
          WHERE id_actividad = @idActividad AND vchMatricula = @matricula
        `);

      let idActividadAlumno;

      if (actividadAlumnoResult.recordset.length === 0) {
        // Crear registro
        await transaction.request()
          .input('idActividad', sql.Int, idActividad)
          .input('matricula', sql.VarChar, integrante.vchMatricula)
          .input('estadoInicial', sql.Int, 2) // 2 = Entregado
          .input('observacion', sql.NVarChar, observacionPersonalizada || null)
          .query(`
            INSERT INTO tbl_actividad_alumno (id_actividad, vchMatricula, id_estado, observacion)
            VALUES (@idActividad, @matricula, @estadoInicial, @observacion)
          `);
        
        // Obtener el ID insertado
        const nuevoIdResult = await transaction.request()
          .input('idActividad', sql.Int, idActividad)
          .input('matricula', sql.VarChar, integrante.vchMatricula)
          .query(`
            SELECT id_actividad_alumno
            FROM tbl_actividad_alumno
            WHERE id_actividad = @idActividad AND vchMatricula = @matricula
          `);
        
        idActividadAlumno = nuevoIdResult.recordset[0].id_actividad_alumno;
        console.log(`✅ Creado tbl_actividad_alumno para ${integrante.vchMatricula}: ${idActividadAlumno}`);
      } else {
        idActividadAlumno = actividadAlumnoResult.recordset[0].id_actividad_alumno;
        
        // Actualizar estado y observación
        await transaction.request()
          .input('idActividadAlumno', sql.Int, idActividadAlumno)
          .input('nuevoEstado', sql.Int, 2) // 2 = Entregado
          .input('observacion', sql.NVarChar, observacionPersonalizada || null)
          .query(`
            UPDATE tbl_actividad_alumno 
            SET id_estado = @nuevoEstado, observacion = @observacion 
            WHERE id_actividad_alumno = @idActividadAlumno
          `);
        
        console.log(`✅ Actualizando tbl_actividad_alumno existente: ${idActividadAlumno}`);
      }

      // Eliminar calificaciones individuales existentes para este alumno
      await transaction.request()
        .input('idActividadAlumno', sql.Int, idActividadAlumno)
        .query(`
          DELETE FROM tbl_evaluacion_criterioActividad 
          WHERE id_actividad_alumno = @idActividadAlumno
        `);

      // 🔧 INSERTAR CALIFICACIONES: PERSONALIZADAS O DEL EQUIPO
      if (tieneCalificacionPersonalizada && integrantePersonalizado.criteriosPersonalizados) {
        // 🎯 USAR CALIFICACIONES PERSONALIZADAS
        console.log(`🌟 Aplicando calificaciones PERSONALIZADAS para ${integrante.vchMatricula}`);
        
        for (const [idCriterio, calificacionPersonalizada] of Object.entries(integrantePersonalizado.criteriosPersonalizados)) {
          await transaction.request()
            .input('idActividadAlumno', sql.Int, idActividadAlumno)
            .input('idCriterio', sql.Int, parseInt(idCriterio))
            .input('calificacion', sql.Float, calificacionPersonalizada)
            .query(`
              INSERT INTO tbl_evaluacion_criterioActividad (
                id_actividad_alumno, id_criterio, calificacion
              ) VALUES (@idActividadAlumno, @idCriterio, @calificacion)
            `);
          
          console.log(`   ✅ Criterio ${idCriterio}: ${calificacionPersonalizada} puntos`);
        }
      } else {
        // 📊 USAR CALIFICACIONES DEL EQUIPO (COMPORTAMIENTO ANTERIOR)
        console.log(`📊 Aplicando calificaciones del EQUIPO para ${integrante.vchMatricula}`);
        
        for (const cal of calificaciones) {
          await transaction.request()
            .input('idActividadAlumno', sql.Int, idActividadAlumno)
            .input('idCriterio', sql.Int, cal.id_criterio)
            .input('calificacion', sql.Float, cal.calificacion)
            .query(`
              INSERT INTO tbl_evaluacion_criterioActividad (
                id_actividad_alumno, id_criterio, calificacion
              ) VALUES (@idActividadAlumno, @idCriterio, @calificacion)
            `);
        }
      }
    }

    await transaction.commit();
    
    // 🎯 ESTADÍSTICAS FINALES
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
      // 🆕 ESTADÍSTICAS DETALLADAS
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

// ===============================================
// 🆕 FUNCIONES AUXILIARES ADICIONALES
// ===============================================



// Obtener periodos de un docente (debug)
const obtenerPeriodosDocente = async (req, res) => {
  const { clave } = req.params;

  try {
    const pool = await sql.connect(config);
    
    // 🚀 EJECUTAR EL STORED PROCEDURE
    const result = await pool.request()
      .input('clave', sql.VarChar, clave)
      .execute('sp_ObtenerPeriodosDocente');

    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Error al obtener periodos del docente:', err);
    res.status(500).json({ mensaje: 'Error en el servidor' });
  }
};
// Obtener materias por periodo específico
const obtenerMateriasCompletasPorPeriodo = async (req, res) => {
  const { clave, periodo } = req.params;

  try {
    const pool = await sql.connect(config);

    // 🚀 EJECUTAR EL STORED PROCEDURE
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
// 🔧 FUNCIÓN OPTIMIZADA: obtenerEstadisticasGrupo - CON SISTEMA DE ESTADOS V2
const obtenerEstadisticasGrupo = async (req, res) => {
  const { claveDocente, claveMateria, idGrupo } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`📊 Calculando estadísticas optimizadas para: Docente=${claveDocente}, Materia=${claveMateria}, Grupo=${idGrupo}`);

    // 🚀 EJECUTAR EL STORED PROCEDURE (reemplaza toda la CTE compleja)
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
        
        // 🎯 DISTRIBUCIÓN DE ESTADOS
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
// Función 1: Obtener calificaciones individuales de integrantes de equipo
const obtenerCalificacionesIntegrantesEquipo = async (req, res) => {
  const { idActividadEquipo } = req.params;

  try {
    const pool = await sql.connect(config);
    
    console.log(`📊 Obteniendo calificaciones individuales para equipo ID: ${idActividadEquipo}`);

    // 🚀 EJECUTAR EL STORED PROCEDURE (reemplaza las 3 consultas complejas)
    const result = await pool.request()
      .input('idActividadEquipo', sql.Int, idActividadEquipo)
      .execute('sp_ObtenerCalificacionesIntegrantesEquipo');

    // 📊 EXTRAER LOS DOS CONJUNTOS DE RESULTADOS
    const integrantesData = result.recordsets[0]; // Primer SELECT: datos principales
    const calificacionesDetalladas = result.recordsets[1]; // Segundo SELECT: calificaciones por criterio

    // Obtener valor total del instrumento (se puede inferir o agregar al SP)
    const valorTotal = 10; // Valor por defecto o se puede calcular desde los datos

    // 📊 ESTRUCTURAR DATOS POR INTEGRANTE (misma lógica que antes)
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

    // 🎯 CALCULAR ESTADÍSTICAS DEL EQUIPO (misma lógica que antes)
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

    // 🎯 RESPUESTA ESTRUCTURADA (misma estructura que antes)
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

// Función 2: Comparativa equipo vs individuales (opcional, para análisis avanzado)
const obtenerComparativaEquipoIndividual = async (req, res) => {
  const { idActividadEquipo } = req.params;

  try {
    const pool = await sql.connect(config);
    
    console.log(`📊 Generando comparativa equipo vs individual para ID: ${idActividadEquipo}`);

    // 🚀 EJECUTAR EL STORED PROCEDURE
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

    // 🚀 EJECUTAR EL STORED PROCEDURE (reemplaza toda la CTE súper compleja)
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
// ===============================================
// EXPORTS COMPLETOS ACTUALIZADOS Y CORREGIDOS
// ===============================================
module.exports = {
  // Funciones básicas del docente
  obtenerDatosDocente,
  obtenerPerfilDocente,
  cambiarContrasenaDocente,
  
  // Funciones de materias
  obtenerMateriasPorDocente,
  obtenerMateriasCompletas,
  obtenerPeriodoActual,
  obtenerPeriodosDocente,
  obtenerMateriasCompletasPorPeriodo,
  
  // 🆕 Funciones CRUD de componentes/ponderación
  obtenerComponentesPorMateria,
  crearComponente,
  modificarComponente,
  eliminarComponente,
  validarSumaComponentes,
  obtenerComponentesParaDropdown,
  validarComplecionParcial,
  obtenerEstadisticasGeneralesDocente,
  clonarComponentesParcial,
  
  // Funciones de grupos y actividades
  obtenerGruposPorMateriaDocente,
  obtenerListasCotejo,
  obtenerActividadesPorGrupo, // 🔧 OPTIMIZADA CON ESTADOS V2
  obtenerEstadisticasGrupo, // 🔧 OPTIMIZADA CON ESTADOS V2
  
  // 🔧 Funciones de creación de actividades - CORREGIDAS
  crearActividad, // 🔧 CORREGIDA SIN id_estado_actividad + CON ASIGNACIÓN DE ESTADOS
  crearActividadCompletaConComponente, // 🔧 COMPLETAMENTE CORREGIDA
  
  // Funciones de manejo de equipos
  obtenerEquiposPorGrupo,
  obtenerAlumnosPorGrupo,
  simularEquiposAleatorios,
  obtenerActividadesConEquiposPorGrupo,

  // 🔧 Funciones de calificación - CORREGIDAS CON ACTUALIZACIÓN DE ESTADOS
  obtenerDatosActividad,
  obtenerCriteriosActividad,
  obtenerAlumnosParaCalificar, // 🔧 INCLUYE ESTADOS
  obtenerEquiposParaCalificar, // 🔧 INCLUYE ESTADOS
  obtenerCalificacionesAlumno,
  obtenerCalificacionesEquipo,
  guardarCalificacionesAlumno, // 🔧 ACTUALIZA ESTADO A "ENTREGADO"
  guardarCalificacionesEquipo, // 🔧 ACTUALIZA ESTADO A "ENTREGADO"

  // Funciones de observaciones
  guardarObservacionAlumno,
  guardarObservacionEquipo,
  obtenerObservacionAlumno,
  obtenerObservacionEquipo,
  obtenerComparativaEquipoIndividual,
  obtenerCalificacionesIntegrantesEquipo,

  // Funciones de procedimientos almacenados
  obtenerConcentradoFinal,
  obtenerCalificacionesActividad,
  obtenerEstadisticasCentroControl
};