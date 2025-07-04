const { sql, config } = require('../db/sqlConfig');

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

// 🆕 FUNCIÓN DE DEBUG: Ver todos los periodos de un docente
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

// 🆕 FUNCIÓN ALTERNATIVA: Materias por periodo específico
const obtenerMateriasCompletasPorPeriodo = async (req, res) => {
  const { clave, periodo } = req.params;

  try {
    const pool = await sql.connect(config);

    const result = await pool.request()
      .input('clave', sql.VarChar, clave)
      .input('periodo', sql.VarChar, periodo || '20251') // Default al periodo actual
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

// Crear una nueva actividad
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
      return res.status(400).json({ error: 'No se encontró instrumento para este docente/materia/parcial' });
    }

    const idInstrumento = instrumento.id_instrumento;

    // Obtener número consecutivo para numero_actividad
    const numeroResult = await pool.request().query(`
      SELECT ISNULL(MAX(numero_actividad), 0) + 1 AS siguiente FROM tbl_actividades
    `);
    const numeroActividad = numeroResult.recordset[0].siguiente;

    // Insertar nueva actividad
    const insertActividad = await pool.request()
      .input('titulo', sql.NVarChar, titulo)
      .input('descripcion', sql.NVarChar, descripcion)
      .input('fecha', sql.DateTime, new Date()) // fecha_creacion actual
      .input('docente', sql.VarChar, claveDocente)
      .input('idInstrumento', sql.Int, idInstrumento)
      .input('idEstado', sql.Int, 1) // Estado inicial
      .input('numero', sql.Int, numeroActividad)
      .query(`
        INSERT INTO tbl_actividades (
          titulo, descripcion, fecha_creacion, vchClvTrabajador,
          id_instrumento, id_estado_actividad, numero_actividad
        )
        OUTPUT INSERTED.id_actividad
        VALUES (@titulo, @descripcion, @fecha, @docente, @idInstrumento, @idEstado, @numero)
      `);

    const idActividad = insertActividad.recordset[0].id_actividad;

    // Insertar actividad por grupo
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
        .query(`
          INSERT INTO tbl_actividad_grupo (id_actividad, id_grupo, fecha_asignacion, fecha_entrega)
          VALUES (@idActividad, @idGrupo, @fechaAsignacion, @fechaEntrega)
        `);
    }

    res.status(201).json({ mensaje: 'Actividad creada correctamente', idActividad });

  } catch (error) {
    console.error('❌ Error al crear actividad:', error);
    res.status(500).json({ mensaje: 'Error interno al registrar la actividad' });
  }
};

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

