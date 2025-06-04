const { sql, config } = require('../db/sqlConfig');

const login = async (req, res) => {
    const { usuario, contrasena } = req.body;

    // 👇 Mensaje para verificar lo que recibe el backend desde el frontend
    console.log('📩 Petición recibida desde frontend:', { usuario, contrasena });

    try {
        const pool = await sql.connect(config);
        const result = await pool
            .request()
            .input('usuario', sql.VarChar, usuario)
            .input('contrasena', sql.VarChar, contrasena)
            .query('SELECT * FROM Usuarios WHERE usuario = @usuario AND contrasena = @contrasena');

        // 👇 Mensaje para ver si SQL devolvió resultados
        console.log('📤 Resultado de la consulta:', result.recordset);

        if (result.recordset.length === 0) {
            return res.status(401).json({ mensaje: 'Credenciales inválidas' });
        }

        const user = result.recordset[0];
        res.json({ mensaje: 'Login exitoso', usuario: user.usuario, rol: user.rol });

    } catch (err) {
        console.error('❌ Error en login:', err);
        res.status(500).json({ error: 'Error en el servidor' });
    }
};

module.exports = { login };
