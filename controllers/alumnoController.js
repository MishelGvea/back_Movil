const { sql, config } = require('../db/sqlConfig');

// Obtener datos del alumno y materias
const obtenerDatosAlumno = async (req, res) => {
  const { matricula } = req.params;

  try {
    const pool = await sql.connect(config);

    // Datos del alumno con nombre de carrera
    const alumno = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .query(`
        SELECT TOP 1 
          A.vchNombre + ' ' + A.vchAPaterno + ' ' + A.vchAMaterno AS nombre,
          C.vchNomCarrera AS carrera,
          A.chvGrupo AS grupo,
          A.vchClvCuatri AS cuatrimestre,
          A.vchPeriodo AS periodo
        FROM dbo.tblAlumnos A
        JOIN dbo.tblCarreras C ON C.chrClvCarrera = A.chrClvCarrera
        WHERE RTRIM(A.vchMatricula) = RTRIM(@matricula)
      `);

    const alumnoData = alumno.recordset[0];

    if (!alumnoData) {
      return res.status(404).json({ mensaje: 'Alumno no encontrado' });
    }

    // Obtener materias del alumno desde la vista filtradas por periodo
    const materiasResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('periodo', sql.VarChar, alumnoData.periodo)
      .query(`
        SELECT DISTINCT vchNomMateria AS nombreMateria, Docente, Grupo
        FROM view_MateriasPorAlumno
        WHERE vchMatricula = @matricula AND Periodo = @periodo
      `);

    const materias = materiasResult.recordset.map(m => ({
      nombre: m.nombreMateria,
      grupo: m.Grupo,
      profesor: m.Docente,
      icono: m.nombreMateria.charAt(0)
    }));

    res.json({
      nombre: alumnoData.nombre,
      carrera: alumnoData.carrera,
      grupo: alumnoData.grupo,
      cuatri: alumnoData.cuatrimestre,
      periodo: alumnoData.periodo,
      materias
    });

  } catch (err) {
    console.error('❌ Error al obtener datos del alumno:', err);
    res.status(500).json({ mensaje: 'Error en el servidor al consultar alumno' });
  }
};

// Cambiar contraseña del alumno
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

