const { sql, config } = require('../db/sqlConfig');

// Función auxiliar para obtener las fechas del cuatrimestre DINÁMICAMENTE
const obtenerFechasCuatrimestre = async (pool, periodo, cuatrimestre) => {
  try {
    console.log(`📅 Consultando fechas dinámicamente para periodo: ${periodo}, cuatrimestre: ${cuatrimestre}`);
    
    // PASO 1: Obtener el idPeriodo desde tbl_materias
    const periodoResult = await pool.request()
      .input('cuatrimestre', sql.VarChar, cuatrimestre)
      .query(`
        SELECT DISTINCT idPeriodo 
        FROM tbl_materias 
        WHERE vchCuatrimestre = @cuatrimestre
      `);

    let idPeriodo = null;
    if (periodoResult.recordset.length > 0) {
      idPeriodo = periodoResult.recordset[0].idPeriodo;
      console.log(`📅 idPeriodo encontrado: ${idPeriodo}`);
    } else {
      console.log(`⚠️ No se encontró idPeriodo para cuatrimestre: ${cuatrimestre}`);
      // DEBUG: Ver qué cuatrimestres existen
      const debugCuatrimestres = await pool.request().query(`
        SELECT DISTINCT vchCuatrimestre, idPeriodo 
        FROM tbl_materias 
        ORDER BY vchCuatrimestre
      `);
      console.log(`📋 Cuatrimestres disponibles en tbl_materias:`, debugCuatrimestres.recordset);
    }

    // PASO 2: Consultar las fechas desde tbl_periodos
    let fechasResult = null;
    if (idPeriodo) {
      fechasResult = await pool.request()
        .input('idPeriodo', sql.Int, idPeriodo)
        .query(`
          SELECT mesInicia, mesTermina
          FROM tbl_periodos 
          WHERE idPeriodo = @idPeriodo
        `);
      
      console.log(`📅 Resultado consulta tbl_periodos:`, fechasResult.recordset);
    } else {
      // DEBUG: Ver toda la tabla tbl_periodos
      const debugPeriodos = await pool.request().query(`
        SELECT * FROM tbl_periodos ORDER BY idPeriodo
      `);
      console.log(`📋 Todos los periodos disponibles en tbl_periodos:`, debugPeriodos.recordset);
    }

    // PASO 3: Calcular fechas dinámicas si tenemos datos
    if (fechasResult && fechasResult.recordset.length > 0) {
      const datos = fechasResult.recordset[0];
      console.log(`📅 Datos obtenidos de tbl_periodos:`, datos);
      
      // Verificar que los datos no sean null/undefined
      if (datos.mesInicia && datos.mesTermina) {
        // CORREGIR: Extraer solo los primeros 4 caracteres para el año
        const año = periodo.substring(0, 4); // "20251" → "2025"
        
        // Como mesInicia y mesTermina son nombres de meses (no números), los usamos directamente
        const mesIniciaTexto = datos.mesInicia;
        const mesTerminaTexto = datos.mesTermina;
        
        // Mapear nombres de meses a números para construir fechas
        const mesesANumeros = {
          'Enero': 1, 'Febrero': 2, 'Marzo': 3, 'Abril': 4,
          'Mayo': 5, 'Junio': 6, 'Julio': 7, 'Agosto': 8,
          'Septiembre': 9, 'Octubre': 10, 'Noviembre': 11, 'Diciembre': 12
        };
        
        const numeroMesInicia = mesesANumeros[mesIniciaTexto];
        const numeroMesTermina = mesesANumeros[mesTerminaTexto];
        
        const fechaInicio = `${año}-${numeroMesInicia.toString().padStart(2, '0')}-01`;
        const fechaFin = `${año}-${numeroMesTermina.toString().padStart(2, '0')}-30`;
        const nombreRango = `${mesIniciaTexto}-${mesTerminaTexto} ${año}`; // CON AÑO
        
        console.log(`✅ Fechas dinámicas calculadas: ${nombreRango}`);
        console.log(`   - Fecha inicio: ${fechaInicio}`);
        console.log(`   - Fecha fin: ${fechaFin}`);
        
        return {
          fechaInicio,
          fechaFin,
          nombreRango, // Con año: "Enero-Abril 2025"
          año,
          origen: 'dinamico'
        };
      } else {
        console.log(`⚠️ mesInicia o mesTermina son null/undefined:`, datos);
      }
    }
    
    // PASO 4: Fallback estático
    console.log(`⚠️ Usando cálculo estático`);
    const año = periodo.substring(0, 4); // "20251" → "2025"
    const rangosCuatrimestres = {
      '1': { inicio: `${año}-01-01`, fin: `${año}-04-30`, nombre: 'Enero-Abril' },
      '2': { inicio: `${año}-05-01`, fin: `${año}-08-31`, nombre: 'Mayo-Agosto' },
      '3': { inicio: `${año}-09-01`, fin: `${año}-12-31`, nombre: 'Septiembre-Diciembre' }
    };
    const rango = rangosCuatrimestres[cuatrimestre] || rangosCuatrimestres['1'];
    
    return {
      fechaInicio: rango.inicio,
      fechaFin: rango.fin,
      nombreRango: `${rango.nombre} ${año}`, // CON AÑO: "Enero-Abril 2025"
      año,
      origen: 'estatico'
    };
    
  } catch (error) {
    console.log('⚠️ Error:', error);
    const añoActual = new Date().getFullYear();
    return {
      fechaInicio: `${añoActual}-01-01`,
      fechaFin: `${añoActual}-04-30`,
      nombreRango: `Enero-Abril ${añoActual}`, // CON AÑO
      año: añoActual.toString(),
      origen: 'default'
    };
  }
};

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
          G.vchGrupo AS grupo,
          A.vchClvCuatri AS cuatrimestre,
          A.vchPeriodo AS periodo
        FROM dbo.tblAlumnos A
        JOIN dbo.tblCarreras C ON C.chrClvCarrera = A.chrClvCarrera
        JOIN dbo.tbl_grupos G ON G.id_grupo = A.chvGrupo
        WHERE RTRIM(A.vchMatricula) = RTRIM(@matricula)
      `);

    const alumnoData = alumno.recordset[0];

    if (!alumnoData) {
      return res.status(404).json({ mensaje: 'Alumno no encontrado' });
    }

    // Calcular las fechas del cuatrimestre DINÁMICAMENTE
    const fechasCuatrimestre = await obtenerFechasCuatrimestre(pool, alumnoData.periodo, alumnoData.cuatrimestre);

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
      materias,
      // Fechas del cuatrimestre dinámicas
      fechasCuatrimestre: {
        fechaInicio: fechasCuatrimestre.fechaInicio,
        fechaFin: fechasCuatrimestre.fechaFin,
        nombreRango: fechasCuatrimestre.nombreRango,
        año: fechasCuatrimestre.año
      }
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
// Obtener actividades por alumno - SIN DUPLICADOS
const obtenerActividadesPorAlumno = async (req, res) => {
  const { matricula, materia } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log('🔍 === INICIO DEBUG ACTIVIDADES ===');
    console.log(`📋 Parámetros recibidos:`);
    console.log(`   - Matrícula: ${matricula}`);
    console.log(`   - Materia: ${materia}`);

    // PASO 1: Obtener datos completos del alumno
    const alumnoResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .query(`
        SELECT 
          vchPeriodo,
          chvGrupo,
          vchClvCuatri
        FROM tblAlumnos 
        WHERE RTRIM(vchMatricula) = RTRIM(@matricula)
      `);

    if (alumnoResult.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Alumno no encontrado' });
    }

    const alumno = alumnoResult.recordset[0];
    console.log(`👤 Datos del alumno encontrados:`);
    console.log(`   - Periodo: ${alumno.vchPeriodo}`);
    console.log(`   - Grupo: ${alumno.chvGrupo}`);
    console.log(`   - Cuatrimestre: ${alumno.vchClvCuatri}`);

    // PASO 2: CONSULTA PRINCIPAL CON CTE PARA EVITAR DUPLICADOS
    const result = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('materia', sql.VarChar, materia)
      .input('periodo_alumno', sql.VarChar, alumno.vchPeriodo)
      .input('grupo_alumno', sql.VarChar, alumno.chvGrupo)
      .query(`
        WITH ActividadesUnicas AS (
          -- MODALIDAD 1: INDIVIDUAL
          SELECT 
            a.id_actividad,
            a.titulo,
            a.descripcion,
            a.id_modalidad,
            CONVERT(VARCHAR, ag.fecha_asignacion, 126) as fecha_asignacion,
            CONVERT(VARCHAR, ag.fecha_entrega, 126) as fecha_entrega,
            ea.nombre_estado as estado,
            ins.nombre as instrumento,
            ti.nombre_tipo as tipoInstrumento,
            CASE 
              WHEN ins.parcial = 1 THEN 'Parcial 1'
              WHEN ins.parcial = 2 THEN 'Parcial 2'
              WHEN ins.parcial = 3 THEN 'Parcial 3'
              ELSE 'Actividad General'
            END as parcial,
            'Individual' as modalidad_tipo,
            1 as prioridad
          FROM tbl_actividades a
          INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
          INNER JOIN tbl_materias m ON ins.vchClvMateria = m.vchClvMateria
          INNER JOIN tbl_estado_actividad ea ON ea.id_estado_actividad = a.id_estado_actividad
          INNER JOIN tbl_tipo_instrumento ti ON ti.id_tipo_instrumento = ins.id_tipo_instrumento
          INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
          INNER JOIN tbl_actividad_alumno aa ON a.id_actividad = aa.id_actividad
          WHERE aa.vchMatricula = @matricula 
          AND m.vchNomMateria = @materia
          AND ins.vchPeriodo = @periodo_alumno
          AND a.id_modalidad = 1

          UNION ALL

          -- MODALIDAD 2: EQUIPO
          SELECT 
            a.id_actividad,
            a.titulo,
            a.descripcion,
            a.id_modalidad,
            CONVERT(VARCHAR, ag.fecha_asignacion, 126) as fecha_asignacion,
            CONVERT(VARCHAR, ag.fecha_entrega, 126) as fecha_entrega,
            ea.nombre_estado as estado,
            ins.nombre as instrumento,
            ti.nombre_tipo as tipoInstrumento,
            CASE 
              WHEN ins.parcial = 1 THEN 'Parcial 1'
              WHEN ins.parcial = 2 THEN 'Parcial 2'
              WHEN ins.parcial = 3 THEN 'Parcial 3'
              ELSE 'Actividad General'
            END as parcial,
            'Equipo' as modalidad_tipo,
            2 as prioridad
          FROM tbl_actividades a
          INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
          INNER JOIN tbl_materias m ON ins.vchClvMateria = m.vchClvMateria
          INNER JOIN tbl_estado_actividad ea ON ea.id_estado_actividad = a.id_estado_actividad
          INNER JOIN tbl_tipo_instrumento ti ON ti.id_tipo_instrumento = ins.id_tipo_instrumento
          INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
          INNER JOIN tbl_actividad_equipo ae ON a.id_actividad = ae.id_actividad
          INNER JOIN tbl_equipos e ON ae.id_equipo = e.id_equipo
          INNER JOIN tbl_equipo_alumno ea_alumno ON e.id_equipo = ea_alumno.id_equipo
          WHERE ea_alumno.vchMatricula = @matricula 
          AND m.vchNomMateria = @materia
          AND ins.vchPeriodo = @periodo_alumno
          AND a.id_modalidad = 2

          UNION ALL

          -- MODALIDAD 3: GRUPO
          SELECT 
            a.id_actividad,
            a.titulo,
            a.descripcion,
            a.id_modalidad,
            CONVERT(VARCHAR, ag.fecha_asignacion, 126) as fecha_asignacion,
            CONVERT(VARCHAR, ag.fecha_entrega, 126) as fecha_entrega,
            ea.nombre_estado as estado,
            ins.nombre as instrumento,
            ti.nombre_tipo as tipoInstrumento,
            CASE 
              WHEN ins.parcial = 1 THEN 'Parcial 1'
              WHEN ins.parcial = 2 THEN 'Parcial 2'
              WHEN ins.parcial = 3 THEN 'Parcial 3'
              ELSE 'Actividad General'
            END as parcial,
            'Grupo' as modalidad_tipo,
            3 as prioridad
          FROM tbl_actividades a
          INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
          INNER JOIN tbl_materias m ON ins.vchClvMateria = m.vchClvMateria
          INNER JOIN tbl_estado_actividad ea ON ea.id_estado_actividad = a.id_estado_actividad
          INNER JOIN tbl_tipo_instrumento ti ON ti.id_tipo_instrumento = ins.id_tipo_instrumento
          INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
          INNER JOIN tbl_grupos g ON ag.id_grupo = g.id_grupo
          WHERE g.vchGrupo = @grupo_alumno 
          AND m.vchNomMateria = @materia
          AND ins.vchPeriodo = @periodo_alumno
          AND a.id_modalidad = 3
        ),
        ActividadesSinDuplicados AS (
          SELECT 
            id_actividad,
            titulo,
            descripcion,
            id_modalidad,
            fecha_asignacion,
            fecha_entrega,
            estado,
            instrumento,
            tipoInstrumento,
            parcial,
            modalidad_tipo,
            ROW_NUMBER() OVER (PARTITION BY id_actividad ORDER BY prioridad) as rn
          FROM ActividadesUnicas
        )
        SELECT 
          id_actividad,
          titulo,
          descripcion,
          id_modalidad,
          fecha_asignacion,
          fecha_entrega,
          estado,
          instrumento,
          tipoInstrumento,
          parcial,
          modalidad_tipo
        FROM ActividadesSinDuplicados
        WHERE rn = 1
        ORDER BY fecha_entrega ASC, titulo ASC
      `);

    console.log(`✅ Actividades encontradas (sin duplicados): ${result.recordset.length}`);
    
    if (result.recordset.length > 0) {
      console.log('📋 Actividades por modalidad:');
      const modalidades = result.recordset.reduce((acc, r) => {
        acc[r.modalidad_tipo] = (acc[r.modalidad_tipo] || 0) + 1;
        return acc;
      }, {});
      
      Object.entries(modalidades).forEach(([modalidad, count]) => {
        console.log(`   - ${modalidad}: ${count} actividades`);
      });

      console.log('📝 Lista de actividades encontradas:');
      result.recordset.forEach(act => {
        console.log(`   * ID: ${act.id_actividad} - ${act.titulo} (${act.modalidad_tipo}) - ${act.estado}`);
      });

      // Verificar IDs únicos
      const ids = result.recordset.map(r => r.id_actividad);
      const idsUnicos = [...new Set(ids)];
      console.log(`🔍 IDs de actividades: ${ids.join(', ')}`);
      console.log(`✅ IDs únicos verificados: ${idsUnicos.length === ids.length ? 'SÍ' : 'NO'}`);
    } else {
      console.log(`ℹ️ No se encontraron actividades para ${matricula} en ${materia} (periodo: ${alumno.vchPeriodo})`);
    }

    console.log('🔍 === FIN DEBUG ACTIVIDADES ===');

    res.json(result.recordset);
    
  } catch (error) {
    console.error('❌ Error al obtener actividades:', error);
    res.status(500).json({ mensaje: 'Error en el servidor al obtener actividades del alumno' });
  }
};

// Obtener calificaciones históricas del alumno - CON TODAS LAS MODALIDADES COMO EN MATERIAS
const obtenerCalificacionesHistoricas = async (req, res) => {
  const { matricula } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`🎓 Obteniendo calificaciones históricas para alumno: ${matricula}`);

    // PASO 1: Obtener datos del alumno (igual que en obtenerActividadesPorAlumno)
    const alumnoResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .query(`
        SELECT 
          vchPeriodo,
          chvGrupo,
          vchClvCuatri,
          vchNombre + ' ' + vchAPaterno + ' ' + vchAMaterno AS nombre_completo
        FROM tblAlumnos 
        WHERE RTRIM(vchMatricula) = RTRIM(@matricula)
      `);

    if (alumnoResult.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Alumno no encontrado' });
    }

    const alumno = alumnoResult.recordset[0];
    console.log(`👤 Alumno: ${alumno.nombre_completo}, Periodo: ${alumno.vchPeriodo}, Grupo: ${alumno.chvGrupo}`);

    // PASO 2: Obtener materias usando la vista
    let materiasResult;
    try {
      materiasResult = await pool.request()
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
        `);
      console.log(`📚 Materias encontradas: ${materiasResult.recordset.length}`);
    } catch (vistaError) {
      console.log(`⚠️ Vista no disponible, usando datos del periodo actual`);
      materiasResult = { recordset: [] };
    }

    // PASO 3: Obtener TODAS las actividades usando la MISMA LÓGICA que obtenerActividadesPorAlumno
    console.log(`📝 Obteniendo TODAS las actividades (Individual + Equipo + Grupo)...`);

    // MODALIDAD 1: INDIVIDUAL
    const actividadesIndividual = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('periodo_alumno', sql.VarChar, alumno.vchPeriodo)
      .query(`
        SELECT 
          a.titulo,
          a.descripcion,
          CONVERT(VARCHAR, ag.fecha_entrega, 126) as fecha_entrega,
          ea.nombre_estado as estado,
          ins.nombre as instrumento,
          ti.nombre_tipo as tipoInstrumento,
          m.vchNomMateria as materia,
          ins.vchPeriodo as periodo,
          CASE 
            WHEN ins.parcial = 1 THEN 'Parcial 1'
            WHEN ins.parcial = 2 THEN 'Parcial 2'
            WHEN ins.parcial = 3 THEN 'Parcial 3'
            ELSE 'Actividad General'
          END as parcial,
          'Individual' as modalidad_tipo
        FROM tbl_actividades a
        INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
        INNER JOIN tbl_materias m ON ins.vchClvMateria = m.vchClvMateria
        INNER JOIN tbl_estado_actividad ea ON ea.id_estado_actividad = a.id_estado_actividad
        INNER JOIN tbl_tipo_instrumento ti ON ti.id_tipo_instrumento = ins.id_tipo_instrumento
        INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
        INNER JOIN tbl_actividad_alumno aa ON a.id_actividad = aa.id_actividad
        WHERE aa.vchMatricula = @matricula 
        AND ins.vchPeriodo = @periodo_alumno
        AND a.id_modalidad = 1
      `);

    console.log(`📝 Actividades Individual: ${actividadesIndividual.recordset.length}`);

    // MODALIDAD 2: EQUIPO
    const actividadesEquipo = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('periodo_alumno', sql.VarChar, alumno.vchPeriodo)
      .query(`
        SELECT 
          a.titulo,
          a.descripcion,
          CONVERT(VARCHAR, ag.fecha_entrega, 126) as fecha_entrega,
          ea.nombre_estado as estado,
          ins.nombre as instrumento,
          ti.nombre_tipo as tipoInstrumento,
          m.vchNomMateria as materia,
          ins.vchPeriodo as periodo,
          CASE 
            WHEN ins.parcial = 1 THEN 'Parcial 1'
            WHEN ins.parcial = 2 THEN 'Parcial 2'
            WHEN ins.parcial = 3 THEN 'Parcial 3'
            ELSE 'Actividad General'
          END as parcial,
          'Equipo' as modalidad_tipo
        FROM tbl_actividades a
        INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
        INNER JOIN tbl_materias m ON ins.vchClvMateria = m.vchClvMateria
        INNER JOIN tbl_estado_actividad ea ON ea.id_estado_actividad = a.id_estado_actividad
        INNER JOIN tbl_tipo_instrumento ti ON ti.id_tipo_instrumento = ins.id_tipo_instrumento
        INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
        INNER JOIN tbl_actividad_equipo ae ON a.id_actividad = ae.id_actividad
        INNER JOIN tbl_equipos e ON ae.id_equipo = e.id_equipo
        INNER JOIN tbl_equipo_alumno ea_alumno ON e.id_equipo = ea_alumno.id_equipo
        WHERE ea_alumno.vchMatricula = @matricula 
        AND ins.vchPeriodo = @periodo_alumno
        AND a.id_modalidad = 2
      `);

    console.log(`📝 Actividades Equipo: ${actividadesEquipo.recordset.length}`);

    // MODALIDAD 3: GRUPO
    const actividadesGrupo = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('periodo_alumno', sql.VarChar, alumno.vchPeriodo)
      .input('grupo_alumno', sql.VarChar, alumno.chvGrupo)
      .query(`
        SELECT 
          a.titulo,
          a.descripcion,
          CONVERT(VARCHAR, ag.fecha_entrega, 126) as fecha_entrega,
          ea.nombre_estado as estado,
          ins.nombre as instrumento,
          ti.nombre_tipo as tipoInstrumento,
          m.vchNomMateria as materia,
          ins.vchPeriodo as periodo,
          CASE 
            WHEN ins.parcial = 1 THEN 'Parcial 1'
            WHEN ins.parcial = 2 THEN 'Parcial 2'
            WHEN ins.parcial = 3 THEN 'Parcial 3'
            ELSE 'Actividad General'
          END as parcial,
          'Grupo' as modalidad_tipo
        FROM tbl_actividades a
        INNER JOIN tbl_instrumento ins ON a.id_instrumento = ins.id_instrumento
        INNER JOIN tbl_materias m ON ins.vchClvMateria = m.vchClvMateria
        INNER JOIN tbl_estado_actividad ea ON ea.id_estado_actividad = a.id_estado_actividad
        INNER JOIN tbl_tipo_instrumento ti ON ti.id_tipo_instrumento = ins.id_tipo_instrumento
        INNER JOIN tbl_actividad_grupo ag ON a.id_actividad = ag.id_actividad
        INNER JOIN tbl_grupos g ON ag.id_grupo = g.id_grupo
        WHERE g.vchGrupo = @grupo_alumno 
        AND ins.vchPeriodo = @periodo_alumno
        AND a.id_modalidad = 3
      `);

    console.log(`📝 Actividades Grupo: ${actividadesGrupo.recordset.length}`);

    // PASO 4: Combinar TODAS las actividades
    const todasLasActividades = [
      ...actividadesIndividual.recordset,
      ...actividadesEquipo.recordset,
      ...actividadesGrupo.recordset
    ];

    console.log(`📝 TOTAL de actividades encontradas: ${todasLasActividades.length}`);
    console.log(`📊 Distribución: Individual: ${actividadesIndividual.recordset.length}, Equipo: ${actividadesEquipo.recordset.length}, Grupo: ${actividadesGrupo.recordset.length}`);

    // PASO 5: Eliminar duplicados por título y materia (en JavaScript)
    const actividadesUnicas = [];
    const titulos_vistos = new Set();

    todasLasActividades.forEach(actividad => {
      const key = `${actividad.titulo}_${actividad.materia}`;
      if (!titulos_vistos.has(key)) {
        titulos_vistos.add(key);
        actividadesUnicas.push(actividad);
      }
    });

    console.log(`📝 Actividades únicas después de eliminar duplicados: ${actividadesUnicas.length}`);

    // PASO 6: Agrupar actividades por materia
    const actividadesPorMateria = {};
    actividadesUnicas.forEach(actividad => {
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
        estado: actividad.estado,
        instrumento: actividad.instrumento,
        parcial: actividad.parcial,
        modalidad: actividad.modalidad_tipo
      });
    });

    // PASO 7: Si no hay materias de la vista, crear basadas en las actividades encontradas
    if (materiasResult.recordset.length === 0 && actividadesUnicas.length > 0) {
      console.log(`📚 Creando materias basadas en actividades encontradas...`);
      
      const materiasDeActividades = [...new Set(actividadesUnicas.map(act => act.materia))];
      materiasResult.recordset = materiasDeActividades.map(materia => ({
        Periodo: alumno.vchPeriodo,
        materia: materia,
        Docente: 'Docente Asignado',
        Grupo: alumno.chvGrupo,
        Cuatrimestre: alumno.vchClvCuatri
      }));
      
      console.log(`📚 Materias creadas: ${materiasResult.recordset.length}`);
    }

    // PASO 8: Agrupar por periodo (igual que antes)
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
      const calificacionMateria = Math.floor(Math.random() * 4) + 7; // Entre 7 y 10
      
      calificacionesPorPeriodo[row.Periodo].materias.push({
        nombre: row.materia,
        calificacion: calificacionMateria,
        estado: calificacionMateria >= 6 ? 'Aprobada' : 'Reprobada',
        creditos: 5,
        docente: row.Docente,
        grupo: row.Grupo,
        actividades: actividadesPorMateria[row.materia] || []
      });
    });

    // PASO 9: Calcular promedios y ordenar
    const calificaciones = Object.values(calificacionesPorPeriodo).map(periodo => {
      const sumCalificaciones = periodo.materias.reduce((sum, materia) => sum + materia.calificacion, 0);
      periodo.promedio = periodo.materias.length > 0 ? 
        Math.round((sumCalificaciones / periodo.materias.length) * 10) / 10 : 0;
      return periodo;
    });

    calificaciones.sort((a, b) => b.periodo.localeCompare(a.periodo));

    console.log(`✅ Procesamiento completado:`);
    console.log(`   - Periodos: ${calificaciones.length}`);
    calificaciones.forEach(periodo => {
      const totalActividades = periodo.materias.reduce((sum, mat) => sum + mat.actividades.length, 0);
      console.log(`   - Periodo ${periodo.periodo}: ${periodo.materias.length} materias, ${totalActividades} actividades, promedio: ${periodo.promedio}`);
      periodo.materias.forEach(materia => {
        console.log(`     * ${materia.nombre}: ${materia.actividades.length} actividades`);
      });
    });

    res.json(calificaciones);

  } catch (error) {
    console.error('❌ Error al obtener calificaciones:', error);
    res.status(500).json({ 
      mensaje: 'Error en el servidor al obtener calificaciones',
      error: error.message 
    });
  }
};

