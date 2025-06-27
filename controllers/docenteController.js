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

// Obtener listas de cotejo - FUNCIÓN MEJORADA DESDE EL PRIMER ARCHIVO
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
          nombre, -- Campo que necesita el frontend (era clave_formato antes)
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

// Obtener actividades por grupo
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

// Obtener materias completas
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
// NUEVAS FUNCIONES AGREGADAS DESDE EL PRIMER ARCHIVO
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
// EXPORTS ACTUALIZADOS
// ===============================================
module.exports = {
  obtenerDatosDocente,
  obtenerMateriasPorDocente,
  obtenerGruposPorMateriaDocente,
  crearActividad,
  obtenerListasCotejo,
  obtenerActividadesPorGrupo,
  obtenerMateriasCompletas, // ← MANTENIDO
  cambiarContrasenaDocente,
  obtenerPerfilDocente,
  // ===============================================
  // NUEVAS FUNCIONES AGREGADAS DESDE EL PRIMER ARCHIVO
  // ===============================================
  obtenerEquiposPorGrupo,
  obtenerAlumnosPorGrupo,
  simularEquiposAleatorios,
  obtenerActividadesConEquiposPorGrupo,
  crearActividadCompleta
};