// Obtener actividades por alumno - CON FILTRO DE PERIODO DINÁMICO
const obtenerActividadesPorAlumno = async (req, res) => {
  const { matricula, materia } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`🔍 Buscando actividades para alumno: ${matricula}, materia: ${materia}`);

    // Paso 1: Obtener el periodo del alumno
    const periodoResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .query(`
        SELECT vchPeriodo 
        FROM tblAlumnos 
        WHERE RTRIM(vchMatricula) = RTRIM(@matricula)
      `);

    if (periodoResult.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Alumno no encontrado' });
    }

    const periodoAlumno = periodoResult.recordset[0].vchPeriodo;
    console.log(`📅 Periodo del alumno: ${periodoAlumno}`);

    // Paso 2: Mapear el periodo del alumno al idPeriodo de los instrumentos
    // Intentamos varias estrategias de mapeo
    const mapeoResult = await pool.request()
      .input('periodo_alumno', sql.VarChar, periodoAlumno)
      .input('materia', sql.VarChar, materia)
      .query(`
        -- Buscar mapeo directo primero
        SELECT DISTINCT 
          CAST(I.idPeriodo as VARCHAR) as idPeriodo_mapped
        FROM tbl_instrumento I
        INNER JOIN tbl_materias M ON M.vchClvMateria = I.vchClvMateria
        WHERE M.vchNomMateria = @materia
        AND (
          -- Mapeo directo: idPeriodo como string = vchPeriodo
          CAST(I.idPeriodo as VARCHAR) = @periodo_alumno
          OR 
          -- Mapeo alternativo: extraer últimos dígitos del periodo
          CAST(I.idPeriodo as VARCHAR) = RIGHT(@periodo_alumno, 1)
          OR
          -- Si el periodo del alumno es 20251, podría corresponder a idPeriodo 1
          (I.idPeriodo = 1 AND @periodo_alumno LIKE '%1')
          OR
          -- Si el periodo del alumno es 20243, podría corresponder a idPeriodo 3  
          (I.idPeriodo = 3 AND @periodo_alumno LIKE '%3')
        )
      `);

    let idPeriodosFiltro = [];
    if (mapeoResult.recordset.length > 0) {
      idPeriodosFiltro = mapeoResult.recordset.map(r => r.idPeriodo_mapped);
      console.log(`🔄 Mapeo encontrado - idPeriodos: ${idPeriodosFiltro.join(', ')}`);
    } else {
      // Si no hay mapeo, usar todos los periodos disponibles para esa materia
      console.log(`⚠️ No se encontró mapeo directo, buscando todos los periodos para la materia`);
      const todosPeriodos = await pool.request()
        .input('materia', sql.VarChar, materia)
        .query(`
          SELECT DISTINCT CAST(I.idPeriodo as VARCHAR) as idPeriodo_mapped
          FROM tbl_instrumento I
          INNER JOIN tbl_materias M ON M.vchClvMateria = I.vchClvMateria
          WHERE M.vchNomMateria = @materia
        `);
      idPeriodosFiltro = todosPeriodos.recordset.map(r => r.idPeriodo_mapped);
    }

    if (idPeriodosFiltro.length === 0) {
      console.log(`❌ No se encontraron instrumentos para la materia: ${materia}`);
      return res.json([]);
    }

    // Paso 3: Buscar actividades con el filtro de periodo mapeado
    const whereClause = idPeriodosFiltro.length === 1 
      ? `AND CAST(I.idPeriodo as VARCHAR) = '${idPeriodosFiltro[0]}'`
      : `AND CAST(I.idPeriodo as VARCHAR) IN (${idPeriodosFiltro.map(p => `'${p}'`).join(',')})`;

    const result = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('materia', sql.VarChar, materia)
      .query(`
        SELECT 
          AC.id_actividad,
          AC.titulo,
          AC.descripcion,
          -- Asegurar que las fechas vengan en formato ISO string
          CONVERT(VARCHAR, AG.fecha_asignacion, 126) as fecha_asignacion,
          CONVERT(VARCHAR, AG.fecha_entrega, 126) as fecha_entrega,
          EA.nombre_estado as estado,
          I.nombre as instrumento,
          TI.nombre_tipo as tipoInstrumento,
          CASE 
            WHEN I.parcial = 1 THEN 'Parcial 1'
            WHEN I.parcial = 2 THEN 'Parcial 2'
            WHEN I.parcial = 3 THEN 'Parcial 3'
            ELSE 'Actividad General'
          END as parcial
        FROM tbl_actividad_alumno AA
        INNER JOIN tblAlumnos A ON A.vchMatricula = AA.vchMatricula
        INNER JOIN tbl_actividades AC ON AC.id_actividad = AA.id_actividad
        INNER JOIN tbl_actividad_grupo AG ON AG.id_actividad = AC.id_actividad
        INNER JOIN tbl_estado_actividad EA ON EA.id_estado_actividad = AC.id_estado_actividad
        INNER JOIN tbl_instrumento I ON I.id_instrumento = AC.id_instrumento
        INNER JOIN tbl_tipo_instrumento TI ON TI.id_tipo_instrumento = I.id_tipo_instrumento
        INNER JOIN tbl_docentes D ON D.vchClvTrabajador = AC.vchClvTrabajador
        INNER JOIN tbl_materias M ON M.vchClvMateria = I.vchClvMateria
        WHERE A.vchMatricula = @matricula 
        AND M.vchNomMateria = @materia
        ${whereClause}
        ORDER BY AG.fecha_entrega
      `);

    console.log(`✅ Actividades encontradas con filtro de periodo: ${result.recordset.length}`);
    
    if (result.recordset.length > 0) {
      console.log('📋 Actividades filtradas:', result.recordset.map(r => ({
        titulo: r.titulo,
        instrumento: r.instrumento
      })));
    } else {
      console.log(`ℹ️ No se encontraron actividades para el periodo ${periodoAlumno} en la materia ${materia}`);
    }

    res.json(result.recordset);
  } catch (error) {
    console.error('❌ Error al obtener actividades:', error);
    res.status(500).json({ mensaje: 'Error en el servidor al obtener actividades del alumno' });
  }
};