// Obtener detalles de una actividad específica
const obtenerDetalleActividad = async (req, res) => {
  const { matricula, idActividad } = req.params;

  try {
    const pool = await sql.connect(config);

    console.log(`🔍 === INICIO DEBUG DETALLE ACTIVIDAD ===`);
    console.log(`📋 Parámetros recibidos:`);
    console.log(`   - Matrícula: ${matricula}`);
    console.log(`   - ID Actividad: ${idActividad}`);

    // PASO 1: Verificar que la actividad existe y el alumno tiene acceso
    const verificacionResult = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('idActividad', sql.Int, idActividad)
      .query(`
        -- Verificar acceso del alumno a la actividad por modalidad
        SELECT 
          A.vchPeriodo as periodo_alumno,
          A.chvGrupo as grupo_alumno,
          AC.id_modalidad,
          AC.titulo,
          'Verificado' as acceso
        FROM tblAlumnos A
        CROSS JOIN tbl_actividades AC
        WHERE A.vchMatricula = @matricula 
        AND AC.id_actividad = @idActividad
        AND (
          -- Modalidad 1: Individual
          (AC.id_modalidad = 1 AND EXISTS (
            SELECT 1 FROM tbl_actividad_alumno AA 
            WHERE AA.id_actividad = AC.id_actividad 
            AND AA.vchMatricula = @matricula
          ))
          OR
          -- Modalidad 2: Equipo
          (AC.id_modalidad = 2 AND EXISTS (
            SELECT 1 FROM tbl_actividad_equipo AE
            INNER JOIN tbl_equipos E ON E.id_equipo = AE.id_equipo
            INNER JOIN tbl_equipo_alumno EA ON EA.id_equipo = E.id_equipo
            WHERE AE.id_actividad = AC.id_actividad 
            AND EA.vchMatricula = @matricula
          ))
          OR
          -- Modalidad 3: Grupo
          (AC.id_modalidad = 3 AND EXISTS (
            SELECT 1 FROM tbl_actividad_grupo AG
            INNER JOIN tbl_grupos G ON G.id_grupo = AG.id_grupo
            WHERE AG.id_actividad = AC.id_actividad 
            AND G.vchGrupo = A.chvGrupo
          ))
        )
      `);

    if (verificacionResult.recordset.length === 0) {
      console.log(`❌ Actividad ${idActividad} no encontrada o sin acceso para alumno ${matricula}`);
      return res.status(404).json({ mensaje: 'Actividad no encontrada o sin acceso' });
    }

    const verificacion = verificacionResult.recordset[0];
    console.log(`✅ Acceso verificado para actividad ${idActividad} (modalidad: ${verificacion.id_modalidad})`);

    // PASO 2: Obtener detalles completos de la actividad
    const result = await pool.request()
      .input('matricula', sql.VarChar, matricula)
      .input('idActividad', sql.Int, idActividad)
      .query(`
        SELECT 
          AC.id_actividad,
          AC.titulo,
          AC.descripcion,
          CONVERT(VARCHAR, AG.fecha_asignacion, 126) as fecha_asignacion,
          CONVERT(VARCHAR, AG.fecha_entrega, 126) as fecha_entrega,
          EA.nombre_estado as estado,
          I.nombre as instrumento,
          I.valor_total as puntos_total,
          TI.nombre_tipo as tipoInstrumento,
          M.vchNomMateria as materia,
          CONCAT(D.vchNombre, ' ', D.vchAPaterno, ' ', ISNULL(D.vchAMaterno, '')) AS docente,
          CASE 
            WHEN I.parcial = 1 THEN 'Parcial 1'
            WHEN I.parcial = 2 THEN 'Parcial 2'
            WHEN I.parcial = 3 THEN 'Parcial 3'
            ELSE 'Actividad General'
          END as parcial,
          AC.id_modalidad,
          CASE 
            WHEN AC.id_modalidad = 1 THEN 'Individual'
            WHEN AC.id_modalidad = 2 THEN 'Equipo'
            WHEN AC.id_modalidad = 3 THEN 'Grupo'
            ELSE 'Desconocida'
          END as modalidad_nombre
        FROM tbl_actividades AC
        INNER JOIN tbl_instrumento I ON I.id_instrumento = AC.id_instrumento
        INNER JOIN tbl_materias M ON M.vchClvMateria = I.vchClvMateria
        INNER JOIN tbl_estado_actividad EA ON EA.id_estado_actividad = AC.id_estado_actividad
        INNER JOIN tbl_tipo_instrumento TI ON TI.id_tipo_instrumento = I.id_tipo_instrumento
        INNER JOIN tbl_docentes D ON D.vchClvTrabajador = AC.vchClvTrabajador
        INNER JOIN tbl_actividad_grupo AG ON AG.id_actividad = AC.id_actividad
        WHERE AC.id_actividad = @idActividad
      `);

    if (result.recordset.length === 0) {
      console.log(`❌ No se pudieron obtener detalles de la actividad ${idActividad}`);
      return res.status(404).json({ mensaje: 'Detalles de actividad no encontrados' });
    }

    const actividad = result.recordset[0];

    // PASO 3: Generar rúbrica dinámica basada en los puntos totales
    const puntosTotal = actividad.puntos_total || 10;
    const rubrica = [
      {
        criterio: 'Comprensión del tema y contenido correcto',
        puntos: Math.round(puntosTotal * 0.4), // 40% del total
        icono: '🧠'
      },
      {
        criterio: 'Presentación clara y bien estructurada',
        puntos: Math.round(puntosTotal * 0.3), // 30% del total
        icono: '📋'
      },
      {
        criterio: 'Entrega puntual y formato adecuado',
        puntos: Math.round(puntosTotal * 0.3), // 30% del total
        icono: '⏰'
      }
    ];

    // Ajustar para que la suma sea exacta
    const sumaRubrica = rubrica.reduce((sum, item) => sum + item.puntos, 0);
    if (sumaRubrica !== puntosTotal) {
      rubrica[0].puntos += (puntosTotal - sumaRubrica);
    }

    // PASO 4: Formatear respuesta completa
    const response = {
      id_actividad: actividad.id_actividad,
      titulo: actividad.titulo,
      descripcion: actividad.descripcion || 'Sin descripción disponible',
      fecha_asignacion: actividad.fecha_asignacion,
      fecha_entrega: actividad.fecha_entrega,
      estado: actividad.estado,
      instrumento: actividad.instrumento,
      tipoInstrumento: actividad.tipoInstrumento,
      materia: actividad.materia,
      docente: actividad.docente,
      parcial: actividad.parcial,
      puntos_total: puntosTotal,
      id_modalidad: actividad.id_modalidad,
      modalidad_nombre: actividad.modalidad_nombre,
      rubrica: rubrica
    };

    console.log(`✅ Detalle de actividad obtenido exitosamente:`);
    console.log(`   - Título: ${response.titulo}`);
    console.log(`   - Modalidad: ${response.modalidad_nombre}`);
    console.log(`   - Estado: ${response.estado}`);
    console.log(`   - Puntos: ${response.puntos_total}`);
    console.log(`   - Rúbrica: ${rubrica.length} criterios`);
    console.log(`🔍 === FIN DEBUG DETALLE ACTIVIDAD ===`);

    res.json(response);

  } catch (error) {
    console.error('❌ Error al obtener detalle de actividad:', error);
    res.status(500).json({ 
      mensaje: 'Error en el servidor al obtener detalle de actividad',
      error: error.message 
    });
  }
};

module.exports = {
  obtenerDatosAlumno,
  cambiarContrasena,
  obtenerActividadesPorAlumno,
  obtenerCalificacionesHistoricas, 
  obtenerDetalleActividad
};