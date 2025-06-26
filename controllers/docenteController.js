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

// Obtener materias asignadas al docente
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
          nombre AS clave_formato,
          CONCAT('Parcial ', parcial) AS descripcion
        FROM tbl_instrumento
        WHERE vchClvTrabajador = @claveDocente
          AND vchClvMateria = @claveMateria
    `);


    res.json(result.recordset);
  } catch (error) {
    console.error('❌ Error al obtener listas de cotejo:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};
// Agregar esta función al controllerDocente.js

const obtenerActividadesPorGrupo = async (req, res) => {
  const { claveDocente, claveMateria, idGrupo } = req.params;

  try {
    const pool = await sql.connect(config);
    
    // Consulta principal para obtener actividades del grupo
    const result = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .input('idGrupo', sql.Int, idGrupo)
      .query(`
        SELECT 
          a.id_actividad,
          a.titulo,
          a.descripcion,
          a.fecha_creacion,
          a.id_estado_actividad,
          ag.fecha_asignacion,
          ag.fecha_entrega,
          i.parcial,
          g.vchGrupo,
          -- Contar entregas de alumnos
          (SELECT COUNT(*) 
           FROM tbl_actividad_alumno aa 
           WHERE aa.id_actividad = a.id_actividad) AS totalEntregas,
          -- Contar total de alumnos en el grupo
          (SELECT COUNT(*) 
           FROM tblAlumnos al 
           WHERE al.chvGrupo = @idGrupo) AS totalAlumnos,
          -- Calcular promedio de calificaciones
          (SELECT AVG(CAST(ec.calificacion AS FLOAT)) 
           FROM tbl_actividad_alumno aa 
           INNER JOIN tbl_evaluacion_criterioActividad ec ON aa.id_actividad_alumno = ec.id_actividad_alumno
           WHERE aa.id_actividad = a.id_actividad 
           AND ec.calificacion IS NOT NULL) AS promedio
        FROM tbl_actividades a
        INNER JOIN tbl_instrumento i ON a.id_instrumento = i.id_instrumento
        INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
        INNER JOIN tbl_grupos g ON ag.id_grupo = g.id_grupo
        WHERE i.vchClvTrabajador = @claveDocente
          AND i.vchClvMateria = @claveMateria
          AND ag.id_grupo = @idGrupo
        ORDER BY i.parcial, a.fecha_creacion DESC
      `);

    // Agrupar actividades por parcial
    const actividadesPorParcial = {};
    
    result.recordset.forEach(actividad => {
      const parcial = actividad.parcial;
      
      if (!actividadesPorParcial[parcial]) {
        actividadesPorParcial[parcial] = [];
      }
      
      // Determinar estado de la actividad
      const ahora = new Date();
      const fechaEntrega = new Date(actividad.fecha_entrega);
      const esPendiente = fechaEntrega >= ahora;
      
      actividadesPorParcial[parcial].push({
        id_actividad: actividad.id_actividad,
        titulo: actividad.titulo,
        descripcion: actividad.descripcion,
        fecha_entrega: actividad.fecha_entrega,
        fecha_asignacion: actividad.fecha_asignacion,
        totalEntregas: actividad.totalEntregas || 0,
        totalAlumnos: actividad.totalAlumnos || 0,
        promedio: actividad.promedio ? Number(actividad.promedio.toFixed(1)) : null,
        estado: esPendiente ? 'pendiente' : 'completada',
        grupo: actividad.vchGrupo
      });
    });

    // Convertir a array ordenado
    const parciales = Object.keys(actividadesPorParcial)
      .map(Number)
      .sort((a, b) => a - b)
      .map(parcial => ({
        numero: parcial,
        nombre: `Parcial ${parcial}`,
        actividades: actividadesPorParcial[parcial]
      }));

    res.json({
      parciales,
      totalPendientes: result.recordset.filter(a => {
        const ahora = new Date();
        const fechaEntrega = new Date(a.fecha_entrega);
        return fechaEntrega >= ahora;
      }).length
    });

  } catch (error) {
    console.error('❌ Error al obtener actividades del grupo:', error);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
};

// Agregar esta función al controllerDocente.js

const obtenerMateriasCompletas = async (req, res) => {
  const { clave } = req.params;

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('clave', sql.VarChar, clave)
      .query(`
        SELECT DISTINCT
          m.vchClvMateria,
          m.vchNomMateria AS nombreMateria,
          COUNT(DISTINCT g.id_grupo) AS totalGrupos,
          COUNT(DISTINCT a.vchMatricula) AS totalAlumnos
        FROM tbl_docente_materia dm
        JOIN tbl_materias m ON dm.vchClvMateria = m.vchClvMateria
        LEFT JOIN tbl_docente_materia_grupo dmg ON dm.idDocenteMateria = dmg.id_DocenteMateria
        LEFT JOIN tbl_grupos g ON dmg.id_grupo = g.id_grupo
        LEFT JOIN tblAlumnos a ON a.chvGrupo = g.id_grupo
          AND a.vchClvCuatri = dm.vchCuatrimestre
          AND a.vchPeriodo = dm.Periodo
        WHERE dm.vchClvTrabajador = @clave
        GROUP BY m.vchClvMateria, m.vchNomMateria
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Error al obtener materias completas:', err);
    res.status(500).json({ mensaje: 'Error en el servidor' });
  }
};

// Y al final del archivo, agrégala al module.exports:
module.exports = {
  obtenerDatosDocente,
  obtenerMateriasPorDocente,
  obtenerGruposPorMateriaDocente,
  crearActividad,
  obtenerListasCotejo,
  obtenerActividadesPorGrupo,
  obtenerMateriasCompletas  // ← AGREGAR ESTA LÍNEA
};