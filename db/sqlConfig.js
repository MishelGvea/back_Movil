require('dotenv').config();
const sql = require('mssql');

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    port: parseInt(process.env.DB_PORT),
    options: {
        encrypt: false,
        trustServerCertificate: true,
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000, // 🟡 tiempo de espera para conexiones inactivas
    },
    requestTimeout: 30000 // 🟢 tiempo de espera para consultas (30 segundos)
};

module.exports = { sql, config };
