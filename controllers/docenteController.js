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
      .query(`
        SELECT TOP 1 
          vchNombre + ' ' + vchAPaterno + ' ' + vchAMaterno AS nombre
        FROM dbo.tbl_docentes
        WHERE RTRIM(vchClvTrabajador) = RTRIM(@clave)
      `);

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
      .query(`
        SELECT DISTINCT 
          RTRIM(d.vchNombre) + ' ' + RTRIM(d.vchAPaterno) + ' ' + RTRIM(d.vchAMaterno) AS nombreCompleto,
          m.vchClvMateria AS claveMateria,
          m.vchNomMateria AS nombreMateria
        FROM dbo.tbl_docentes d
        JOIN dbo.tbl_docente_materia dm ON RTRIM(d.vchClvTrabajador) = RTRIM(dm.vchClvTrabajador)
        JOIN dbo.tbl_materias m ON dm.vchClvMateria = m.vchClvMateria
        WHERE RTRIM(d.vchClvTrabajador) = RTRIM(@clave)
      `);

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
      .query(`
        SELECT DISTINCT
          m.vchClvMateria,
          m.vchNomMateria AS nombreMateria
        FROM tbl_docente_materia dm
        JOIN tbl_materias m ON dm.vchClvMateria = m.vchClvMateria
        WHERE dm.vchClvTrabajador = @clave
      `);

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
    const periodoActualResult = await pool.request().query(`
      SELECT TOP 1 Periodo 
      FROM tbl_docente_materia 
      ORDER BY Periodo DESC
    `);
    
    if (periodoActualResult.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'No se encontraron periodos asignados' });
    }
    
    const periodoActual = periodoActualResult.recordset[0].Periodo;
    console.log(`🗓️ Filtrando materias por periodo actual: ${periodoActual}`);

    const result = await pool.request()
      .input('clave', sql.VarChar, clave)
      .input('periodoActual', sql.VarChar, periodoActual)
      .query(`
        SELECT DISTINCT
          m.vchClvMateria,
          m.vchNomMateria AS nombreMateria,
          COUNT(DISTINCT g.id_grupo) AS totalGrupos,
          COUNT(DISTINCT a.vchMatricula) AS totalAlumnos,
          dm.vchCuatrimestre,
          dm.Periodo
        FROM tbl_docente_materia dm
        JOIN tbl_materias m ON dm.vchClvMateria = m.vchClvMateria
        LEFT JOIN tbl_docente_materia_grupo dmg ON dm.idDocenteMateria = dmg.id_DocenteMateria
        LEFT JOIN tbl_grupos g ON dmg.id_grupo = g.id_grupo
        LEFT JOIN tblAlumnos a ON a.chvGrupo = g.id_grupo
          AND a.vchClvCuatri = dm.vchCuatrimestre
          AND a.vchPeriodo = dm.Periodo
        WHERE dm.vchClvTrabajador = @clave
          AND dm.Periodo = @periodoActual
        GROUP BY m.vchClvMateria, m.vchNomMateria, dm.vchCuatrimestre, dm.Periodo
        ORDER BY m.vchNomMateria
      `);

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
const obtenerPeriodoActual = async (req, res) => {
  try {
    const pool = await sql.connect(config);
    
    // Obtener el periodo más reciente
    const periodoResult = await pool.request().query(`
      SELECT TOP 1 Periodo 
      FROM tbl_docente_materia 
      ORDER BY Periodo DESC
    `);
    
    if (periodoResult.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'No se encontraron periodos' });
    }

    const periodoActual = periodoResult.recordset[0].Periodo;
    
    // Extraer año y cuatrimestre del periodo
    const año = periodoActual.toString().substring(0, 4);
    const cuatrimestreNumero = periodoActual.toString().substring(4, 5);
    
    // Obtener información del cuatrimestre desde tbl_periodos
    const cuatrimestreInfo = await pool.request()
      .input('idPeriodo', sql.Int, parseInt(cuatrimestreNumero))
      .query(`
        SELECT mesInicia, mesTermina 
        FROM tbl_periodos 
        WHERE idPeriodo = @idPeriodo
      `);

    const infoCompleta = {
      periodoActual,
      año,
      cuatrimestreNumero,
      descripcion: `Año ${año}, Cuatrimestre ${cuatrimestreNumero}`,
      ...(cuatrimestreInfo.recordset.length > 0 && {
        mesInicia: cuatrimestreInfo.recordset[0].mesInicia,
        mesTermina: cuatrimestreInfo.recordset[0].mesTermina
      })
    };

    res.json(infoCompleta);

  } catch (err) {
    console.error('❌ Error al obtener periodo actual:', err);
    res.status(500).json({ mensaje: 'Error en el servidor' });
  }
};

