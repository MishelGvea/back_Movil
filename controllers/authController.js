const { sql, config } = require('../db/sqlConfig');

const login = async (req, res) => {
  const { usuario, contrasena } = req.body;

  console.log('📩 Petición recibida desde frontend:', { usuario, contrasena });

  try {
    const pool = await sql.connect(config);

    // Buscar en DOCENTES
    const docenteResult = await pool.request()
      .input('usuario', sql.VarChar, usuario)
      .input('contrasena', sql.VarChar, contrasena)
      .query(`
        SELECT 
          RTRIM(vchClvTrabajador) AS usuario,
          RTRIM(vchNombre) + ' ' + RTRIM(vchAPaterno) + ' ' + RTRIM(vchAMaterno) AS nombreCompleto,
          'profesor' AS rol
        FROM dbo.tbl_docentes
        WHERE RTRIM(vchClvTrabajador) = RTRIM(@usuario)
          AND RTRIM(vchContrasenia) = RTRIM(@contrasena)
      `);

    if (docenteResult.recordset.length > 0) {
      const docente = docenteResult.recordset[0];
      return res.json({
        mensaje: 'Login exitoso como docente',
        usuario: docente.usuario,
        nombre: docente.nombreCompleto,
        rol: docente.rol
      });
    }

    // Buscar en ALUMNOS
    const alumnoResult = await pool.request()
      .input('usuario', sql.VarChar, usuario)
      .input('contrasena', sql.VarChar, contrasena)
      .query(`
        SELECT 
          RTRIM(vchMatricula) AS usuario,
          RTRIM(vchNombre) + ' ' + RTRIM(vchAPaterno) + ' ' + RTRIM(vchAMaterno) AS nombreCompleto,
          'alumno' AS rol
        FROM dbo.tblAlumnos
        WHERE RTRIM(vchMatricula) = RTRIM(@usuario)
          AND RTRIM(vchContrasenia) = RTRIM(@contrasena)
      `);

    if (alumnoResult.recordset.length > 0) {
      const alumno = alumnoResult.recordset[0];
      return res.json({
        mensaje: 'Login exitoso como alumno',
        usuario: alumno.usuario,
        nombre: alumno.nombreCompleto,
        rol: alumno.rol
      });
    }

    return res.status(401).json({ mensaje: 'Credenciales inválidas' });

  } catch (err) {
    console.error('❌ Error en login:', err);
    return res.status(500).json({ mensaje: 'Error en el servidor' });
  }
};

module.exports = { login };
