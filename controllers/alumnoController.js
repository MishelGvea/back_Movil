const { sql, config } = require('../db/sqlConfig');

// Obtener datos del alumno y materias
const obtenerDatosAlumno = async (req, res) => {
  const { matricula } = req.params;
  const periodoActual = '20243'; // Asegúrate de actualizar esto si cambia el periodo

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
          A.vchClvCuatri AS cuatrimestre
        FROM dbo.tblAlumnos A
        JOIN dbo.tblCarreras C ON C.chrClvCarrera = A.chrClvCarrera
        WHERE RTRIM(A.vchMatricula) = RTRIM(@matricula)
      `);

    const alumnoData = alumno.recordset[0];

    if (!alumnoData) {
      return res.status(404).json({ mensaje: 'Alumno no encontrado' });
    }

    // Obtener materias del alumno desde la vista
    const materiasResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('periodo', sql.VarChar, periodoActual)
      .query(`
        SELECT vchNomMateria AS nombreMateria, Docente, Grupo
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

// Obtener actividades por alumno
const obtenerActividadesPorAlumno = async (req, res) => {
  const { matricula, materia } = req.params;

  try {
    const pool = await sql.connect(config);
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
        INNER JOIN tbl_materias M ON M.vchClvMateria = I.vchClvMateria
        WHERE A.vchMatricula = @matricula 
        AND M.vchNomMateria = @materia
        ORDER BY AG.fecha_entrega
      `);

    console.log('Datos devueltos:', result.recordset);
    res.json(result.recordset);
  } catch (error) {
    console.error('Error al obtener actividades:', error);
    res.status(500).json({ mensaje: 'Error en el servidor al obtener actividades del alumno' });
  }
};

module.exports = {
  obtenerDatosAlumno,
  cambiarContrasena,
  obtenerActividadesPorAlumno
};