// Obtener grupos que atiende el docente en una materia
const obtenerGruposPorMateriaDocente = async (req, res) => {
  const { clave, clvMateria } = req.params;

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('clave', sql.VarChar, clave)
      .input('clvMateria', sql.VarChar, clvMateria)
      .query(`
        SELECT 
          g.id_grupo AS idGrupo,
          g.vchGrupo,
          COUNT(a.vchMatricula) AS totalAlumnos
        FROM dbo.tbl_docente_materia AS dm
        JOIN dbo.tbl_docente_materia_grupo AS dmg 
          ON dm.idDocenteMateria = dmg.id_DocenteMateria
        JOIN dbo.tbl_grupos AS g 
          ON dmg.id_grupo = g.id_grupo
        LEFT JOIN dbo.tblAlumnos AS a 
          ON a.chvGrupo = g.id_grupo
          AND a.vchClvCuatri = dm.vchCuatrimestre
          AND a.vchPeriodo = dm.Periodo
        WHERE dm.vchClvTrabajador = @clave
          AND dm.vchClvMateria = @clvMateria
        GROUP BY g.id_grupo, g.vchGrupo
      `);

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
  const { claveMateria, parcial, periodo, claveDocente } = req.params;

  try {
    const pool = await sql.connect(config);
    
    console.log(`🔍 Buscando componentes: Materia=${claveMateria}, Parcial=${parcial}, Periodo=${periodo}, Docente=${claveDocente}`);

    const result = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parseInt(parcial))
      .input('vchPeriodo', sql.VarChar, periodo)
      .input('claveDocente', sql.VarChar, claveDocente)
      .query(`
        SELECT 
          id_valor_componente,
          componente AS nombre_componente,
          valor_componente,
          vchClvMateria,
          parcial,
          vchPeriodo,
          vchClvTrabajador
        FROM tbl_valor_componentes_evaluacion
        WHERE vchClvMateria = @claveMateria 
          AND parcial = @parcial 
          AND vchPeriodo = @vchPeriodo 
          AND vchClvTrabajador = @claveDocente
        ORDER BY id_valor_componente
      `);

    // Calcular suma total de valores
    const sumaTotal = result.recordset.reduce((suma, comp) => suma + (comp.valor_componente || 0), 0);

    console.log(`✅ Componentes encontrados: ${result.recordset.length}, Suma total: ${sumaTotal}%`);
    
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
      // 🆕 ESTADÍSTICAS ADICIONALES
      estadisticas: {
        totalComponentes: result.recordset.length,
        mayorComponente: result.recordset.length > 0 ? Math.max(...result.recordset.map(c => c.valor_componente)) : 0,
        menorComponente: result.recordset.length > 0 ? Math.min(...result.recordset.map(c => c.valor_componente)) : 0,
        promedioComponente: result.recordset.length > 0 ? parseFloat((sumaTotal / result.recordset.length).toFixed(2)) : 0
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
    periodo, 
    claveDocente,
    nombreComponente,
    valorComponente 
  } = req.body;

  try {
    const pool = await sql.connect(config);
    
    console.log(`🆕 Creando componente: ${nombreComponente} - ${valorComponente}%`);

    // 1. 🛡️ VALIDACIONES BÁSICAS
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

    // 2. 🔍 VERIFICAR SUMA ACTUAL DE COMPONENTES EXISTENTES
    const sumaActualResult = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parseInt(parcial))
      .input('vchPeriodo', sql.VarChar, periodo)
      .input('claveDocente', sql.VarChar, claveDocente)
      .query(`
        SELECT 
          ISNULL(SUM(valor_componente), 0) as sumaActual,
          COUNT(*) as totalComponentes
        FROM tbl_valor_componentes_evaluacion
        WHERE vchClvMateria = @claveMateria 
          AND parcial = @parcial 
          AND vchPeriodo = @vchPeriodo 
          AND vchClvTrabajador = @claveDocente
      `);

    const sumaActual = sumaActualResult.recordset[0].sumaActual;
    const totalComponentes = sumaActualResult.recordset[0].totalComponentes;
    const nuevaSuma = parseFloat((sumaActual + valor).toFixed(2));

    // 3. 🚨 VALIDACIONES AVANZADAS DE NEGOCIO
    
    // 3.1 No exceder 100%
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

    // 3.2 Validar que no sea un valor muy pequeño si ya hay componentes
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

    // 3.3 Validar límite de componentes por parcial
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

    // 4. 🔒 VERIFICAR NOMBRE ÚNICO - CONSULTA CORREGIDA
    const existeResult = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parseInt(parcial))
      .input('vchPeriodo', sql.VarChar, periodo)
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('nombreComponente', sql.NVarChar, nombreComponente.trim())
      .query(`
        SELECT 
          COUNT(*) as existe,
          MAX(componente) as nombreExistente
        FROM tbl_valor_componentes_evaluacion
        WHERE vchClvMateria = @claveMateria 
          AND parcial = @parcial 
          AND vchPeriodo = @vchPeriodo 
          AND vchClvTrabajador = @claveDocente
          AND LTRIM(RTRIM(UPPER(componente))) = LTRIM(RTRIM(UPPER(@nombreComponente)))
      `);

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
      .input('vchPeriodo', sql.VarChar, periodo)
      .input('nombreComponente', sql.NVarChar, nombreComponente.trim())
      .input('valorComponente', sql.Decimal(4,2), valor)
      .query(`
        INSERT INTO tbl_valor_componentes_evaluacion (
          vchClvMateria, parcial, vchClvTrabajador, 
          vchPeriodo, componente, valor_componente
        )
        VALUES (
          @claveMateria, @parcial, @claveDocente, 
          @vchPeriodo, @nombreComponente, @valorComponente
        )
      `);

    console.log(`✅ Componente creado: ${nombreComponente} - ${valor}%`);
    console.log(`📊 Nueva suma total: ${nuevaSuma}%`);

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
      }
    };

    // 🔮 RECOMENDACIONES INTELIGENTES
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
      .query(`
        SELECT 
          vchClvMateria, parcial, vchClvTrabajador, vchPeriodo,
          componente, valor_componente
        FROM tbl_valor_componentes_evaluacion
        WHERE id_valor_componente = @idComponente
      `);

    if (componenteActualResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Componente no encontrado' });
    }

    const componenteActual = componenteActualResult.recordset[0];

    // 3. 🚨 VERIFICAR SI EL COMPONENTE ESTÁ SIENDO USADO EN ACTIVIDADES
    const actividadesResult = await pool.request()
      .input('idComponente', sql.Int, parseInt(idComponente))
      .query(`
        SELECT 
          COUNT(*) as totalActividades,
          STRING_AGG(a.titulo, ', ') as titulosActividades
        FROM tbl_actividades a
        WHERE a.id_valor_componente = @idComponente
      `);

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
      .query(`
        SELECT 
          ISNULL(SUM(valor_componente), 0) as sumaOtros,
          COUNT(*) as otrosComponentes
        FROM tbl_valor_componentes_evaluacion
        WHERE vchClvMateria = @claveMateria 
          AND parcial = @parcial 
          AND vchPeriodo = @vchPeriodo 
          AND vchClvTrabajador = @claveDocente
          AND id_valor_componente != @idComponente
      `);

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
        .query(`
          SELECT COUNT(*) as existe
          FROM tbl_valor_componentes_evaluacion
          WHERE vchClvMateria = @claveMateria 
            AND parcial = @parcial 
            AND vchPeriodo = @vchPeriodo 
            AND vchClvTrabajador = @claveDocente
            AND LTRIM(RTRIM(UPPER(componente))) = LTRIM(RTRIM(UPPER(@nombreComponente)))
            AND id_valor_componente != @idComponente
        `);

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
      .query(`
        UPDATE tbl_valor_componentes_evaluacion 
        SET componente = @nombreComponente,
            valor_componente = @valorComponente
        WHERE id_valor_componente = @idComponente
      `);

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
      .query(`
        SELECT 
          componente, valor_componente,
          vchClvMateria, parcial, vchClvTrabajador, vchPeriodo
        FROM tbl_valor_componentes_evaluacion
        WHERE id_valor_componente = @idComponente
      `);

    if (componenteResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Componente no encontrado' });
    }

    const componente = componenteResult.recordset[0];

    // 2. 🚨 VERIFICACIÓN CRÍTICA: ACTIVIDADES ASOCIADAS
    const actividadesResult = await pool.request()
      .input('idComponente', sql.Int, parseInt(idComponente))
      .query(`
        SELECT 
          COUNT(*) as totalActividades,
          STRING_AGG(a.titulo, ', ') as titulosActividades,
          STRING_AGG(CAST(a.id_actividad AS VARCHAR), ',') as idsActividades
        FROM tbl_actividades a
        WHERE a.id_valor_componente = @idComponente
      `);

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
      .query(`
        SELECT 
          ISNULL(SUM(valor_componente), 0) as sumaTotal,
          COUNT(*) as totalComponentes
        FROM tbl_valor_componentes_evaluacion
        WHERE vchClvMateria = @claveMateria 
          AND parcial = @parcial 
          AND vchPeriodo = @vchPeriodo 
          AND vchClvTrabajador = @claveDocente
      `);

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
      .query(`
        DELETE FROM tbl_valor_componentes_evaluacion
        WHERE id_valor_componente = @idComponente
      `);

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
      .query(`
        SELECT 
          COUNT(*) as totalComponentes,
          ISNULL(SUM(valor_componente), 0) as sumaTotal,
          STRING_AGG(CONCAT(componente, ' (', valor_componente, '%)'), ', ') as detalleComponentes,
          MIN(valor_componente) as menorValor,
          MAX(valor_componente) as mayorValor,
          AVG(valor_componente) as promedioValor
        FROM tbl_valor_componentes_evaluacion
        WHERE vchClvMateria = @claveMateria 
          AND parcial = @parcial 
          AND vchPeriodo = @vchPeriodo 
          AND vchClvTrabajador = @claveDocente
      `);

    const datos = result.recordset[0];
    const sumaTotal = parseFloat(datos.sumaTotal.toFixed(2));

    // Verificar actividades que usan estos componentes
    const actividadesResult = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parseInt(parcial))
      .input('vchPeriodo', sql.VarChar, periodo)
      .input('claveDocente', sql.VarChar, claveDocente)
      .query(`
        SELECT COUNT(DISTINCT a.id_actividad) as totalActividades
        FROM tbl_actividades a
        INNER JOIN tbl_valor_componentes_evaluacion vce ON a.id_valor_componente = vce.id_valor_componente
        WHERE vce.vchClvMateria = @claveMateria 
          AND vce.parcial = @parcial 
          AND vce.vchPeriodo = @vchPeriodo 
          AND vce.vchClvTrabajador = @claveDocente
      `);

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
      .query(`
        SELECT 
          vchClvMateria,
          parcial,
          COUNT(*) as totalComponentes,
          SUM(valor_componente) as sumaTotal,
          CASE 
            WHEN SUM(valor_componente) = 100 THEN 'completo'
            WHEN SUM(valor_componente) > 100 THEN 'excedido'
            WHEN SUM(valor_componente) < 50 THEN 'muy_incompleto'
            ELSE 'incompleto'
          END as estado
        FROM tbl_valor_componentes_evaluacion
        WHERE vchClvTrabajador = @claveDocente
        GROUP BY vchClvMateria, parcial
        ORDER BY vchClvMateria, parcial
      `);

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
const clonarComponentesParcial = async (req, res) => {
  const { 
    claveMateria, 
    parcialOrigen, 
    parcialDestino, 
    periodo, 
    claveDocente 
  } = req.body;

  try {
    const pool = await sql.connect(config);

    // Verificar que el parcial origen tenga componentes
    const componentesOrigenResult = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcialOrigen', sql.Int, parcialOrigen)
      .input('vchPeriodo', sql.VarChar, periodo)
      .input('claveDocente', sql.VarChar, claveDocente)
      .query(`
        SELECT componente, valor_componente
        FROM tbl_valor_componentes_evaluacion
        WHERE vchClvMateria = @claveMateria 
          AND parcial = @parcialOrigen 
          AND vchPeriodo = @vchPeriodo 
          AND vchClvTrabajador = @claveDocente
      `);

    if (componentesOrigenResult.recordset.length === 0) {
      return res.status(400).json({ 
        error: `El parcial ${parcialOrigen} no tiene componentes para clonar` 
      });
    }

    // Verificar que el parcial destino esté vacío
    const componentesDestinoResult = await pool.request()
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcialDestino', sql.Int, parcialDestino)
      .input('vchPeriodo', sql.VarChar, periodo)
      .input('claveDocente', sql.VarChar, claveDocente)
      .query(`
        SELECT COUNT(*) as existe
        FROM tbl_valor_componentes_evaluacion
        WHERE vchClvMateria = @claveMateria 
          AND parcial = @parcialDestino 
          AND vchPeriodo = @vchPeriodo 
          AND vchClvTrabajador = @claveDocente
      `);

    if (componentesDestinoResult.recordset[0].existe > 0) {
      return res.status(400).json({ 
        error: `El parcial ${parcialDestino} ya tiene componentes. Elimínalos primero.` 
      });
    }

    // Clonar componentes
    const componentesClonados = [];
    for (const componente of componentesOrigenResult.recordset) {
      await pool.request()
        .input('claveMateria', sql.VarChar, claveMateria)
        .input('parcialDestino', sql.Int, parcialDestino)
        .input('claveDocente', sql.VarChar, claveDocente)
        .input('vchPeriodo', sql.VarChar, periodo)
        .input('nombreComponente', sql.NVarChar, componente.componente)
        .input('valorComponente', sql.Decimal(4,2), componente.valor_componente)
        .query(`
          INSERT INTO tbl_valor_componentes_evaluacion (
            vchClvMateria, parcial, vchClvTrabajador, 
            vchPeriodo, componente, valor_componente
          )
          VALUES (
            @claveMateria, @parcialDestino, @claveDocente, 
            @vchPeriodo, @nombreComponente, @valorComponente
          )
        `);

      componentesClonados.push({
        nombre: componente.componente,
        valor: componente.valor_componente
      });
    }

    res.json({
      mensaje: `✅ Componentes clonados de Parcial ${parcialOrigen} a Parcial ${parcialDestino}`,
      componentesClonados,
      total: componentesClonados.length,
      sumaTotal: componentesClonados.reduce((sum, c) => sum + c.valor, 0)
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
      .query(`
        SELECT 
          COUNT(*) as totalComponentes,
          ISNULL(SUM(valor_componente), 0) as sumaTotal,
          STRING_AGG(
            CONCAT(componente, ' (', valor_componente, '%)'), 
            ', '
          ) as detalleComponentes
        FROM tbl_valor_componentes_evaluacion
        WHERE vchClvMateria = @claveMateria 
          AND parcial = @parcial 
          AND vchPeriodo = @vchPeriodo 
          AND vchClvTrabajador = @claveDocente
      `);

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
      .query(`
        SELECT 
          id_valor_componente,
          componente as nombre_componente,
          valor_componente
        FROM tbl_valor_componentes_evaluacion
        WHERE vchClvTrabajador = @claveDocente
          AND vchClvMateria = @claveMateria
          AND parcial = @parcial
          AND vchPeriodo = @vchPeriodo
        ORDER BY componente
      `);

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

  const transaction = new sql.Transaction();

  try {
    const pool = await sql.connect(config);
    await transaction.begin();
    
    console.log('🚀 Iniciando creación de actividad...');
    console.log('📅 fechaEntrega recibida del frontend:', fechaEntrega);

    // ===============================================
    // 🇲🇽 PASO 1: PROCESAR FECHA COMO HORA LOCAL 
    // ===============================================
    let fechaEntregaParaSQL;
    let fechaCreacionParaSQL;
    let fechaAsignacionParaSQL;

    try {
      const ahoraCDMX = new Date();
      
      if (typeof fechaEntrega === 'string') {
        const match = fechaEntrega.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
        
        if (match) {
          const [, año, mes, dia, hora, minuto] = match;
          
          fechaEntregaParaSQL = new Date(
            parseInt(año),
            parseInt(mes) - 1,
            parseInt(dia),
            parseInt(hora),
            parseInt(minuto),
            0,
            0
          );
          
          console.log('✅ Procesamiento de fecha:');
          console.log(`   📅 Recibida del frontend: ${fechaEntrega}`);
          console.log(`   📅 Fecha JS creada: ${fechaEntregaParaSQL}`);
          console.log(`   🕐 Hora final: ${fechaEntregaParaSQL.getHours()}:${fechaEntregaParaSQL.getMinutes()}`);
          
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
      await transaction.rollback();
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
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'Faltan datos requeridos (instrumento o componente)'
      });
    }

    // ===============================================
    // 🇲🇽 PASO 2: CREAR ACTIVIDAD CON FECHAS LOCALES
    // ===============================================
    const numeroResult = await transaction.request().query(`
      SELECT ISNULL(MAX(numero_actividad), 0) + 1 AS siguiente FROM tbl_actividades
    `);
    const numeroActividad = numeroResult.recordset[0].siguiente;

    const fechaCreacionString = formatearFechaParaSQL(fechaCreacionParaSQL);
    console.log(`🔧 Fecha creación como string SIN UTC: ${fechaCreacionString}`);

    // 🔧 ELIMINAR REFERENCIAS A id_estado_actividad
    await transaction.request()
      .input('titulo', sql.NVarChar, titulo)
      .input('descripcion', sql.NVarChar, descripcion)
      .input('fechaCreacion', sql.VarChar, fechaCreacionString)
      .input('docente', sql.VarChar, claveDocente)
      .input('idInstrumento', sql.Int, idInstrumento)
      .input('idValorComponente', sql.Int, idValorComponente)
      .input('numero', sql.Int, numeroActividad)
      .input('modalidad', sql.Int, modalidad)
      .query(`
        INSERT INTO tbl_actividades (
          titulo, descripcion, fecha_creacion, vchClvTrabajador,
          id_instrumento, id_valor_componente, 
          numero_actividad, id_modalidad
        )
        VALUES (@titulo, @descripcion, CAST(@fechaCreacion AS DATETIME), @docente, 
                @idInstrumento, @idValorComponente, @numero, @modalidad)
      `);

    // Obtener ID de actividad
    const actividadResult = await transaction.request()
      .input('docente', sql.VarChar, claveDocente)
      .input('numero', sql.Int, numeroActividad)
      .query(`
        SELECT TOP 1 id_actividad 
        FROM tbl_actividades 
        WHERE vchClvTrabajador = @docente 
          AND numero_actividad = @numero 
        ORDER BY id_actividad DESC
      `);

    const idActividad = actividadResult.recordset[0].id_actividad;
    console.log('✅ Actividad creada con ID:', idActividad);

    // ===============================================
    // 🇲🇽 PASO 3: ASIGNAR A GRUPOS CON FECHAS LOCALES
    // ===============================================
    for (const claveGrupo of grupos) {
      const grupoQuery = await pool.request()
        .input('clave', sql.VarChar, claveGrupo)
        .query('SELECT TOP 1 id_grupo FROM tbl_grupos WHERE vchGrupo = @clave');

      if (grupoQuery.recordset.length === 0) continue;
      const idGrupo = grupoQuery.recordset[0].id_grupo;

      console.log(`🇲🇽 Insertando fechas LOCALES para grupo ${claveGrupo}:`);
      console.log(`   📅 fechaAsignacion: ${fechaAsignacionParaSQL.toLocaleString('es-MX')}`);
      console.log(`   📅 fechaEntrega: ${fechaEntregaParaSQL.toLocaleString('es-MX')}`);

      const fechaAsignacionString = formatearFechaParaSQL(fechaAsignacionParaSQL);
      const fechaEntregaString = formatearFechaParaSQL(fechaEntregaParaSQL);

      await transaction.request()
        .input('idActividad', sql.Int, idActividad)
        .input('idGrupo', sql.Int, idGrupo)
        .input('fechaAsignacion', sql.VarChar, fechaAsignacionString)
        .input('fechaEntrega', sql.VarChar, fechaEntregaString)
        .query(`
          INSERT INTO tbl_actividad_grupo (id_actividad, id_grupo, fecha_asignacion, fecha_entrega)
          VALUES (@idActividad, @idGrupo, CAST(@fechaAsignacion AS DATETIME), CAST(@fechaEntrega AS DATETIME))
        `);
      
      console.log(`✅ Grupo ${claveGrupo} asignado con fechas LOCALES`);
    }

    // ===============================================
    // 🆕 PASO 4: ASIGNAR ALUMNOS/EQUIPOS CON ESTADOS INICIALES
    // ===============================================
    
    if (modalidad === 1) {
      // 👤 MODALIDAD INDIVIDUAL: Asignar todos los alumnos de los grupos
      console.log('👤 Asignando alumnos individuales...');
      
      for (const claveGrupo of grupos) {
        const grupoQuery = await pool.request()
          .input('clave', sql.VarChar, claveGrupo)
          .query('SELECT TOP 1 id_grupo FROM tbl_grupos WHERE vchGrupo = @clave');

        if (grupoQuery.recordset.length === 0) continue;
        const idGrupo = grupoQuery.recordset[0].id_grupo;

        // 🔍 Obtener periodo y cuatrimestre para filtrar alumnos
        const periodoResult = await pool.request()
          .input('claveDocente', sql.VarChar, claveDocente)
          .input('claveMateria', sql.VarChar, claveMateria)
          .query(`
            SELECT TOP 1 vchCuatrimestre, Periodo 
            FROM tbl_docente_materia 
            WHERE vchClvTrabajador = @claveDocente 
              AND vchClvMateria = @claveMateria
            ORDER BY Periodo DESC
          `);

        if (periodoResult.recordset.length === 0) continue;
        const { vchCuatrimestre, Periodo } = periodoResult.recordset[0];

        // 🎯 Obtener alumnos del grupo y asignarlos con estado PENDIENTE
        const alumnosResult = await transaction.request()
          .input('idGrupo', sql.Int, idGrupo)
          .input('cuatrimestre', sql.VarChar, vchCuatrimestre)
          .input('periodo', sql.VarChar, Periodo)
          .query(`
            SELECT vchMatricula
            FROM tblAlumnos
            WHERE chvGrupo = @idGrupo
              AND vchClvCuatri = @cuatrimestre
              AND vchPeriodo = @periodo
          `);

        // 🎯 ASIGNAR CADA ALUMNO CON ESTADO INICIAL = PENDIENTE
        for (const alumno of alumnosResult.recordset) {
          await transaction.request()
            .input('idActividad', sql.Int, idActividad)
            .input('matricula', sql.VarChar, alumno.vchMatricula)
            .input('idEstado', sql.Int, 1) // 🎯 1 = PENDIENTE
            .query(`
              INSERT INTO tbl_actividad_alumno (id_actividad, vchMatricula, id_estado)
              VALUES (@idActividad, @matricula, @idEstado)
            `);
        }

        console.log(`✅ Asignados ${alumnosResult.recordset.length} alumnos del grupo ${claveGrupo}`);
      }
      
    } else if (modalidad === 2) {
      // 👥 MODALIDAD EQUIPO: Procesar equipos
      console.log('👥 Procesando equipos...');
      
      for (const [claveGrupo, datosGrupo] of Object.entries(equiposPorGrupo)) {
        const grupoQuery = await pool.request()
          .input('clave', sql.VarChar, claveGrupo)
          .query('SELECT TOP 1 id_grupo FROM tbl_grupos WHERE vchGrupo = @clave');

        if (grupoQuery.recordset.length === 0) continue;
        const idGrupo = grupoQuery.recordset[0].id_grupo;

        let equiposParaAsignar = [];
        
        // 🔧 CASO 1: Usar equipos de actividad anterior
        if (datosGrupo.tipoSeleccion === 'actividad' && datosGrupo.idActividadAnterior) {
          console.log(`📋 Usando equipos de actividad anterior: ${datosGrupo.idActividadAnterior}`);
          
          const equiposAnteriores = await pool.request()
            .input('idActividadAnterior', sql.Int, datosGrupo.idActividadAnterior)
            .query(`
              SELECT ae.id_equipo
              FROM tbl_actividad_equipo ae
              WHERE ae.id_actividad = @idActividadAnterior
            `);

          equiposParaAsignar = equiposAnteriores.recordset.map(e => e.id_equipo);
          console.log(`✅ Encontrados ${equiposParaAsignar.length} equipos de actividad anterior`);

        // 🔧 CASO 2: Crear equipos nuevos
        } else if ((datosGrupo.tipoSeleccion === 'aleatorio' || datosGrupo.tipoSeleccion === 'manual') && datosGrupo.equiposNuevos) {
          console.log(`📋 Creando ${datosGrupo.equiposNuevos.length} equipos nuevos`);
          
          for (const equipoNuevo of datosGrupo.equiposNuevos) {
            // 🔧 PASO 1: Crear equipo
            await transaction.request()
              .input('idGrupo', sql.Int, idGrupo)
              .input('nombreEquipo', sql.NVarChar, equipoNuevo.nombre)
              .query(`
                INSERT INTO tbl_equipos (id_grupo, nombre_equipo)
                VALUES (@idGrupo, @nombreEquipo)
              `);

            // 🔧 PASO 2: Obtener ID del equipo recién creado
            const equipoRecienCreado = await transaction.request()
              .input('idGrupo', sql.Int, idGrupo)
              .input('nombreEquipo', sql.NVarChar, equipoNuevo.nombre)
              .query(`
                SELECT TOP 1 id_equipo 
                FROM tbl_equipos 
                WHERE id_grupo = @idGrupo 
                  AND nombre_equipo = @nombreEquipo 
                ORDER BY id_equipo DESC
              `);

            const idEquipoCreado = equipoRecienCreado.recordset[0].id_equipo;

            // 🔧 PASO 3: Asignar integrantes al equipo en tabla separada
            for (const integrante of equipoNuevo.integrantes) {
              await transaction.request()
                .input('idEquipo', sql.Int, idEquipoCreado)
                .input('matricula', sql.VarChar, integrante.vchMatricula)
                .query(`
                  INSERT INTO tbl_equipo_alumno (id_equipo, vchMatricula)
                  VALUES (@idEquipo, @matricula)
                `);
            }

            equiposParaAsignar.push(idEquipoCreado);
            console.log(`✅ Equipo "${equipoNuevo.nombre}" creado con ${equipoNuevo.integrantes.length} integrantes`);
          }
        }

        // 🎯 ASIGNAR EQUIPOS A LA ACTIVIDAD CON ESTADO INICIAL = PENDIENTE
        for (const idEquipo of equiposParaAsignar) {
          await transaction.request()
            .input('idActividad', sql.Int, idActividad)
            .input('idEquipo', sql.Int, idEquipo)
            .input('idEstado', sql.Int, 1) // 🎯 1 = PENDIENTE
            .query(`
              INSERT INTO tbl_actividad_equipo (id_actividad, id_equipo, id_estado)
              VALUES (@idActividad, @idEquipo, @idEstado)
            `);
        }

        console.log(`✅ Asignados ${equiposParaAsignar.length} equipos del grupo ${claveGrupo}`);
      }
    }

    // ===============================================
    // 🔍 VERIFICACIÓN INMEDIATA EN BD
    // ===============================================
    const verificacion = await transaction.request()
      .input('idActividad', sql.Int, idActividad)
      .query(`
        SELECT TOP 1
          ag.fecha_entrega,
          DATEPART(year, ag.fecha_entrega) as año,
          DATEPART(month, ag.fecha_entrega) as mes,
          DATEPART(day, ag.fecha_entrega) as dia,
          DATEPART(hour, ag.fecha_entrega) as hora,
          DATEPART(minute, ag.fecha_entrega) as minuto,
          DATENAME(weekday, ag.fecha_entrega) as dia_semana,
          GETDATE() as hora_servidor_actual
        FROM tbl_actividad_grupo ag 
        WHERE ag.id_actividad = @idActividad
      `);

    const fechaGuardada = verificacion.recordset[0];
    console.log('🔍 VERIFICACIÓN CRÍTICA - Fecha en BD:');
    console.log(`   📅 Fecha completa en BD: ${fechaGuardada.fecha_entrega}`);
    console.log(`   🕐 Hora en BD: ${fechaGuardada.hora}:${fechaGuardada.minuto}`);
    console.log(`   📊 Día: ${fechaGuardada.dia_semana}`);
    
    // 🚨 VALIDACIÓN CRÍTICA
    const horaOriginal = parseInt(fechaEntrega.split(' ')[1].split(':')[0]);
    const minutoOriginal = parseInt(fechaEntrega.split(' ')[1].split(':')[1]);
    
    if (fechaGuardada.hora !== horaOriginal || fechaGuardada.minuto !== minutoOriginal) {
      console.error('❌ ERROR CRÍTICO: La hora/minuto cambió al guardar en BD');
      console.error(`   Hora original: ${horaOriginal}:${minutoOriginal}`);
      console.error(`   Hora guardada: ${fechaGuardada.hora}:${fechaGuardada.minuto}`);
    } else {
      console.log('✅ ÉXITO: La hora y minuto se guardaron correctamente');
      console.log(`   ✅ Hora original: ${horaOriginal}:${minutoOriginal}`);
      console.log(`   ✅ Hora guardada: ${fechaGuardada.hora}:${fechaGuardada.minuto}`);
    }

    // ===============================================
    // CONFIRMAR TRANSACCIÓN
    // ===============================================
    await transaction.commit();

    console.log('🎉 ¡Actividad creada correctamente con estados iniciales!');

    res.status(201).json({ 
      mensaje: 'Actividad creada correctamente con estados iniciales',
      actividad: {
        idActividad,
        titulo,
        modalidad: modalidad === 1 ? 'Individual' : 'Equipo',
        numeroActividad,
        componente: idValorComponente,
        estadosConfigurados: true,
        estadoInicial: 'Pendiente (1)'
      },
      debug: {
        fechaOriginal: fechaEntrega,
        fechaGuardada: fechaGuardada,
        horaOriginal: `${horaOriginal}:${minutoOriginal}`,
        horaGuardada: `${fechaGuardada.hora}:${fechaGuardada.minuto}`,
        coincideCompleta: fechaGuardada.hora === horaOriginal && fechaGuardada.minuto === minutoOriginal
      }
    });

  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error al crear actividad:', error);
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

  const transaction = new sql.Transaction();

  try {
    const pool = await sql.connect(config);
    await transaction.begin();

    // Buscar id_instrumento correspondiente
    const instrumentoQuery = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('parcial', sql.Int, parcial)
      .query(`
        SELECT TOP 1 id_instrumento
        FROM tbl_instrumento
        WHERE vchClvTrabajador = @claveDocente
          AND vchClvMateria = @claveMateria
          AND parcial = @parcial
      `);

    const instrumento = instrumentoQuery.recordset[0];
    if (!instrumento) {
      await transaction.rollback();
      return res.status(400).json({ error: 'No se encontró instrumento para este docente/materia/parcial' });
    }

    const idInstrumento = instrumento.id_instrumento;

    // Obtener número consecutivo para numero_actividad
    const numeroResult = await transaction.request().query(`
      SELECT ISNULL(MAX(numero_actividad), 0) + 1 AS siguiente FROM tbl_actividades
    `);
    const numeroActividad = numeroResult.recordset[0].siguiente;

    // 🔧 ELIMINAR REFERENCIAS A id_estado_actividad
    await transaction.request()
      .input('titulo', sql.NVarChar, titulo)
      .input('descripcion', sql.NVarChar, descripcion)
      .input('fecha', sql.DateTime, new Date())
      .input('docente', sql.VarChar, claveDocente)
      .input('idInstrumento', sql.Int, idInstrumento)
      .input('numero', sql.Int, numeroActividad)
      .input('modalidad', sql.Int, 1) // Por defecto individual
      .query(`
        INSERT INTO tbl_actividades (
          titulo, descripcion, fecha_creacion, vchClvTrabajador,
          id_instrumento, numero_actividad, id_modalidad
        )
        VALUES (@titulo, @descripcion, @fecha, @docente, @idInstrumento, @numero, @modalidad)
      `);

    // Obtener el ID de la actividad insertada
    const actividadResult = await transaction.request()
      .input('docente', sql.VarChar, claveDocente)
      .input('numero', sql.Int, numeroActividad)
      .query(`
        SELECT TOP 1 id_actividad 
        FROM tbl_actividades 
        WHERE vchClvTrabajador = @docente 
          AND numero_actividad = @numero 
        ORDER BY id_actividad DESC
      `);

    const idActividad = actividadResult.recordset[0].id_actividad;

    // Insertar actividad por grupo y asignar alumnos con estados
    for (const claveGrupo of grupos) {
      const grupoQuery = await pool.request()
        .input('clave', sql.VarChar, claveGrupo)
        .query('SELECT TOP 1 id_grupo FROM tbl_grupos WHERE vchGrupo = @clave');

      if (grupoQuery.recordset.length === 0) continue;

      const idGrupo = grupoQuery.recordset[0].id_grupo;

      // Insertar en tbl_actividad_grupo
      await transaction.request()
        .input('idActividad', sql.Int, idActividad)
        .input('idGrupo', sql.Int, idGrupo)
        .input('fechaAsignacion', sql.DateTime, new Date())
        .input('fechaEntrega', sql.DateTime, fechaEntrega)
        .query(`
          INSERT INTO tbl_actividad_grupo (id_actividad, id_grupo, fecha_asignacion, fecha_entrega)
          VALUES (@idActividad, @idGrupo, @fechaAsignacion, @fechaEntrega)
        `);

      // 🆕 ASIGNAR ALUMNOS CON ESTADOS INICIALES
      const periodoResult = await pool.request()
        .input('claveDocente', sql.VarChar, claveDocente)
        .input('claveMateria', sql.VarChar, claveMateria)
        .query(`
          SELECT TOP 1 vchCuatrimestre, Periodo 
          FROM tbl_docente_materia 
          WHERE vchClvTrabajador = @claveDocente 
            AND vchClvMateria = @claveMateria
          ORDER BY Periodo DESC
        `);

      if (periodoResult.recordset.length === 0) continue;
      const { vchCuatrimestre, Periodo } = periodoResult.recordset[0];

      const alumnosResult = await transaction.request()
        .input('idGrupo', sql.Int, idGrupo)
        .input('cuatrimestre', sql.VarChar, vchCuatrimestre)
        .input('periodo', sql.VarChar, Periodo)
        .query(`
          SELECT vchMatricula
          FROM tblAlumnos
          WHERE chvGrupo = @idGrupo
            AND vchClvCuatri = @cuatrimestre
            AND vchPeriodo = @periodo
        `);

      // Asignar cada alumno con estado PENDIENTE
      for (const alumno of alumnosResult.recordset) {
        await transaction.request()
          .input('idActividad', sql.Int, idActividad)
          .input('matricula', sql.VarChar, alumno.vchMatricula)
          .input('idEstado', sql.Int, 1) // 1 = PENDIENTE
          .query(`
            INSERT INTO tbl_actividad_alumno (id_actividad, vchMatricula, id_estado)
            VALUES (@idActividad, @matricula, @idEstado)
          `);
      }
    }

    await transaction.commit();
    res.status(201).json({ 
      mensaje: 'Actividad creada correctamente con estados iniciales', 
      idActividad,
      estadosConfigurados: true 
    });

  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error al crear actividad:', error);
    res.status(500).json({ mensaje: 'Error interno al registrar la actividad' });
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
      .query(`
        UPDATE tbl_actividad_alumno 
        SET observacion = @observacion 
        WHERE id_actividad_alumno = @idActividadAlumno
      `);

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
      .query(`
        UPDATE tbl_actividad_equipo 
        SET observacion = @observacion 
        WHERE id_actividad_equipo = @idActividadEquipo
      `);

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
      .query(`
        SELECT observacion 
        FROM tbl_actividad_alumno 
        WHERE id_actividad_alumno = @idActividadAlumno
      `);

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
      .query(`
        SELECT observacion 
        FROM tbl_actividad_equipo 
        WHERE id_actividad_equipo = @idActividadEquipo
      `);

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
      .query(`
        SELECT 
          id_instrumento,
          nombre,
          CONCAT('Parcial ', parcial, ' - ', nombre) AS descripcion
        FROM tbl_instrumento
        WHERE vchClvTrabajador = @claveDocente
          AND vchClvMateria = @claveMateria
        ORDER BY parcial, nombre
    `);

    res.json(result.recordset);
  } catch (error) {
    console.error('❌ Error al obtener listas de cotejo:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

// 🔧 FUNCIÓN OPTIMIZADA: obtenerActividadesPorGrupo - CON SISTEMA DE ESTADOS V2
const obtenerActividadesPorGrupo = async (req, res) => {
  const { claveDocente, claveMateria, idGrupo } = req.params;
  const { parcial, modalidad } = req.query;

  try {
    const pool = await sql.connect(config);
    
    let whereConditions = `
      WHERE i.vchClvTrabajador = @claveDocente
        AND i.vchClvMateria = @claveMateria
        AND ag.id_grupo = @idGrupo
    `;
    
    if (parcial) whereConditions += ` AND i.parcial = @parcial`;
    if (modalidad) whereConditions += ` AND a.id_modalidad = @modalidad`;

    const request = pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('idGrupo', sql.Int, idGrupo);
    
    if (parcial) request.input('parcial', sql.Int, parcial);
    if (modalidad) request.input('modalidad', sql.Int, modalidad);

    const result = await request.query(`
      SELECT 
        a.id_actividad,
        a.titulo,
        a.descripcion,
        a.fecha_creacion,
        a.numero_actividad,
        ISNULL(a.id_modalidad, 1) as id_modalidad,
        ag.fecha_asignacion,
        ag.fecha_entrega,
        i.parcial,
        ISNULL(i.nombre, 'Sin nombre') AS nombre_instrumento,
        g.vchGrupo,
        vce.componente as nombre_componente,
        
        -- 🎯 USAR ESTADOS DIRECTAMENTE DE LAS TABLAS
        CASE 
          WHEN ISNULL(a.id_modalidad, 1) = 1 THEN 
            -- Modalidad individual: contar por estados
            (SELECT COUNT(*) FROM tbl_actividad_alumno aa WHERE aa.id_actividad = a.id_actividad)
          WHEN ISNULL(a.id_modalidad, 1) = 2 THEN 
            -- Modalidad equipo: contar equipos
            (SELECT COUNT(*) FROM tbl_actividad_equipo ae WHERE ae.id_actividad = a.id_actividad)
          ELSE 0
        END AS totalEntregas,
        
        -- 📊 ESTADÍSTICAS USANDO LOS NUEVOS ESTADOS
        CASE 
          WHEN ISNULL(a.id_modalidad, 1) = 1 THEN 
            -- Individual: alumnos PENDIENTES (estado = 1)
            (SELECT COUNT(*) FROM tbl_actividad_alumno aa WHERE aa.id_actividad = a.id_actividad AND aa.id_estado = 1)
          WHEN ISNULL(a.id_modalidad, 1) = 2 THEN 
            -- Equipo: equipos PENDIENTES (estado = 1)
            (SELECT COUNT(*) FROM tbl_actividad_equipo ae WHERE ae.id_actividad = a.id_actividad AND ae.id_estado = 1)
          ELSE 0
        END AS alumnosPendientes,
        
        -- ✅ ENTREGADOS A TIEMPO (estado = 2)
        CASE 
          WHEN ISNULL(a.id_modalidad, 1) = 1 THEN 
            (SELECT COUNT(*) FROM tbl_actividad_alumno aa WHERE aa.id_actividad = a.id_actividad AND aa.id_estado = 2)
          WHEN ISNULL(a.id_modalidad, 1) = 2 THEN 
            (SELECT COUNT(*) FROM tbl_actividad_equipo ae WHERE ae.id_actividad = a.id_actividad AND ae.id_estado = 2)
          ELSE 0
        END AS entregadosATiempo,
        
        -- ❌ NO ENTREGADOS (estado = 3)
        CASE 
          WHEN ISNULL(a.id_modalidad, 1) = 1 THEN 
            (SELECT COUNT(*) FROM tbl_actividad_alumno aa WHERE aa.id_actividad = a.id_actividad AND aa.id_estado = 3)
          WHEN ISNULL(a.id_modalidad, 1) = 2 THEN 
            (SELECT COUNT(*) FROM tbl_actividad_equipo ae WHERE ae.id_actividad = a.id_actividad AND ae.id_estado = 3)
          ELSE 0
        END AS noEntregados,
        
        -- 🕐 ENTREGADOS TARDE (estado = 4)
        CASE 
          WHEN ISNULL(a.id_modalidad, 1) = 1 THEN 
            (SELECT COUNT(*) FROM tbl_actividad_alumno aa WHERE aa.id_actividad = a.id_actividad AND aa.id_estado = 4)
          WHEN ISNULL(a.id_modalidad, 1) = 2 THEN 
            (SELECT COUNT(*) FROM tbl_actividad_equipo ae WHERE ae.id_actividad = a.id_actividad AND ae.id_estado = 4)
          ELSE 0
        END AS entregadosTarde,
        
        -- 🎯 ESTADO GENERAL DE LA ACTIVIDAD (calculado)
        CASE 
          -- Si ya pasó la fecha de entrega
          WHEN DATEDIFF(hour, GETDATE(), ag.fecha_entrega) < 0 THEN 
            CASE 
              WHEN (SELECT COUNT(*) FROM tbl_actividad_alumno aa WHERE aa.id_actividad = a.id_actividad AND aa.id_estado IN (3)) > 0 
                OR (SELECT COUNT(*) FROM tbl_actividad_equipo ae WHERE ae.id_actividad = a.id_actividad AND ae.id_estado IN (3)) > 0
              THEN 'vencida'
              WHEN (SELECT COUNT(*) FROM tbl_actividad_alumno aa WHERE aa.id_actividad = a.id_actividad AND aa.id_estado = 1) > 0 
                OR (SELECT COUNT(*) FROM tbl_actividad_equipo ae WHERE ae.id_actividad = a.id_actividad AND ae.id_estado = 1) > 0
              THEN 'pendiente_vencida'
              ELSE 'completada'
            END
          -- Si aún hay tiempo
          ELSE 
            CASE 
              WHEN (SELECT COUNT(*) FROM tbl_actividad_alumno aa WHERE aa.id_actividad = a.id_actividad AND aa.id_estado = 1) > 0 
                OR (SELECT COUNT(*) FROM tbl_actividad_equipo ae WHERE ae.id_actividad = a.id_actividad AND ae.id_estado = 1) > 0
              THEN 'activa'
              ELSE 'completada'
            END
        END AS estadoActividad,
        
        -- ⏰ DÍAS RESTANTES
        DATEDIFF(day, GETDATE(), ag.fecha_entrega) AS diasRestantes,
        
        -- 📈 PORCENTAJE DE COMPLETADO (basado en estados)
        CASE 
          WHEN ISNULL(a.id_modalidad, 1) = 1 THEN 
            CASE 
              WHEN (SELECT COUNT(*) FROM tbl_actividad_alumno aa WHERE aa.id_actividad = a.id_actividad) > 0
              THEN ROUND(
                (CAST((SELECT COUNT(*) FROM tbl_actividad_alumno aa WHERE aa.id_actividad = a.id_actividad AND aa.id_estado IN (2,4)) AS FLOAT) / 
                 CAST((SELECT COUNT(*) FROM tbl_actividad_alumno aa WHERE aa.id_actividad = a.id_actividad) AS FLOAT)) * 100, 1)
              ELSE 0
            END
          WHEN ISNULL(a.id_modalidad, 1) = 2 THEN 
            CASE 
              WHEN (SELECT COUNT(*) FROM tbl_actividad_equipo ae WHERE ae.id_actividad = a.id_actividad) > 0
              THEN ROUND(
                (CAST((SELECT COUNT(*) FROM tbl_actividad_equipo ae WHERE ae.id_actividad = a.id_actividad AND ae.id_estado IN (2,4)) AS FLOAT) / 
                 CAST((SELECT COUNT(*) FROM tbl_actividad_equipo ae WHERE ae.id_actividad = a.id_actividad) AS FLOAT)) * 100, 1)
              ELSE 0
            END
          ELSE 0
        END AS porcentajeCompletado

      FROM tbl_actividades a
      INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
      INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
      INNER JOIN tbl_grupos g ON ag.id_grupo = g.id_grupo
      LEFT JOIN tbl_valor_componentes_evaluacion vce ON a.id_valor_componente = vce.id_valor_componente
      ${whereConditions}
      ORDER BY i.parcial, a.numero_actividad DESC, a.fecha_creacion DESC
    `);

    // 🎯 PROCESAR RESULTADOS CON ESTADOS REALES
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

      // ✅ USAR ESTADO REAL CALCULADO
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
        
        // 📊 ESTADÍSTICAS DETALLADAS POR ESTADO
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

    // 🎯 ESTADÍSTICAS GLOBALES OPTIMIZADAS
    const estadisticasGlobales = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('idGrupo', sql.Int, idGrupo)
      .query(`
        WITH EstadisticasActividades AS (
          SELECT 
            a.id_actividad,
            -- Sumar alumnos/equipos PENDIENTES (estado = 1)
            CASE 
              WHEN ISNULL(a.id_modalidad, 1) = 1 THEN 
                (SELECT COUNT(*) FROM tbl_actividad_alumno aa WHERE aa.id_actividad = a.id_actividad AND aa.id_estado = 1)
              ELSE 
                (SELECT COUNT(*) FROM tbl_actividad_equipo ae WHERE ae.id_actividad = a.id_actividad AND ae.id_estado = 1)
            END AS pendientes,
            
            -- Verificar si ya venció
            CASE WHEN DATEDIFF(hour, GETDATE(), ag.fecha_entrega) < 0 THEN 1 ELSE 0 END AS yaVencio
            
          FROM tbl_actividades a
          INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
          INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
          WHERE i.vchClvTrabajador = @claveDocente
            AND i.vchClvMateria = @claveMateria
            AND ag.id_grupo = @idGrupo
        )
        
        SELECT 
          SUM(CASE WHEN pendientes = 0 THEN 1 ELSE 0 END) as actividadesCompletas,
          SUM(pendientes) as totalPendientes,
          SUM(CASE WHEN yaVencio = 1 AND pendientes > 0 THEN 1 ELSE 0 END) as actividadesVencidas,
          COUNT(*) as totalActividades
        FROM EstadisticasActividades
      `);

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
        sistemaEstados: 'optimizado_v2',
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
    
    // Verificar contraseña actual
    const verificarResult = await pool.request()
      .input('usuario', sql.VarChar, usuario)
      .input('contrasenaActual', sql.VarChar, contrasenaActual)
      .query(`
        SELECT vchClvTrabajador 
        FROM tbl_docentes 
        WHERE RTRIM(vchClvTrabajador) = RTRIM(@usuario) 
          AND vchContrasenia = @contrasenaActual
      `);

    if (verificarResult.recordset.length === 0) {
      return res.status(400).json({ mensaje: 'La contraseña actual es incorrecta' });
    }

    // Actualizar contraseña
    const updateResult = await pool.request()
      .input('usuario', sql.VarChar, usuario)
      .input('nuevaContrasena', sql.VarChar, nuevaContrasena)
      .query(`
        UPDATE tbl_docentes 
        SET vchContrasenia = @nuevaContrasena 
        WHERE RTRIM(vchClvTrabajador) = RTRIM(@usuario)
      `);

    if (updateResult.rowsAffected[0] > 0) {
      res.json({ mensaje: 'Contraseña actualizada correctamente' });
    } else {
      res.status(500).json({ mensaje: 'Error al actualizar la contraseña' });
    }

  } catch (err) {
    console.error('❌ Error al cambiar contraseña:', err);
    res.status(500).json({ mensaje: 'Error en el servidor' });
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
      .query(`
        SELECT 
          e.id_equipo,
          e.nombre_equipo,
          COUNT(ea.vchMatricula) as total_integrantes,
          STRING_AGG(
            CONCAT(a.vchNombre, ' ', a.vchAPaterno), 
            ', '
          ) as integrantes_nombres,
          STRING_AGG(ea.vchMatricula, ', ') as matriculas
        FROM tbl_equipos e
        LEFT JOIN tbl_equipo_alumno ea ON e.id_equipo = ea.id_equipo
        LEFT JOIN tblAlumnos a ON ea.vchMatricula = a.vchMatricula
        WHERE e.id_grupo = @idGrupo
        GROUP BY e.id_equipo, e.nombre_equipo
        ORDER BY e.nombre_equipo
      `);

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
    
    // Obtener periodo y cuatrimestre del docente-materia
    const periodoResult = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .query(`
        SELECT TOP 1 vchCuatrimestre, Periodo 
        FROM tbl_docente_materia 
        WHERE vchClvTrabajador = @claveDocente 
          AND vchClvMateria = @claveMateria
      `);

    if (periodoResult.recordset.length === 0) {
      return res.status(404).json({ error: 'No se encontró la relación docente-materia' });
    }

    const { vchCuatrimestre, Periodo } = periodoResult.recordset[0];

    // Obtener alumnos del grupo filtrados por periodo/cuatrimestre
    const result = await pool.request()
      .input('idGrupo', sql.Int, idGrupo)
      .input('cuatrimestre', sql.VarChar, vchCuatrimestre)
      .input('periodo', sql.VarChar, Periodo)
      .query(`
        SELECT 
          a.vchMatricula,
          CONCAT(a.vchNombre, ' ', a.vchAPaterno, ' ', a.vchAMaterno) as nombreCompleto,
          a.vchNombre,
          a.vchAPaterno,
          a.vchAMaterno
        FROM tblAlumnos a
        WHERE a.chvGrupo = @idGrupo
          AND a.vchClvCuatri = @cuatrimestre
          AND a.vchPeriodo = @periodo
        ORDER BY a.vchNombre, a.vchAPaterno
      `);

    res.json(result.recordset);
  } catch (error) {
    console.error('❌ Error al obtener alumnos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

// Simular equipos aleatorios (sin insertar en BD)
const simularEquiposAleatorios = async (req, res) => {
  const { idGrupo, cantidadEquipos, claveDocente, claveMateria } = req.body;

  try {
    const pool = await sql.connect(config);

    // Obtener alumnos disponibles
    const periodoResult = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .query(`
        SELECT TOP 1 vchCuatrimestre, Periodo 
        FROM tbl_docente_materia 
        WHERE vchClvTrabajador = @claveDocente 
          AND vchClvMateria = @claveMateria
      `);

    if (periodoResult.recordset.length === 0) {
      return res.status(404).json({ error: 'No se encontró la relación docente-materia' });
    }

    const { vchCuatrimestre, Periodo } = periodoResult.recordset[0];

    const alumnosResult = await pool.request()
      .input('idGrupo', sql.Int, idGrupo)
      .input('cuatrimestre', sql.VarChar, vchCuatrimestre)
      .input('periodo', sql.VarChar, Periodo)
      .query(`
        SELECT 
          vchMatricula,
          CONCAT(vchNombre, ' ', vchAPaterno, ' ', vchAMaterno) as nombreCompleto,
          vchNombre,
          vchAPaterno,
          vchAMaterno
        FROM tblAlumnos
        WHERE chvGrupo = @idGrupo
          AND vchClvCuatri = @cuatrimestre
          AND vchPeriodo = @periodo
        ORDER BY vchMatricula
      `);

    const alumnos = alumnosResult.recordset;
    
    if (alumnos.length === 0) {
      return res.status(400).json({ error: 'No hay alumnos disponibles' });
    }

    // Simular distribución aleatoria
    const alumnosAleatorios = [...alumnos].sort(() => Math.random() - 0.5);
    const alumnosPorEquipo = Math.floor(alumnos.length / cantidadEquipos);
    const alumnosSobrantes = alumnos.length % cantidadEquipos;

    const equiposSimulados = [];
    let indiceAlumno = 0;

    for (let i = 1; i <= cantidadEquipos; i++) {
      const integrantesEnEsteEquipo = alumnosPorEquipo + (i <= alumnosSobrantes ? 1 : 0);
      
      const integrantes = [];
      for (let j = 0; j < integrantesEnEsteEquipo; j++) {
        integrantes.push(alumnosAleatorios[indiceAlumno]);
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
    res.status(500).json({ error: 'Error del servidor' });
  }
};

// Obtener actividades anteriores con equipos por grupo
const obtenerActividadesConEquiposPorGrupo = async (req, res) => {
  const { claveDocente, claveMateria, idGrupo } = req.params;

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('idGrupo', sql.Int, idGrupo)
      .query(`
        SELECT 
          a.id_actividad,
          a.titulo,
          a.numero_actividad,
          i.parcial,
          COUNT(ae.id_equipo) as total_equipos,
          STRING_AGG(e.nombre_equipo, ', ') as nombres_equipos,
          STRING_AGG(CAST(e.id_equipo AS VARCHAR), ',') as ids_equipos
        FROM tbl_actividades a
        INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
        INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
        INNER JOIN tbl_actividad_equipo ae ON a.id_actividad = ae.id_actividad
        INNER JOIN tbl_equipos e ON ae.id_equipo = e.id_equipo
        WHERE i.vchClvTrabajador = @claveDocente
          AND i.vchClvMateria = @claveMateria
          AND ag.id_grupo = @idGrupo
          AND a.id_modalidad = 2
        GROUP BY a.id_actividad, a.titulo, a.numero_actividad, i.parcial
        ORDER BY a.numero_actividad DESC
      `);

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
    const result = await pool.request()
      .input('idActividad', sql.Int, idActividad)
      .query(`
        SELECT 
          a.id_actividad,
          a.titulo,
          a.descripcion,
          a.numero_actividad,
          a.id_modalidad,
          i.id_instrumento,
          i.nombre as nombre_instrumento,
          i.parcial,
          i.valor_total,
          ag.fecha_entrega,
          g.vchGrupo,
          m.vchNomMateria,
          -- 🔧 CORREGIDO: Obtener componente de la tabla correcta
          vce.componente as nombre_componente
        FROM tbl_actividades a
        INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
        INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
        INNER JOIN tbl_grupos g ON ag.id_grupo = g.id_grupo
        INNER JOIN tbl_materias m ON i.vchClvMateria = m.vchClvMateria
        -- 🔧 CORREGIDO: LEFT JOIN con la tabla correcta
        LEFT JOIN tbl_valor_componentes_evaluacion vce ON a.id_valor_componente = vce.id_valor_componente
        WHERE a.id_actividad = @idActividad
      `);

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
    
    // Primero obtener el instrumento de la actividad
    const instrumentoResult = await pool.request()
      .input('idActividad', sql.Int, idActividad)
      .query(`
        SELECT i.id_instrumento
        FROM tbl_actividades a
        INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
        WHERE a.id_actividad = @idActividad
      `);

    if (instrumentoResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Instrumento no encontrado' });
    }

    const idInstrumento = instrumentoResult.recordset[0].id_instrumento;

    // Obtener criterios del instrumento
    const criteriosResult = await pool.request()
      .input('idInstrumento', sql.Int, idInstrumento)
      .query(`
        SELECT 
          id_criterio,
          nombre,
          descripcion,
          valor_maximo
        FROM tbl_criterios
        WHERE id_instrumento = @idInstrumento
        ORDER BY id_criterio
      `);

    // Mapear los resultados con nombres consistentes
    const criterios = criteriosResult.recordset.map(criterio => ({
      id_criterio: criterio.id_criterio,
      nombre_criterio: criterio.nombre,
      descripcion: criterio.descripcion,
      valor_maximo: criterio.valor_maximo
    }));

    res.json(criterios);
  } catch (error) {
    console.error('❌ Error al obtener criterios:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

// Obtener equipos para calificar (modalidad equipo) - CÁLCULO COMPLETAMENTE CORREGIDO
const obtenerEquiposParaCalificar = async (req, res) => {
  const { idActividad } = req.params;

  try {
    const pool = await sql.connect(config);
    
    // Primero obtener el valor total del instrumento y todos los criterios
    const instrumentoResult = await pool.request()
      .input('idActividad', sql.Int, idActividad)
      .query(`
        SELECT 
          i.valor_total,
          SUM(c.valor_maximo) as suma_maxima_criterios
        FROM tbl_actividades a
        INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
        INNER JOIN tbl_criterios c ON i.id_instrumento = c.id_instrumento
        WHERE a.id_actividad = @idActividad
        GROUP BY i.valor_total
      `);
    
    const valorTotal = instrumentoResult.recordset[0]?.valor_total || 10;
    const sumaMaximaCriterios = instrumentoResult.recordset[0]?.suma_maxima_criterios || 10;

    const result = await pool.request()
      .input('idActividad', sql.Int, idActividad)
      .input('valorTotal', sql.Float, valorTotal)
      .input('sumaMaximaCriterios', sql.Float, sumaMaximaCriterios)
      .query(`
        SELECT 
          ae.id_actividad_equipo,
          e.id_equipo,
          e.nombre_equipo,
          ae.observacion,
          ae.id_estado, -- 🆕 INCLUIR ESTADO
          -- Integrantes del equipo
          STUFF((
            SELECT ', ' + al2.vchNombre + ' ' + ISNULL(al2.vchAPaterno, '')
            FROM tbl_equipo_alumno ea2
            INNER JOIN tblAlumnos al2 ON ea2.vchMatricula = al2.vchMatricula
            WHERE ea2.id_equipo = e.id_equipo
            FOR XML PATH('')
          ), 1, 2, '') as integrantes,
          (SELECT COUNT(*) FROM tbl_equipo_alumno ea3 WHERE ea3.id_equipo = e.id_equipo) as totalIntegrantes,
          -- Verificar si ya está calificado
          CASE 
            WHEN EXISTS (
              SELECT 1 FROM tbl_evaluacion_criterioActividadEquipo ece 
              WHERE ece.id_actividad_equipo = ae.id_actividad_equipo
            ) THEN 1 
            ELSE 0 
          END as yaCalificado,
          -- CÁLCULO CORREGIDO: Usar la suma total de TODOS los criterios del instrumento
          (SELECT 
             ROUND(SUM(CAST(ece2.calificacion AS FLOAT)) / @sumaMaximaCriterios * @valorTotal, 1)
           FROM tbl_evaluacion_criterioActividadEquipo ece2
           WHERE ece2.id_actividad_equipo = ae.id_actividad_equipo
          ) as calificacionTotal,
          -- 🆕 ESTADO EN TEXTO
          CASE 
            WHEN ae.id_estado = 1 THEN 'Pendiente'
            WHEN ae.id_estado = 2 THEN 'Entregado'
            WHEN ae.id_estado = 3 THEN 'No Entregado'
            WHEN ae.id_estado = 4 THEN 'Entregado Tarde'
            ELSE 'Sin Estado'
          END as estadoTexto
        FROM tbl_actividad_equipo ae
        INNER JOIN tbl_equipos e ON ae.id_equipo = e.id_equipo
        WHERE ae.id_actividad = @idActividad
        ORDER BY e.nombre_equipo
      `);

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
    
    // Primero obtener el valor total del instrumento y todos los criterios
    const instrumentoResult = await pool.request()
      .input('idActividad', sql.Int, idActividad)
      .query(`
        SELECT 
          i.valor_total,
          SUM(c.valor_maximo) as suma_maxima_criterios
        FROM tbl_actividades a
        INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
        INNER JOIN tbl_criterios c ON i.id_instrumento = c.id_instrumento
        WHERE a.id_actividad = @idActividad
        GROUP BY i.valor_total
      `);
    
    const valorTotal = instrumentoResult.recordset[0]?.valor_total || 10;
    const sumaMaximaCriterios = instrumentoResult.recordset[0]?.suma_maxima_criterios || 10;

    const result = await pool.request()
      .input('idActividad', sql.Int, idActividad)
      .input('valorTotal', sql.Float, valorTotal)
      .input('sumaMaximaCriterios', sql.Float, sumaMaximaCriterios)
      .query(`
        SELECT 
          aa.id_actividad_alumno,
          aa.vchMatricula,
          aa.observacion,
          aa.id_estado, -- 🆕 INCLUIR ESTADO
          al.vchNombre + ' ' + ISNULL(al.vchAPaterno, '') + ' ' + ISNULL(al.vchAMaterno, '') as nombreCompleto,
          -- Verificar si ya está calificado
          CASE 
            WHEN EXISTS (
              SELECT 1 FROM tbl_evaluacion_criterioActividad ec 
              WHERE ec.id_actividad_alumno = aa.id_actividad_alumno
            ) THEN 1 
            ELSE 0 
          END as yaCalificado,
          -- CÁLCULO CORREGIDO: Usar la suma total de TODOS los criterios del instrumento
          (SELECT 
             ROUND(SUM(CAST(ec2.calificacion AS FLOAT)) / @sumaMaximaCriterios * @valorTotal, 1)
           FROM tbl_evaluacion_criterioActividad ec2
           WHERE ec2.id_actividad_alumno = aa.id_actividad_alumno
          ) as calificacionTotal,
          -- 🆕 ESTADO EN TEXTO
          CASE 
            WHEN aa.id_estado = 1 THEN 'Pendiente'
            WHEN aa.id_estado = 2 THEN 'Entregado'
            WHEN aa.id_estado = 3 THEN 'No Entregado'
            WHEN aa.id_estado = 4 THEN 'Entregado Tarde'
            ELSE 'Sin Estado'
          END as estadoTexto
        FROM tbl_actividad_alumno aa
        INNER JOIN tblAlumnos al ON aa.vchMatricula = al.vchMatricula
        WHERE aa.id_actividad = @idActividad
        ORDER BY al.vchNombre, al.vchAPaterno
      `);

    res.json(result.recordset);
  } catch (error) {
    console.error('❌ Error al obtener alumnos para calificar:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

// Obtener calificaciones existentes de un alumno - CORREGIDA
// Obtener calificaciones existentes de un alumno - CORREGIDA
const obtenerCalificacionesAlumno = async (req, res) => {
  const { idActividadAlumno } = req.params;

  try {
    const pool = await sql.connect(config);
    
    // Obtener calificaciones
    const calificacionesResult = await pool.request()
      .input('idActividadAlumno', sql.Int, idActividadAlumno)
      .query(`
        SELECT 
          ec.id_criterio,
          ec.calificacion,
          c.nombre as nombre_criterio,
          c.valor_maximo
        FROM tbl_evaluacion_criterioActividad ec
        INNER JOIN tbl_criterios c ON ec.id_criterio = c.id_criterio
        WHERE ec.id_actividad_alumno = @idActividadAlumno
        ORDER BY c.id_criterio
      `);

    // 🆕 OBTENER OBSERVACIÓN
    const observacionResult = await pool.request()
      .input('idActividadAlumno', sql.Int, idActividadAlumno)
      .query(`
        SELECT observacion
        FROM tbl_actividad_alumno
        WHERE id_actividad_alumno = @idActividadAlumno
      `);

    // 🆕 RESPUESTA COMPLETA CON OBSERVACIÓN
    res.json({
      calificaciones: calificacionesResult.recordset,
      observacion: observacionResult.recordset[0]?.observacion || null
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
    
    // Obtener calificaciones
    const calificacionesResult = await pool.request()
      .input('idActividadEquipo', sql.Int, idActividadEquipo)
      .query(`
        SELECT 
          ece.id_criterio,
          ece.calificacion,
          c.nombre as nombre_criterio,
          c.valor_maximo
        FROM tbl_evaluacion_criterioActividadEquipo ece
        INNER JOIN tbl_criterios c ON ece.id_criterio = c.id_criterio
        WHERE ece.id_actividad_equipo = @idActividadEquipo
        ORDER BY c.id_criterio
      `);

    // 🆕 OBTENER OBSERVACIÓN
    const observacionResult = await pool.request()
      .input('idActividadEquipo', sql.Int, idActividadEquipo)
      .query(`
        SELECT observacion
        FROM tbl_actividad_equipo
        WHERE id_actividad_equipo = @idActividadEquipo
      `);

    // 🆕 RESPUESTA COMPLETA CON OBSERVACIÓN
    res.json({
      calificaciones: calificacionesResult.recordset,
      observacion: observacionResult.recordset[0]?.observacion || null
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
  const { idActividadEquipo, idEquipo, calificaciones, observacion } = req.body; // 🆕 AGREGAR observacion

  const transaction = new sql.Transaction();

  try {
    const pool = await sql.connect(config);
    await transaction.begin();

    console.log('🔄 Guardando calificaciones de equipo...');
    console.log('📋 idActividadEquipo:', idActividadEquipo);
    console.log('👥 idEquipo:', idEquipo);
    console.log('📊 Calificaciones:', calificaciones);
    console.log('💬 OBSERVACIÓN RECIBIDA DEL FRONTEND:', observacion); // 🆕 DEBUG LOG

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

    // 🆕 PASO 5: ACTUALIZAR ESTADO Y OBSERVACIÓN DEL EQUIPO
    await transaction.request()
      .input('idActividadEquipo', sql.Int, idActividadEquipo)
      .input('nuevoEstado', sql.Int, 2) // 2 = Entregado
      .input('observacion', sql.NVarChar, observacion || null) // 🆕 OBSERVACIÓN
      .query(`
        UPDATE tbl_actividad_equipo 
        SET id_estado = @nuevoEstado, observacion = @observacion 
        WHERE id_actividad_equipo = @idActividadEquipo
      `);

    // PASO 6: REPLICAR CALIFICACIONES A CADA INTEGRANTE
    for (const integrante of integrantes) {
      console.log(`📝 Replicando calificación para ${integrante.vchMatricula}`);

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
          .input('estadoInicial', sql.Int, 2) // 🆕 CREAR CON ESTADO "ENTREGADO"
          .input('observacion', sql.NVarChar, observacion || null) // 🆕 REPLICAR OBSERVACIÓN
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
        
        // 🆕 ACTUALIZAR ESTADO Y OBSERVACIÓN
        await transaction.request()
          .input('idActividadAlumno', sql.Int, idActividadAlumno)
          .input('nuevoEstado', sql.Int, 2) // 2 = Entregado
          .input('observacion', sql.NVarChar, observacion || null) // 🆕 REPLICAR OBSERVACIÓN
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

      // Insertar calificaciones individuales (copia de las del equipo)
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

    await transaction.commit();
    
    console.log('✅ Calificaciones del equipo guardadas correctamente');
    console.log(`📊 Calificaciones replicadas a ${integrantes.length} integrantes`);
    console.log(`🔧 Criterios calificados: ${calificaciones.length}`);
    console.log(`🎯 Estados actualizados a "Entregado"`);
    console.log(`💬 Observación final guardada: "${observacion}"`); // 🆕 CONFIRMACIÓN LOG
    
    res.json({ 
      mensaje: 'Calificaciones del equipo guardadas correctamente',
      integrantes_calificados: integrantes.length,
      criterios_calificados: calificaciones.length,
      estadoActualizado: 'Entregado',
      observacionGuardada: observacion, // 🆕 CONFIRMACIÓN EN RESPUESTA
      detalle: `Se replicaron las calificaciones y observación a ${integrantes.length} integrantes del equipo`
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
    const result = await pool.request()
      .input('clave', sql.VarChar, clave)
      .query(`
        SELECT DISTINCT
          dm.Periodo,
          dm.vchCuatrimestre,
          COUNT(DISTINCT dm.vchClvMateria) as totalMaterias,
          COUNT(DISTINCT dmg.id_grupo) as totalGrupos,
          CASE 
            WHEN dm.Periodo = (SELECT TOP 1 Periodo FROM tbl_docente_materia ORDER BY Periodo DESC)
            THEN 'ACTUAL'
            ELSE 'ANTERIOR'
          END as estado
        FROM tbl_docente_materia dm
        LEFT JOIN tbl_docente_materia_grupo dmg ON dm.idDocenteMateria = dmg.id_DocenteMateria
        WHERE dm.vchClvTrabajador = @clave
        GROUP BY dm.Periodo, dm.vchCuatrimestre
        ORDER BY dm.Periodo DESC, dm.vchCuatrimestre DESC
      `);

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

    const result = await pool.request()
      .input('clave', sql.VarChar, clave)
      .input('periodo', sql.VarChar, periodo || '20251')
      .query(`
        SELECT DISTINCT
          m.vchClvMateria,
          m.vchNomMateria AS nombreMateria,
          COUNT(DISTINCT g.id_grupo) AS totalGrupos,
          COUNT(DISTINCT a.vchMatricula) AS totalAlumnos,
          dm.vchCuatrimestre,
          dm.Periodo
        FROM tbl_docente_materia dm
        JOIN tbl_materias m ON dm.vchClvMateria = m.vchClvMateria
        LEFT JOIN tbl_docente_materia_grupo dmg ON dm.idDocenteMateria = dmg.id_DocenteMateria
        LEFT JOIN tbl_grupos g ON dmg.id_grupo = g.id_grupo
        LEFT JOIN tblAlumnos a ON a.chvGrupo = g.id_grupo
          AND a.vchClvCuatri = dm.vchCuatrimestre
          AND a.vchPeriodo = dm.Periodo
        WHERE dm.vchClvTrabajador = @clave
          AND dm.Periodo = @periodo
        GROUP BY m.vchClvMateria, m.vchNomMateria, dm.vchCuatrimestre, dm.Periodo
        ORDER BY m.vchNomMateria
      `);

    console.log(`✅ Encontradas ${result.recordset.length} materias del periodo ${periodo}`);
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

    // 🎯 USAR DIRECTAMENTE LOS ESTADOS DE LAS TABLAS
    const result = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('idGrupo', sql.Int, idGrupo)
      .query(`
        WITH EstadisticasPorEstado AS (
          SELECT 
            a.id_actividad,
            ag.fecha_entrega,
            
            -- 📊 CONTAR POR CADA ESTADO USANDO LAS TABLAS CORRECTAS
            CASE 
              WHEN ISNULL(a.id_modalidad, 1) = 1 THEN 
                -- Individual: usar tbl_actividad_alumno
                (SELECT COUNT(*) FROM tbl_actividad_alumno aa WHERE aa.id_actividad = a.id_actividad AND aa.id_estado = 1)
              ELSE 
                -- Equipo: usar tbl_actividad_equipo
                (SELECT COUNT(*) FROM tbl_actividad_equipo ae WHERE ae.id_actividad = a.id_actividad AND ae.id_estado = 1)
            END AS pendientes,
            
            CASE 
              WHEN ISNULL(a.id_modalidad, 1) = 1 THEN 
                (SELECT COUNT(*) FROM tbl_actividad_alumno aa WHERE aa.id_actividad = a.id_actividad AND aa.id_estado = 2)
              ELSE 
                (SELECT COUNT(*) FROM tbl_actividad_equipo ae WHERE ae.id_actividad = a.id_actividad AND ae.id_estado = 2)
            END AS entregados,
            
            CASE 
              WHEN ISNULL(a.id_modalidad, 1) = 1 THEN 
                (SELECT COUNT(*) FROM tbl_actividad_alumno aa WHERE aa.id_actividad = a.id_actividad AND aa.id_estado = 3)
              ELSE 
                (SELECT COUNT(*) FROM tbl_actividad_equipo ae WHERE ae.id_actividad = a.id_actividad AND ae.id_estado = 3)
            END AS noEntregados,
            
            CASE 
              WHEN ISNULL(a.id_modalidad, 1) = 1 THEN 
                (SELECT COUNT(*) FROM tbl_actividad_alumno aa WHERE aa.id_actividad = a.id_actividad AND aa.id_estado = 4)
              ELSE 
                (SELECT COUNT(*) FROM tbl_actividad_equipo ae WHERE ae.id_actividad = a.id_actividad AND ae.id_estado = 4)
            END AS entregadosTarde,
            
            -- Verificar si ya venció
            CASE WHEN DATEDIFF(hour, GETDATE(), ag.fecha_entrega) < 0 THEN 1 ELSE 0 END AS yaVencio
            
          FROM tbl_actividades a
          INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
          INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
          WHERE i.vchClvTrabajador = @claveDocente
            AND i.vchClvMateria = @claveMateria
            AND ag.id_grupo = @idGrupo
        )
        
        SELECT 
          -- ✅ Actividades 100% sin pendientes
          SUM(CASE WHEN pendientes = 0 THEN 1 ELSE 0 END) as actividadesCompletas,
          
          -- 📝 Total de pendientes en todas las actividades
          SUM(pendientes) as totalPendientes,
          
          -- 🚨 Actividades vencidas con pendientes
          SUM(CASE WHEN yaVencio = 1 AND pendientes > 0 THEN 1 ELSE 0 END) as actividadesVencidas,
          
          -- 📊 Total de actividades
          COUNT(*) as totalActividades,
          
          -- 🎯 ESTADÍSTICAS ADICIONALES POR ESTADO
          SUM(entregados) as totalEntregados,
          SUM(noEntregados) as totalNoEntregados,
          SUM(entregadosTarde) as totalEntregadosTarde,
          
          -- ⏰ Actividades activas con pendientes (no vencidas)
          SUM(CASE WHEN yaVencio = 0 AND pendientes > 0 THEN 1 ELSE 0 END) as actividadesActivasConPendientes
          
        FROM EstadisticasPorEstado
      `);

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

  // Funciones de procedimientos almacenados
  obtenerConcentradoFinal,
  obtenerCalificacionesActividad
};