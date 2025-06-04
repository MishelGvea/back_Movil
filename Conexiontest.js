const { sql, config } = require('./db/sqlConfig');

(async () => {
  try {
    const pool = await sql.connect(config);
    const result = await pool.request().query('SELECT GETDATE() AS ahora');
    console.log('Conexión exitosa. Fecha/hora del servidor:', result.recordset[0].ahora);
    sql.close();
  } catch (err) {
    console.error('Error al conectar:', err);
  }
})();
