const express = require('express');
const app = express();
const authRoutes = require('./routes/authRoutes');
const alumnoRoutes = require('./routes/alumnoRoutes');
const docenteRoutes = require('./routes/docenteRoutes');
const frasesRoutes = require('./routes/frases');

app.use(express.json());
app.use('/api', authRoutes);
app.use('/api/alumno', alumnoRoutes);
app.use('/api/docente', docenteRoutes);
app.use('/api/frases', frasesRoutes);

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
