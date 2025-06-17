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
        SELECT DISTINCT
          g.id_Grupo AS idGrupo,
          g.vchGrupo,
          dm.vchCuatrimestre,
          dm.Periodo
        FROM tbl_docente_materia dm
        JOIN tbl_docente_materia_grupo dmg ON dm.idDocenteMateria = dmg.id_DocenteMateria
        JOIN tbl_grupos g ON dmg.id_grupo = g.id_Grupo
        WHERE dm.vchClvTrabajador = @clave AND dm.vchClvMateria = @clvMateria
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Error al obtener grupos del docente:', err);
    res.status(500).json({ mensaje: 'Error en el servidor' });
  }
};

module.exports = {
  obtenerDatosDocente,
  obtenerMateriasPorDocente,
  obtenerGruposPorMateriaDocente
};
