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
      cuatrimestre: alumnoData.cuatrimestre,
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

module.exports = {
  obtenerDatosAlumno,
  cambiarContrasena,
};