// Obtener actividades por grupo - VERSIÓN CORREGIDA FINAL
const obtenerActividadesPorGrupo = async (req, res) => {
  const { claveDocente, claveMateria, idGrupo } = req.params;
  
  // Filtros opcionales desde query parameters
  const { parcial, estado, modalidad } = req.query;

  try {
    const pool = await sql.connect(config);
    
    // Construir condiciones WHERE dinámicamente
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
        a.id_estado_actividad,
        ag.fecha_asignacion,
        ag.fecha_entrega,
        i.parcial,
        ISNULL(i.nombre, 'Sin nombre') AS nombre_instrumento,
        g.vchGrupo,
        
        -- Estadísticas según modalidad
        CASE 
          WHEN ISNULL(a.id_modalidad, 1) = 1 THEN 
            (SELECT COUNT(DISTINCT aa.vchMatricula) 
             FROM tbl_actividad_alumno aa 
             WHERE aa.id_actividad = a.id_actividad)
          WHEN ISNULL(a.id_modalidad, 1) = 2 THEN 
            (SELECT COUNT(DISTINCT ae.id_equipo) 
             FROM tbl_actividad_equipo ae 
             WHERE ae.id_actividad = a.id_actividad)
          ELSE 0
        END AS totalEntregas,
        
        CASE 
          WHEN ISNULL(a.id_modalidad, 1) = 1 THEN 
            (SELECT COUNT(*) 
             FROM tblAlumnos al 
             INNER JOIN tbl_docente_materia dm ON al.vchClvCuatri = dm.vchCuatrimestre 
               AND al.vchPeriodo = dm.Periodo
             WHERE al.chvGrupo = @idGrupo 
               AND dm.vchClvTrabajador = @claveDocente 
               AND dm.vchClvMateria = @claveMateria)
          WHEN ISNULL(a.id_modalidad, 1) = 2 THEN 
            (SELECT COUNT(DISTINCT ae.id_equipo) 
             FROM tbl_actividad_equipo ae 
             WHERE ae.id_actividad = a.id_actividad)
          ELSE 0
        END AS totalEsperados,
        
        -- Promedio de calificaciones según modalidad
        CASE 
          WHEN ISNULL(a.id_modalidad, 1) = 1 THEN 
            (SELECT AVG(CAST(ec.calificacion AS FLOAT)) 
             FROM tbl_actividad_alumno aa 
             INNER JOIN tbl_evaluacion_criterioActividad ec ON aa.id_actividad_alumno = ec.id_actividad_alumno
             WHERE aa.id_actividad = a.id_actividad 
               AND ec.calificacion IS NOT NULL)
          WHEN ISNULL(a.id_modalidad, 1) = 2 THEN 
            (SELECT AVG(CAST(ece.calificacion AS FLOAT)) 
             FROM tbl_actividad_equipo ae 
             INNER JOIN tbl_evaluacion_criterioActividadEquipo ece ON ae.id_actividad_equipo = ece.id_actividad_equipo
             WHERE ae.id_actividad = a.id_actividad 
               AND ece.calificacion IS NOT NULL)
          ELSE NULL
        END AS promedio,
        
        -- Estado calculado de la actividad (basado en tbl_estado_actividad)
        CASE 
          WHEN ISNULL(a.id_estado_actividad, 3) = 1 THEN 'entregado'
          WHEN ISNULL(a.id_estado_actividad, 3) = 2 THEN 'no_entregado'
          WHEN ISNULL(a.id_estado_actividad, 3) = 3 THEN 'pendiente'
          ELSE 'pendiente'
        END AS estadoCalculado,
        
        -- Días restantes
        DATEDIFF(day, GETDATE(), ag.fecha_entrega) AS diasRestantes,
        
        -- Porcentaje de completado
        CASE 
          WHEN ISNULL(a.id_modalidad, 1) = 1 THEN 
            CASE 
              WHEN (SELECT COUNT(*) FROM tblAlumnos al 
                    INNER JOIN tbl_docente_materia dm ON al.vchClvCuatri = dm.vchCuatrimestre 
                      AND al.vchPeriodo = dm.Periodo
                    WHERE al.chvGrupo = @idGrupo 
                      AND dm.vchClvTrabajador = @claveDocente 
                      AND dm.vchClvMateria = @claveMateria) > 0
              THEN ROUND((CAST((SELECT COUNT(DISTINCT aa.vchMatricula) 
                               FROM tbl_actividad_alumno aa 
                               WHERE aa.id_actividad = a.id_actividad) AS FLOAT) / 
                         CAST((SELECT COUNT(*) FROM tblAlumnos al 
                               INNER JOIN tbl_docente_materia dm ON al.vchClvCuatri = dm.vchCuatrimestre 
                                 AND al.vchPeriodo = dm.Periodo
                               WHERE al.chvGrupo = @idGrupo 
                                 AND dm.vchClvTrabajador = @claveDocente 
                                 AND dm.vchClvMateria = @claveMateria) AS FLOAT)) * 100, 1)
              ELSE 0
            END
          WHEN ISNULL(a.id_modalidad, 1) = 2 THEN 100
          ELSE 0
        END AS porcentajeCompletado

      FROM tbl_actividades a
      INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
      INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
      INNER JOIN tbl_grupos g ON ag.id_grupo = g.id_grupo
      ${whereConditions}
      ORDER BY i.parcial, a.numero_actividad DESC, a.fecha_creacion DESC
    `);

    console.log(`✅ Encontradas ${result.recordset.length} actividades`);

    // Procesar resultados y agrupar por parcial - SIN SEPARAR POR FECHA
    const actividadesPorParcial = {};
    let estadisticasGenerales = {
      totalActividades: result.recordset.length,
      entregado: 0,
      no_entregado: 0,
      pendiente: 0,
      promedioGeneral: 0,
      porcentajeCompletadoGeneral: 0
    };

    let sumaPromedios = 0;
    let sumaCompletado = 0;
    let contadorConPromedio = 0;

    result.recordset.forEach(actividad => {
      const parcial = actividad.parcial;
      
      if (!actividadesPorParcial[parcial]) {
        actividadesPorParcial[parcial] = {
          numero: parcial,
          nombre: `Parcial ${parcial}`,
          actividades: [],
          estadisticas: {
            total: 0,
            entregado: 0,
            no_entregado: 0,
            pendiente: 0
          }
        };
      }
      
      // Determinar estado y actualizar estadísticas
      const estado = actividad.estadoCalculado;
      estadisticasGenerales[estado] = (estadisticasGenerales[estado] || 0) + 1;
      actividadesPorParcial[parcial].estadisticas[estado] = (actividadesPorParcial[parcial].estadisticas[estado] || 0) + 1;
      actividadesPorParcial[parcial].estadisticas.total++;
      
      // Acumular promedios
      if (actividad.promedio) {
        sumaPromedios += actividad.promedio;
        contadorConPromedio++;
      }
      
      sumaCompletado += actividad.porcentajeCompletado || 0;
      
      // Formatear actividad para respuesta
      actividadesPorParcial[parcial].actividades.push({
        id_actividad: actividad.id_actividad,
        titulo: actividad.titulo,
        descripcion: actividad.descripcion,
        fecha_entrega: actividad.fecha_entrega,
        fecha_asignacion: actividad.fecha_asignacion,
        numero_actividad: actividad.numero_actividad,
        modalidad: (actividad.id_modalidad === 2) ? 'equipo' : 'individual',
        estado: estado,
        totalEntregas: actividad.totalEntregas || 0,
        totalEsperados: actividad.totalEsperados || 0,
        promedio: actividad.promedio ? Number(actividad.promedio.toFixed(1)) : null,
        porcentajeCompletado: actividad.porcentajeCompletado || 0,
        diasRestantes: actividad.diasRestantes,
        grupo: actividad.vchGrupo,
        instrumento: actividad.nombre_instrumento,
        parcial: actividad.parcial,
        urgente: actividad.diasRestantes <= 2 && estado === 'pendiente',
        requiereAtencion: (actividad.porcentajeCompletado || 0) < 50 && estado === 'pendiente'
      });
    });

    // Calcular estadísticas generales
    estadisticasGenerales.promedioGeneral = contadorConPromedio > 0 ? 
      Number((sumaPromedios / contadorConPromedio).toFixed(1)) : 0;
    estadisticasGenerales.porcentajeCompletadoGeneral = 
      estadisticasGenerales.totalActividades > 0 ? 
      Number((sumaCompletado / estadisticasGenerales.totalActividades).toFixed(1)) : 0;

    // Convertir parciales a array ordenado
    const parciales = Object.keys(actividadesPorParcial)
      .map(Number)
      .sort((a, b) => a - b)
      .map(parcial => actividadesPorParcial[parcial]);

    console.log(`📊 Estadísticas: ${estadisticasGenerales.totalActividades} total`);

    // RESPUESTA SIMPLE - Solo parciales (sin sección pendientes por ahora)
    res.json({
      parciales,
      estadisticas: estadisticasGenerales,
      totalPendientes: estadisticasGenerales.pendiente
    });

  } catch (error) {
    console.error('❌ Error al obtener actividades del grupo:', error);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
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

// Crear actividad con estructura mejorada
const crearActividadCompleta = async (req, res) => {
  const {
    titulo,
    descripcion,
    fechaEntrega,
    parcial,
    claveMateria,
    claveDocente,
    idInstrumento,
    grupos,
    modalidad, // 1 = Individual, 2 = Equipo
    equiposPorGrupo = {} // ESTRUCTURA: { "A": { tipoSeleccion: "actividad", idActividad: 5, equiposNuevos: [...] } }
  } = req.body;

  const transaction = new sql.Transaction();

  try {
    const pool = await sql.connect(config);
    await transaction.begin();

    console.log('🚀 Iniciando creación completa de actividad...');
    console.log('📋 Modalidad:', modalidad === 1 ? 'Individual' : 'Equipo');
    console.log('👥 Grupos seleccionados:', grupos);

    // ===============================================
    // 1. VALIDAR INSTRUMENTO
    // ===============================================
    let instrumentoId = idInstrumento;
    if (!instrumentoId) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'Debe seleccionar un formato de evaluación (Lista de cotejo)'
      });
    }

    // ===============================================
    // 2. CREAR LA ACTIVIDAD
    // ===============================================
    const numeroResult = await transaction.request().query(`
      SELECT ISNULL(MAX(numero_actividad), 0) + 1 AS siguiente FROM tbl_actividades
    `);
    const numeroActividad = numeroResult.recordset[0].siguiente;

    const insertActividad = await transaction.request()
      .input('titulo', sql.NVarChar, titulo)
      .input('descripcion', sql.NVarChar, descripcion)
      .input('fecha', sql.DateTime, new Date())
      .input('docente', sql.VarChar, claveDocente)
      .input('idInstrumento', sql.Int, instrumentoId)
      .input('idEstado', sql.Int, 1)
      .input('numero', sql.Int, numeroActividad)
      .input('modalidad', sql.Int, modalidad)
      .query(`
        INSERT INTO tbl_actividades (
          titulo, descripcion, fecha_creacion, vchClvTrabajador,
          id_instrumento, id_estado_actividad, numero_actividad, id_modalidad
        )
        OUTPUT INSERTED.id_actividad
        VALUES (@titulo, @descripcion, @fecha, @docente, @idInstrumento, @idEstado, @numero, @modalidad)
      `);

    const idActividad = insertActividad.recordset[0].id_actividad;
    console.log('✅ Actividad creada con ID:', idActividad);

    // ===============================================
    // 3. PROCESAR EQUIPOS POR GRUPO
    // ===============================================
    let totalEquiposAsignados = 0;
    const resumenEquipos = {};

    if (modalidad === 2) {
      for (const [claveGrupo, datosGrupo] of Object.entries(equiposPorGrupo)) {
        console.log(`📋 Procesando Grupo ${claveGrupo}:`, datosGrupo);

        // Obtener id_grupo
        const grupoQuery = await pool.request()
          .input('clave', sql.VarChar, claveGrupo)
          .query('SELECT TOP 1 id_grupo FROM tbl_grupos WHERE vchGrupo = @clave');

        if (grupoQuery.recordset.length === 0) continue;
        const idGrupo = grupoQuery.recordset[0].id_grupo;

        let equiposParaAsignar = [];

        // Según el tipo de selección
        if (datosGrupo.tipoSeleccion === 'actividad' && datosGrupo.idActividadAnterior) {
          // Usar equipos de actividad anterior
          const equiposAnteriores = await pool.request()
            .input('idActividadAnterior', sql.Int, datosGrupo.idActividadAnterior)
            .query(`
              SELECT ae.id_equipo
              FROM tbl_actividad_equipo ae
              WHERE ae.id_actividad = @idActividadAnterior
            `);

          equiposParaAsignar = equiposAnteriores.recordset.map(e => e.id_equipo);
          console.log(`✅ Usando ${equiposParaAsignar.length} equipos de actividad anterior`);

        } else if ((datosGrupo.tipoSeleccion === 'aleatorio' || datosGrupo.tipoSeleccion === 'manual') && datosGrupo.equiposNuevos) {
          // Crear equipos nuevos
          const maxIdResult = await transaction.request().query(`
            SELECT ISNULL(MAX(id_equipo), 0) + 1 AS siguiente_id FROM tbl_equipos
          `);
          let siguienteIdEquipo = maxIdResult.recordset[0].siguiente_id;

          for (const equipoNuevo of datosGrupo.equiposNuevos) {
            // Crear equipo
            await transaction.request()
              .input('idEquipo', sql.Int, siguienteIdEquipo)
              .input('idGrupo', sql.Int, idGrupo)
              .input('nombreEquipo', sql.NVarChar, equipoNuevo.nombre)
              .query(`
                INSERT INTO tbl_equipos (id_equipo, id_grupo, nombre_equipo)
                VALUES (@idEquipo, @idGrupo, @nombreEquipo)
              `);

            // Asignar integrantes
            for (const integrante of equipoNuevo.integrantes) {
              await transaction.request()
                .input('idEquipo', sql.Int, siguienteIdEquipo)
                .input('matricula', sql.VarChar, integrante.vchMatricula)
                .query(`
                  INSERT INTO tbl_equipo_alumno (id_equipo, vchMatricula)
                  VALUES (@idEquipo, @matricula)
                `);
            }

            equiposParaAsignar.push(siguienteIdEquipo);
            siguienteIdEquipo++;
          }
          console.log(`✅ Creados ${equiposParaAsignar.length} equipos nuevos`);
        }

        // Asignar equipos a la nueva actividad
        for (const idEquipo of equiposParaAsignar) {
          await transaction.request()
            .input('idActividad', sql.Int, idActividad)
            .input('idEquipo', sql.Int, idEquipo)
            .query(`
              INSERT INTO tbl_actividad_equipo (id_actividad, id_equipo)
              VALUES (@idActividad, @idEquipo)
            `);
          totalEquiposAsignados++;
        }

        resumenEquipos[claveGrupo] = {
          tipo: datosGrupo.tipoSeleccion,
          equipos: equiposParaAsignar.length
        };
      }
    }

    // ===============================================
    // 4. ASIGNAR ACTIVIDAD A GRUPOS
    // ===============================================
    for (const claveGrupo of grupos) {
      const grupoQuery = await pool.request()
        .input('clave', sql.VarChar, claveGrupo)
        .query('SELECT TOP 1 id_grupo FROM tbl_grupos WHERE vchGrupo = @clave');

      if (grupoQuery.recordset.length === 0) continue;
      const idGrupo = grupoQuery.recordset[0].id_grupo;

      await transaction.request()
        .input('idActividad', sql.Int, idActividad)
        .input('idGrupo', sql.Int, idGrupo)
        .input('fechaAsignacion', sql.DateTime, new Date())
        .input('fechaEntrega', sql.DateTime, fechaEntrega)
        .query(`
          INSERT INTO tbl_actividad_grupo (id_actividad, id_grupo, fecha_asignacion, fecha_entrega)
          VALUES (@idActividad, @idGrupo, @fechaAsignacion, @fechaEntrega)
        `);
    }

    // ===============================================
    // 5. CONFIRMAR TRANSACCIÓN
    // ===============================================
    await transaction.commit();
    console.log('🎉 ¡Actividad completa creada exitosamente!');

    res.status(201).json({ 
      mensaje: 'Actividad creada correctamente',
      actividad: {
        idActividad,
        titulo,
        modalidad: modalidad === 1 ? 'Individual' : 'Equipo',
        numeroActividad
      },
      equipos: {
        totalAsignados: totalEquiposAsignados,
        resumenPorGrupo: resumenEquipos
      }
    });

  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error en transacción completa:', error);
    res.status(500).json({ 
      error: 'Error al crear actividad completa',
      detalle: error.message 
    });
  }
};

// ===============================================
// 🆕 FUNCIONES PARA CALIFICAR ACTIVIDADES
// ===============================================

// Obtener datos de actividad para calificar
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
          m.vchNomMateria
        FROM tbl_actividades a
        INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
        INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
        INNER JOIN tbl_grupos g ON ag.id_grupo = g.id_grupo
        INNER JOIN tbl_materias m ON i.vchClvMateria = m.vchClvMateria
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

// ===============================================
// FUNCIONES CORREGIDAS DEL BACKEND - VERSIÓN FINAL
// ===============================================

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
          ) as calificacionTotal
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
          ) as calificacionTotal
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
const obtenerCalificacionesAlumno = async (req, res) => {
  const { idActividadAlumno } = req.params;

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
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

    res.json(result.recordset);
  } catch (error) {
    console.error('❌ Error al obtener calificaciones del alumno:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

// Obtener calificaciones existentes de un equipo - CORREGIDA
const obtenerCalificacionesEquipo = async (req, res) => {
  const { idActividadEquipo } = req.params;

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
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

    res.json(result.recordset);
  } catch (error) {
    console.error('❌ Error al obtener calificaciones del equipo:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

// Guardar calificaciones de un alumno
const guardarCalificacionesAlumno = async (req, res) => {
  const { idActividadAlumno, calificaciones } = req.body;
  // calificaciones = [{ id_criterio: 1, calificacion: 2.0 }, ...]

  const transaction = new sql.Transaction();

  try {
    const pool = await sql.connect(config);
    await transaction.begin();

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

    await transaction.commit();
    res.json({ mensaje: 'Calificaciones guardadas correctamente' });

  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error al guardar calificaciones del alumno:', error);
    res.status(500).json({ error: 'Error al guardar calificaciones' });
  }
};

// 🆕 FUNCIÓN CORREGIDA SIN OUTPUT: guardarCalificacionesEquipo
// Reemplaza la función anterior con esta versión
const guardarCalificacionesEquipo = async (req, res) => {
  const { idActividadEquipo, idEquipo, calificaciones } = req.body;

  const transaction = new sql.Transaction();

  try {
    const pool = await sql.connect(config);
    await transaction.begin();

    console.log('🔄 Guardando calificaciones de equipo...');
    console.log('📋 idActividadEquipo:', idActividadEquipo);
    console.log('👥 idEquipo:', idEquipo);
    console.log('📊 Calificaciones:', calificaciones);

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

    // PASO 5: 🆕 REPLICAR CALIFICACIONES A CADA INTEGRANTE - SIN OUTPUT
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
        // 🔧 CREAR REGISTRO SIN OUTPUT CLAUSE
        await transaction.request()
          .input('idActividad', sql.Int, idActividad)
          .input('matricula', sql.VarChar, integrante.vchMatricula)
          .query(`
            INSERT INTO tbl_actividad_alumno (id_actividad, vchMatricula)
            VALUES (@idActividad, @matricula)
          `);
        
        // 🔧 OBTENER EL ID INSERTADO EN CONSULTA SEPARADA
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
        console.log(`✅ Usando tbl_actividad_alumno existente: ${idActividadAlumno}`);
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
    
    res.json({ 
      mensaje: 'Calificaciones del equipo guardadas correctamente',
      integrantes_calificados: integrantes.length,
      criterios_calificados: calificaciones.length,
      detalle: `Se replicaron las calificaciones a ${integrantes.length} integrantes del equipo`
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
// EXPORTS COMPLETOS
// ===============================================
module.exports = {
  // Funciones básicas del docente
  obtenerDatosDocente,
  obtenerPerfilDocente,
  cambiarContrasenaDocente,
  
  // Funciones de materias (ORIGINAL y CON FILTRO DE PERIODO)
  obtenerMateriasPorDocente, // Sin filtro de periodo
  obtenerMateriasCompletas, // 🆕 CON FILTRO DE PERIODO ACTUAL
  
  // 🆕 Funciones nuevas para manejo de periodos
  obtenerPeriodoActual,
  obtenerPeriodosDocente,
  obtenerMateriasCompletasPorPeriodo,
  
  // Funciones de grupos y actividades
  obtenerGruposPorMateriaDocente,
  obtenerListasCotejo,
  obtenerActividadesPorGrupo,
  
  // Funciones de creación de actividades
  crearActividad,
  crearActividadCompleta,
  
  // Funciones de manejo de equipos
  obtenerEquiposPorGrupo,
  obtenerAlumnosPorGrupo,
  simularEquiposAleatorios,
  obtenerActividadesConEquiposPorGrupo,

  // Funciones de calificación
  obtenerDatosActividad,
  obtenerCriteriosActividad,
  obtenerAlumnosParaCalificar,
  obtenerEquiposParaCalificar,
  obtenerCalificacionesAlumno,
  obtenerCalificacionesEquipo,
  guardarCalificacionesAlumno,
  guardarCalificacionesEquipo
};