// Obtener calificaciones históricas del alumno CON ACTIVIDADES
const obtenerCalificacionesHistoricas = async (req, res) => {
  const { matricula } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`🎓 Obteniendo calificaciones históricas para alumno: ${matricula}`);

    // Obtener TODOS los periodos del alumno de la vista
    const materiasResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .query(`
        SELECT 
          VM.Periodo,
          VM.vchNomMateria as materia,
          VM.Docente,
          VM.Grupo,
          VM.Cuatrimestre
        FROM view_MateriasPorAlumno VM
        WHERE VM.vchMatricula = @matricula
        ORDER BY VM.Periodo DESC, VM.vchNomMateria
      `);

    console.log(`📚 Materias encontradas: ${materiasResult.recordset.length}`);

    // Obtener actividades para cada materia
    const actividadesResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .query(`
        SELECT 
          AC.titulo,
          AC.descripcion,
          CONVERT(VARCHAR, AG.fecha_entrega, 126) as fecha_entrega,
          EA.nombre_estado as estado,
          I.nombre as instrumento,
          TI.nombre_tipo as tipoInstrumento,
          M.vchNomMateria as materia,
          CASE 
            WHEN I.parcial = 1 THEN 'Parcial 1'
            WHEN I.parcial = 2 THEN 'Parcial 2'
            WHEN I.parcial = 3 THEN 'Parcial 3'
            ELSE 'Actividad General'
          END as parcial
        FROM tbl_actividad_alumno AA
        INNER JOIN tblAlumnos A ON A.vchMatricula = AA.vchMatricula
        INNER JOIN tbl_actividades AC ON AC.id_actividad = AA.id_actividad
        INNER JOIN tbl_actividad_grupo AG ON AG.id_actividad = AC.id_actividad
        INNER JOIN tbl_estado_actividad EA ON EA.id_estado_actividad = AC.id_estado_actividad
        INNER JOIN tbl_instrumento I ON I.id_instrumento = AC.id_instrumento
        INNER JOIN tbl_tipo_instrumento TI ON TI.id_tipo_instrumento = I.id_tipo_instrumento
        INNER JOIN tbl_docentes D ON D.vchClvTrabajador = AC.vchClvTrabajador
        INNER JOIN tbl_materias M ON M.vchClvMateria = I.vchClvMateria
        WHERE A.vchMatricula = @matricula
        ORDER BY M.vchNomMateria, AG.fecha_entrega
      `);

    console.log(`📝 Actividades encontradas: ${actividadesResult.recordset.length}`);

    // Agrupar actividades por materia
    const actividadesPorMateria = {};
    actividadesResult.recordset.forEach(actividad => {
      if (!actividadesPorMateria[actividad.materia]) {
        actividadesPorMateria[actividad.materia] = [];
      }
      
      // Generar calificación simulada para la actividad
      const calificacionActividad = Math.floor(Math.random() * 4) + 7; // Entre 7 y 10
      
      actividadesPorMateria[actividad.materia].push({
        titulo: actividad.titulo,
        descripcion: actividad.descripcion,
        fecha_entrega: actividad.fecha_entrega,
        calificacion: calificacionActividad,
        estado: calificacionActividad >= 6 ? 'Entregada' : 'No Entregada',
        instrumento: actividad.instrumento,
        parcial: actividad.parcial
      });
    });

    // Agrupar por periodo
    const calificacionesPorPeriodo = {};
    
    materiasResult.recordset.forEach(row => {
      if (!calificacionesPorPeriodo[row.Periodo]) {
        calificacionesPorPeriodo[row.Periodo] = {
          periodo: row.Periodo,
          materias: [],
          promedio: 0
        };
      }
      
      // Generar calificación simulada para la materia
      const calificacionMateria = Math.floor(Math.random() * 5) + 6; // Entre 6 y 10
      
      calificacionesPorPeriodo[row.Periodo].materias.push({
        nombre: row.materia,
        calificacion: calificacionMateria,
        estado: calificacionMateria >= 6 ? 'Aprobada' : 'Reprobada',
        creditos: 5, // Valor por defecto
        docente: row.Docente,
        grupo: row.Grupo,
        actividades: actividadesPorMateria[row.materia] || [] // Agregar actividades
      });
    });

    // Calcular promedios por periodo
    const calificaciones = Object.values(calificacionesPorPeriodo).map(periodo => {
      const sumCalificaciones = periodo.materias.reduce((sum, materia) => sum + materia.calificacion, 0);
      periodo.promedio = periodo.materias.length > 0 ? sumCalificaciones / periodo.materias.length : 0;
      return periodo;
    });

    console.log(`✅ Periodos procesados: ${calificaciones.length}`);
    calificaciones.forEach(periodo => {
      console.log(`   - Periodo ${periodo.periodo}: ${periodo.materias.length} materias, promedio: ${periodo.promedio.toFixed(1)}`);
      periodo.materias.forEach(materia => {
        console.log(`     * ${materia.nombre}: ${materia.actividades.length} actividades`);
      });
    });

    res.json(calificaciones);

  } catch (error) {
    console.error('❌ Error al obtener calificaciones:', error);
    res.status(500).json({ mensaje: 'Error en el servidor al obtener calificaciones' });
  }
};

module.exports = {
  obtenerDatosAlumno,
  cambiarContrasena,
  obtenerActividadesPorAlumno,
  obtenerCalificacionesHistoricas
};