const { sql, config } = require('../db/sqlConfig');
const ExcelJS = require('exceljs'); // npm install exceljs
const puppeteer = require('puppeteer'); // npm install puppeteer
const path = require('path');
const fs = require('fs');

// ===============================================
// 🔍 FUNCIONES PARA OBTENER FILTROS DINÁMICOS
// ===============================================

// Obtener parciales disponibles para un docente/materia
const obtenerParcialesDisponibles = async (req, res) => {
  const { claveDocente, claveMateria } = req.params;

  try {
    const pool = await sql.connect(config);
    
    console.log(`🔍 Obteniendo parciales disponibles para docente: ${claveDocente}, materia: ${claveMateria}`);

    const result = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .query(`
        SELECT DISTINCT 
          vcf.Parcial,
          'Parcial ' + CAST(vcf.Parcial AS NVARCHAR) AS nombre_parcial,
          COUNT(DISTINCT vcf.Matricula) as total_alumnos,
          COUNT(DISTINCT vcf.Actividades) as total_actividades
        FROM vw_Calificaciones_Final vcf
        WHERE vcf.Clave = @claveDocente 
          AND vcf.Clave_Materia = @claveMateria
        GROUP BY vcf.Parcial
        ORDER BY vcf.Parcial
      `);

    console.log(`✅ Parciales encontrados: ${result.recordset.length}`);
    
    res.json({
      parciales: result.recordset,
      total: result.recordset.length
    });

  } catch (error) {
    console.error('❌ Error al obtener parciales:', error);
    res.status(500).json({ error: 'Error al obtener parciales disponibles' });
  }
};

// Obtener grupos disponibles para un docente/materia
const obtenerGruposDisponibles = async (req, res) => {
  const { claveDocente, claveMateria } = req.params;

  try {
    const pool = await sql.connect(config);
    
    console.log(`🔍 Obteniendo grupos disponibles para docente: ${claveDocente}, materia: ${claveMateria}`);

    const result = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .query(`
        SELECT DISTINCT 
          vcf.Grupo,
          'Grupo ' + vcf.Grupo AS nombre_grupo,
          COUNT(DISTINCT vcf.Matricula) as total_alumnos,
          COUNT(DISTINCT vcf.Parcial) as parciales_con_datos
        FROM vw_Calificaciones_Final vcf
        WHERE vcf.Clave = @claveDocente 
          AND vcf.Clave_Materia = @claveMateria
        GROUP BY vcf.Grupo
        ORDER BY vcf.Grupo
      `);

    console.log(`✅ Grupos encontrados: ${result.recordset.length}`);
    
    res.json({
      grupos: result.recordset,
      total: result.recordset.length
    });

  } catch (error) {
    console.error('❌ Error al obtener grupos:', error);
    res.status(500).json({ error: 'Error al obtener grupos disponibles' });
  }
};

// Obtener periodos y cuatrimestres disponibles para un docente/materia
const obtenerPeriodosDisponibles = async (req, res) => {
  const { claveDocente, claveMateria } = req.params;

  try {
    const pool = await sql.connect(config);
    
    console.log(`🔍 Obteniendo periodos disponibles para docente: ${claveDocente}, materia: ${claveMateria}`);

    const result = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .input('claveMateria', sql.VarChar, claveMateria)
      .query(`
        SELECT DISTINCT 
          vcf.Periodo,
          vcf.Cuatrimestre,
          CONCAT('Periodo ', vcf.Periodo, ' - Cuatrimestre ', vcf.Cuatrimestre) AS nombre_periodo,
          COUNT(DISTINCT vcf.Matricula) as total_alumnos,
          COUNT(DISTINCT vcf.Grupo) as total_grupos
        FROM vw_Calificaciones_Final vcf
        WHERE vcf.Clave = @claveDocente 
          AND vcf.Clave_Materia = @claveMateria
        GROUP BY vcf.Periodo, vcf.Cuatrimestre
        ORDER BY vcf.Periodo DESC, vcf.Cuatrimestre
      `);

    console.log(`✅ Periodos encontrados: ${result.recordset.length}`);
    
    res.json({
      periodos: result.recordset,
      total: result.recordset.length
    });

  } catch (error) {
    console.error('❌ Error al obtener periodos:', error);
    res.status(500).json({ error: 'Error al obtener periodos disponibles' });
  }
};

// Obtener materias con datos disponibles para reportes
const obtenerMateriasConDatos = async (req, res) => {
  const { claveDocente } = req.params;

  try {
    const pool = await sql.connect(config);
    
    console.log(`🔍 Obteniendo materias con datos para docente: ${claveDocente}`);

    const result = await pool.request()
      .input('claveDocente', sql.VarChar, claveDocente)
      .query(`
        SELECT DISTINCT 
          vcf.Clave_Materia,
          vcf.Nombre_materia,
          COUNT(DISTINCT vcf.Grupo) as total_grupos,
          COUNT(DISTINCT vcf.Matricula) as total_alumnos,
          COUNT(DISTINCT vcf.Parcial) as parciales_con_datos,
          MIN(vcf.Periodo) as periodo_inicio,
          MAX(vcf.Periodo) as periodo_actual
        FROM vw_Calificaciones_Final vcf
        WHERE vcf.Clave = @claveDocente
        GROUP BY vcf.Clave_Materia, vcf.Nombre_materia
        ORDER BY vcf.Nombre_materia
      `);

    console.log(`✅ Materias con datos encontradas: ${result.recordset.length}`);
    
    res.json({
      materias: result.recordset,
      total: result.recordset.length
    });

  } catch (error) {
    console.error('❌ Error al obtener materias:', error);
    res.status(500).json({ error: 'Error al obtener materias disponibles' });
  }
};

// ===============================================
// 📊 FUNCIONES AUXILIARES PARA OBTENER DATOS
// ===============================================

// Función auxiliar para ejecutar sp_FiltrarConcentradoFinal
const obtenerDatosConcentrado = async (filtros) => {
  const { parcial, grupo, periodo, cuatrimestre, materia } = filtros;
  
  try {
    const pool = await sql.connect(config);
    
    console.log(`📊 Ejecutando sp_FiltrarConcentradoFinal:`);
    console.log(`   - Parcial: ${parcial}, Grupo: ${grupo}`);
    console.log(`   - Periodo: ${periodo}, Cuatrimestre: ${cuatrimestre}`);
    console.log(`   - Materia: ${materia}`);

    const result = await pool.request()
      .input('Parcial', sql.Int, parseInt(parcial))
      .input('Grupo', sql.VarChar, grupo)
      .input('Periodo', sql.VarChar, periodo)
      .input('Cuatrimestre', sql.VarChar, cuatrimestre)
      .input('Materia', sql.VarChar, materia)
      .execute('sp_FiltrarConcentradoFinal');

    if (result.recordset.length === 0) {
      throw new Error('No se encontraron datos para los filtros seleccionados');
    }

    console.log(`✅ Datos obtenidos: ${result.recordset.length} registros`);
    return result.recordset;

  } catch (error) {
    console.error('❌ Error al obtener datos del concentrado:', error);
    throw error;
  }
};

// Función auxiliar para ejecutar sp_ReporteCalificaciones
const obtenerDatosDetallado = async (filtros) => {
  const { parcial, grupo, periodo, cuatrimestre, materia } = filtros;
  
  try {
    const pool = await sql.connect(config);
    
    console.log(`📋 Ejecutando sp_ReporteCalificaciones:`);
    console.log(`   - Parcial: ${parcial}, Grupo: ${grupo}`);
    console.log(`   - Periodo: ${periodo}, Cuatrimestre: ${cuatrimestre}`);
    console.log(`   - Materia: ${materia}`);

    const result = await pool.request()
      .input('Periodo', sql.VarChar, periodo)
      .input('Parcial', sql.Int, parseInt(parcial))
      .input('Cuatrimestre', sql.VarChar, cuatrimestre)
      .input('Grupo', sql.VarChar, grupo)
      .input('Materia', sql.VarChar, materia)
      .execute('sp_ReporteCalificaciones');

    if (result.recordset.length === 0) {
      throw new Error('No se encontraron actividades para los filtros seleccionados');
    }

    console.log(`✅ Datos obtenidos: ${result.recordset.length} registros`);
    return result.recordset;

  } catch (error) {
    console.error('❌ Error al obtener datos detallados:', error);
    throw error;
  }
};

// ===============================================
// 📄 FUNCIONES DE EXPORTACIÓN A EXCEL - STREAM DIRECTO
// ===============================================

// Generar concentrado final en Excel (Stream directo)
const generarConcentradoExcel = async (req, res) => {
  try {
    const filtros = req.body;
    console.log(`📊 Generando concentrado Excel con filtros:`, filtros);

    // Obtener datos del SP
    const datos = await obtenerDatosConcentrado(filtros);
    
    // Crear workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Concentrado Final');

    // Configurar metadatos del archivo
    workbook.creator = 'Sistema UTHH';
    workbook.created = new Date();
    workbook.modified = new Date();

    // Título del reporte
    const titulo = `Concentrado Final - ${filtros.materia}`;
    const subtitulo = `Parcial ${filtros.parcial} - Grupo ${filtros.grupo} - Periodo ${filtros.periodo}`;

    // HEADER SECTION
    worksheet.mergeCells('A1:H1');
    worksheet.getCell('A1').value = titulo;
    worksheet.getCell('A1').font = { size: 16, bold: true };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A2:H2');
    worksheet.getCell('A2').value = subtitulo;
    worksheet.getCell('A2').font = { size: 12, italic: true };
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    // Información de generación
    worksheet.getCell('A3').value = `Generado: ${new Date().toLocaleString('es-MX')}`;
    worksheet.getCell('A3').font = { size: 10, italic: true };

    // STATISTICS SECTION
    const stats = calcularEstadisticasConcentrado(datos);
    worksheet.getCell('A5').value = 'Estadísticas Generales:';
    worksheet.getCell('A5').font = { bold: true };
    
    worksheet.getCell('A6').value = `Total de alumnos: ${stats.totalAlumnos}`;
    worksheet.getCell('A7').value = `Promedio general: ${stats.promedioGeneral}`;
    worksheet.getCell('A8').value = `Aprobados: ${stats.aprobados} (${stats.porcentajeAprobados}%)`;
    worksheet.getCell('A9').value = `Reprobados: ${stats.reprobados} (${stats.porcentajeReprobados}%)`;

    // TABLE HEADERS (fila 11)
    const inicioTabla = 11;
    if (datos.length > 0) {
      const headers = Object.keys(datos[0]);
      
      // Crear encabezados con formato
      headers.forEach((header, index) => {
        const cell = worksheet.getCell(inicioTabla, index + 1);
        cell.value = header;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF009944' }
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        cell.alignment = { horizontal: 'center' };
      });

      // DATA ROWS
      datos.forEach((fila, filaIndex) => {
        Object.values(fila).forEach((valor, colIndex) => {
          const cell = worksheet.getCell(inicioTabla + 1 + filaIndex, colIndex + 1);
          cell.value = valor;
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
          
          // Colorear calificaciones finales
          if (headers[colIndex] === 'Calificacion Final') {
            const calificacion = parseFloat(valor) || 0;
            if (calificacion >= 8) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4EDDA' } }; // Verde
            } else if (calificacion >= 6) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } }; // Amarillo
            } else {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } }; // Rojo
            }
          }
        });
      });

      // Auto-ajustar anchos de columna
      worksheet.columns.forEach(column => {
        column.width = 15;
      });
    }

    // CONFIGURAR HEADERS PARA DESCARGA
    const filename = `Concentrado_${filtros.materia.replace(/\s+/g, '_')}_P${filtros.parcial}_G${filtros.grupo}_${Date.now()}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    // STREAM DIRECTO - ¡Esta es la magia! 🎯
    console.log(`📁 Enviando archivo Excel: ${filename}`);
    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('❌ Error al generar concentrado Excel:', error);
    res.status(500).json({ 
      error: 'Error al generar reporte Excel',
      detalle: error.message 
    });
  }
};

// Generar reporte detallado en Excel (Stream directo)
const generarDetalladoExcel = async (req, res) => {
  try {
    const filtros = req.body;
    console.log(`📋 Generando reporte detallado Excel con filtros:`, filtros);

    // Obtener datos del SP
    const datos = await obtenerDatosDetallado(filtros);
    
    // Crear workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Reporte Detallado');

    // Configurar metadatos
    workbook.creator = 'Sistema UTHH';
    workbook.created = new Date();

    // Título del reporte
    const titulo = `Reporte Detallado de Actividades - ${filtros.materia}`;
    const subtitulo = `Parcial ${filtros.parcial} - Grupo ${filtros.grupo} - Periodo ${filtros.periodo}`;

    // HEADER SECTION
    worksheet.mergeCells('A1:J1');
    worksheet.getCell('A1').value = titulo;
    worksheet.getCell('A1').font = { size: 16, bold: true };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A2:J2');
    worksheet.getCell('A2').value = subtitulo;
    worksheet.getCell('A2').font = { size: 12, italic: true };
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    // Información de generación
    worksheet.getCell('A3').value = `Generado: ${new Date().toLocaleString('es-MX')}`;
    worksheet.getCell('A3').font = { size: 10, italic: true };

    // STATISTICS SECTION
    const stats = calcularEstadisticasDetallado(datos);
    worksheet.getCell('A5').value = 'Información del Reporte:';
    worksheet.getCell('A5').font = { bold: true };
    
    worksheet.getCell('A6').value = `Total de alumnos: ${stats.totalAlumnos}`;
    worksheet.getCell('A7').value = `Total de actividades: ${stats.totalActividades}`;
    worksheet.getCell('A8').value = `Rango de calificaciones: ${stats.rangoCalificaciones}`;

    // TABLE HEADERS (fila 10)
    const inicioTabla = 10;
    if (datos.length > 0) {
      const headers = Object.keys(datos[0]);
      
      // Crear encabezados con formato
      headers.forEach((header, index) => {
        const cell = worksheet.getCell(inicioTabla, index + 1);
        cell.value = header;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF2E8B57' }
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        cell.alignment = { horizontal: 'center' };
      });

      // DATA ROWS
      datos.forEach((fila, filaIndex) => {
        Object.values(fila).forEach((valor, colIndex) => {
          const cell = worksheet.getCell(inicioTabla + 1 + filaIndex, colIndex + 1);
          cell.value = valor;
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
          
          // Colorear calificaciones de actividades
          if (headers[colIndex].includes(' - ') && typeof valor === 'number') {
            if (valor >= 8) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4EDDA' } };
            } else if (valor >= 6) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
            } else if (valor > 0) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } };
            }
          }
        });
      });

      // Auto-ajustar anchos de columna
      worksheet.columns.forEach(column => {
        column.width = 12;
      });
    }

    // CONFIGURAR HEADERS PARA DESCARGA
    const filename = `Detallado_${filtros.materia.replace(/\s+/g, '_')}_P${filtros.parcial}_G${filtros.grupo}_${Date.now()}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    // STREAM DIRECTO
    console.log(`📁 Enviando archivo Excel: ${filename}`);
    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('❌ Error al generar reporte detallado Excel:', error);
    res.status(500).json({ 
      error: 'Error al generar reporte Excel',
      detalle: error.message 
    });
  }
};

// ===============================================
// 📊 FUNCIONES DE EXPORTACIÓN A PDF - STREAM DIRECTO
// ===============================================

// Generar concentrado final en PDF con gráficos (Stream directo)
const generarConcentradoPDF = async (req, res) => {
  let browser = null;
  
  try {
    const filtros = req.body;
    console.log(`📊 Generando concentrado PDF con gráficos:`, filtros);

    // Obtener datos del SP
    const datos = await obtenerDatosConcentrado(filtros);
    const stats = calcularEstadisticasConcentrado(datos);

    // Generar HTML con gráficos
    const htmlContent = generarHTMLConcentrado(datos, filtros, stats);

    // Configurar Puppeteer
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    // Generar PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: {
        top: '20mm',
        right: '15mm',
        bottom: '20mm',
        left: '15mm'
      },
      printBackground: true
    });

    await browser.close();

    // CONFIGURAR HEADERS PARA DESCARGA
    const filename = `Concentrado_${filtros.materia.replace(/\s+/g, '_')}_P${filtros.parcial}_G${filtros.grupo}_${Date.now()}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    // STREAM DIRECTO
    console.log(`📁 Enviando archivo PDF: ${filename}`);
    res.send(pdfBuffer);

  } catch (error) {
    if (browser) await browser.close();
    console.error('❌ Error al generar concentrado PDF:', error);
    res.status(500).json({ 
      error: 'Error al generar reporte PDF',
      detalle: error.message 
    });
  }
};

// Generar reporte detallado en PDF (Stream directo)
const generarDetalladoPDF = async (req, res) => {
  let browser = null;
  
  try {
    const filtros = req.body;
    console.log(`📋 Generando reporte detallado PDF:`, filtros);

    // Obtener datos del SP
    const datos = await obtenerDatosDetallado(filtros);
    const stats = calcularEstadisticasDetallado(datos);

    // Generar HTML
    const htmlContent = generarHTMLDetallado(datos, filtros, stats);

    // Configurar Puppeteer
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    // Generar PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: true, // Horizontal para ver mejor las actividades
      margin: {
        top: '15mm',
        right: '10mm',
        bottom: '15mm',
        left: '10mm'
      },
      printBackground: true
    });

    await browser.close();

    // CONFIGURAR HEADERS PARA DESCARGA
    const filename = `Detallado_${filtros.materia.replace(/\s+/g, '_')}_P${filtros.parcial}_G${filtros.grupo}_${Date.now()}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    // STREAM DIRECTO
    console.log(`📁 Enviando archivo PDF: ${filename}`);
    res.send(pdfBuffer);

  } catch (error) {
    if (browser) await browser.close();
    console.error('❌ Error al generar reporte detallado PDF:', error);
    res.status(500).json({ 
      error: 'Error al generar reporte PDF',
      detalle: error.message 
    });
  }
};

// ===============================================
// 🧮 FUNCIONES AUXILIARES PARA ESTADÍSTICAS
// ===============================================

// Calcular estadísticas del concentrado
const calcularEstadisticasConcentrado = (datos) => {
  const totalAlumnos = datos.length;
  const calificacionesFinales = datos
    .map(alumno => parseFloat(alumno['Calificacion Final']) || 0)
    .filter(cal => cal > 0);

  const promedioGeneral = calificacionesFinales.length > 0 ? 
    (calificacionesFinales.reduce((sum, cal) => sum + cal, 0) / calificacionesFinales.length).toFixed(2) : '0.00';

  const aprobados = calificacionesFinales.filter(cal => cal >= 6).length;
  const reprobados = calificacionesFinales.filter(cal => cal < 6).length;

  return {
    totalAlumnos,
    promedioGeneral,
    aprobados,
    reprobados,
    porcentajeAprobados: totalAlumnos > 0 ? ((aprobados / totalAlumnos) * 100).toFixed(1) : '0.0',
    porcentajeReprobados: totalAlumnos > 0 ? ((reprobados / totalAlumnos) * 100).toFixed(1) : '0.0',
    calificacionMaxima: calificacionesFinales.length > 0 ? Math.max(...calificacionesFinales).toFixed(2) : '0.00',
    calificacionMinima: calificacionesFinales.length > 0 ? Math.min(...calificacionesFinales).toFixed(2) : '0.00'
  };
};

// Calcular estadísticas del reporte detallado
const calcularEstadisticasDetallado = (datos) => {
  const totalAlumnos = datos.length;
  
  // Obtener columnas de actividades (las que contienen ' - ')
  const columnasActividades = datos.length > 0 ? 
    Object.keys(datos[0]).filter(col => col.includes(' - ')) : [];
  
  const totalActividades = columnasActividades.length;

  // Calcular rango de calificaciones
  let todasLasCalificaciones = [];
  datos.forEach(alumno => {
    columnasActividades.forEach(columna => {
      const calificacion = parseFloat(alumno[columna]);
      if (!isNaN(calificacion) && calificacion > 0) {
        todasLasCalificaciones.push(calificacion);
      }
    });
  });

  const rangoCalificaciones = todasLasCalificaciones.length > 0 ? 
    `${Math.min(...todasLasCalificaciones).toFixed(1)} - ${Math.max(...todasLasCalificaciones).toFixed(1)}` : 'N/A';

  return {
    totalAlumnos,
    totalActividades,
    rangoCalificaciones
  };
};

// ===============================================
// 🎨 FUNCIONES PARA GENERAR HTML CON GRÁFICOS
// ===============================================

// Generar HTML para concentrado con gráficos
const generarHTMLConcentrado = (datos, filtros, stats) => {
  // Preparar datos para gráfico de pastel
  const datosGrafico = {
    aprobados: parseInt(stats.aprobados),
    reprobados: parseInt(stats.reprobados)
  };

  // Preparar datos para histograma de calificaciones
  const calificaciones = datos.map(alumno => parseFloat(alumno['Calificacion Final']) || 0);
  const rangos = ['0-2', '2-4', '4-6', '6-8', '8-10'];
  const conteoRangos = [0, 0, 0, 0, 0];
  
  calificaciones.forEach(cal => {
    if (cal >= 0 && cal < 2) conteoRangos[0]++;
    else if (cal >= 2 && cal < 4) conteoRangos[1]++;
    else if (cal >= 4 && cal < 6) conteoRangos[2]++;
    else if (cal >= 6 && cal < 8) conteoRangos[3]++;
    else if (cal >= 8 && cal <= 10) conteoRangos[4]++;
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Concentrado Final</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; font-size: 12px; }
            .header { text-align: center; margin-bottom: 30px; }
            .title { font-size: 24px; font-weight: bold; color: #009944; }
            .subtitle { font-size: 16px; color: #666; margin-top: 5px; }
            .generated { font-size: 10px; color: #999; margin-top: 10px; }
            
            .stats { display: flex; justify-content: space-around; margin: 20px 0; }
            .stat-card { 
                background: linear-gradient(135deg, #009944, #00b359); 
                color: white; 
                padding: 15px; 
                border-radius: 10px; 
                text-align: center; 
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }
            .stat-number { font-size: 24px; font-weight: bold; }
            .stat-label { font-size: 12px; opacity: 0.9; }
            
            .charts-section { margin: 30px 0; }
            .chart-container { 
                width: 45%; 
                height: 300px; 
                display: inline-block; 
                margin: 20px 2.5%; 
                background: white; 
                border-radius: 10px; 
                padding: 20px; 
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            
            .table-container { margin: 30px 0; }
            table { 
                width: 100%; 
                border-collapse: collapse; 
                font-size: 10px; 
                background: white;
                border-radius: 8px;
                overflow: hidden;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            th { 
                background: #009944; 
                color: white; 
                padding: 10px 5px; 
                text-align: center; 
                font-weight: bold;
            }
            td { 
                padding: 8px 5px; 
                text-align: center; 
                border-bottom: 1px solid #eee; 
            }
            .aprobado { background-color: #d4edda; }
            .reprobado { background-color: #f8d7da; }
            .regular { background-color: #fff3cd; }
            
            .footer { 
                text-align: center; 
                margin-top: 30px; 
                padding: 20px; 
                background: #f8f9fa; 
                border-radius: 8px;
            }
            .logo { color: #009944; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="header">
            <div class="title">📊 Concentrado Final de Calificaciones</div>
            <div class="subtitle">${filtros.materia}</div>
            <div class="subtitle">Parcial ${filtros.parcial} - Grupo ${filtros.grupo} - Periodo ${filtros.periodo}</div>
            <div class="generated">Generado: ${new Date().toLocaleString('es-MX')}</div>
        </div>

        <div class="stats">
            <div class="stat-card">
                <div class="stat-number">${stats.totalAlumnos}</div>
                <div class="stat-label">Total Alumnos</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.promedioGeneral}</div>
                <div class="stat-label">Promedio General</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.aprobados}</div>
                <div class="stat-label">Aprobados (${stats.porcentajeAprobados}%)</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.reprobados}</div>
                <div class="stat-label">Reprobados (${stats.porcentajeReprobados}%)</div>
            </div>
        </div>

        <div class="charts-section">
            <div class="chart-container">
                <canvas id="pieChart"></canvas>
            </div>
            <div class="chart-container">
                <canvas id="barChart"></canvas>
            </div>
        </div>

        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        ${Object.keys(datos[0]).map(header => `<th>${header}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${datos.map(fila => `
                        <tr>
                            ${Object.entries(fila).map(([key, valor]) => {
                                let className = '';
                                if (key === 'Calificacion Final') {
                                    const cal = parseFloat(valor) || 0;
                                    className = cal >= 8 ? 'aprobado' : cal >= 6 ? 'regular' : 'reprobado';
                                }
                                return `<td class="${className}">${valor || ''}</td>`;
                            }).join('')}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div class="footer">
            <div class="logo">🎓 Universidad Tecnológica de la Huasteca Hidalguense (UTHH)</div>
            <div>Sistema de Gestión Académica - Reportes de Calificaciones</div>
            <div style="font-size: 10px; color: #666; margin-top: 5px;">© 2025 - Plataforma Docente UTHH</div>
        </div>

        <script>
            // Gráfico de Pastel - Aprobados vs Reprobados
            const ctxPie = document.getElementById('pieChart').getContext('2d');
            new Chart(ctxPie, {
                type: 'pie',
                data: {
                    labels: ['Aprobados', 'Reprobados'],
                    datasets: [{
                        data: [${datosGrafico.aprobados}, ${datosGrafico.reprobados}],
                        backgroundColor: ['#28a745', '#dc3545'],
                        borderWidth: 2,
                        borderColor: '#fff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: {
                            display: true,
                            text: 'Distribución de Calificaciones',
                            font: { size: 16, weight: 'bold' }
                        },
                        legend: {
                            position: 'bottom'
                        }
                    }
                }
            });

            // Gráfico de Barras - Histograma de Calificaciones
            const ctxBar = document.getElementById('barChart').getContext('2d');
            new Chart(ctxBar, {
                type: 'bar',
                data: {
                    labels: ${JSON.stringify(rangos)},
                    datasets: [{
                        label: 'Número de Alumnos',
                        data: ${JSON.stringify(conteoRangos)},
                        backgroundColor: [
                            '#dc3545', '#fd7e14', '#ffc107', '#28a745', '#20c997'
                        ],
                        borderColor: [
                            '#dc3545', '#fd7e14', '#ffc107', '#28a745', '#20c997'
                        ],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: {
                            display: true,
                            text: 'Distribución por Rangos de Calificación',
                            font: { size: 16, weight: 'bold' }
                        },
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                stepSize: 1
                            }
                        }
                    }
                }
            });
        </script>
    </body>
    </html>
  `;
};

// Generar HTML para reporte detallado
const generarHTMLDetallado = (datos, filtros, stats) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Reporte Detallado</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 15px; font-size: 10px; }
            .header { text-align: center; margin-bottom: 20px; }
            .title { font-size: 20px; font-weight: bold; color: #2E8B57; }
            .subtitle { font-size: 14px; color: #666; margin-top: 5px; }
            .generated { font-size: 9px; color: #999; margin-top: 8px; }
            
            .info-section { 
                display: flex; 
                justify-content: space-around; 
                margin: 15px 0; 
                background: #f8f9fa; 
                padding: 15px; 
                border-radius: 8px; 
            }
            .info-card { text-align: center; }
            .info-number { font-size: 18px; font-weight: bold; color: #2E8B57; }
            .info-label { font-size: 10px; color: #666; }
            
            .table-container { margin: 20px 0; }
            table { 
                width: 100%; 
                border-collapse: collapse; 
                font-size: 8px; 
                background: white;
                border-radius: 6px;
                overflow: hidden;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            th { 
                background: #2E8B57; 
                color: white; 
                padding: 8px 4px; 
                text-align: center; 
                font-weight: bold;
                font-size: 8px;
            }
            td { 
                padding: 6px 4px; 
                text-align: center; 
                border-bottom: 1px solid #eee; 
                font-size: 8px;
            }
            .actividad-col { background-color: #f0f8f0; }
            .excelente { background-color: #d4edda; color: #155724; font-weight: bold; }
            .bueno { background-color: #d1ecf1; color: #0c5460; }
            .regular { background-color: #fff3cd; color: #856404; }
            .malo { background-color: #f8d7da; color: #721c24; }
            .sin-calificar { background-color: #f8f9fa; color: #6c757d; font-style: italic; }
            
            .footer { 
                text-align: center; 
                margin-top: 20px; 
                padding: 15px; 
                background: #f8f9fa; 
                border-radius: 6px;
                font-size: 9px;
            }
            .logo { color: #2E8B57; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="header">
            <div class="title">📋 Reporte Detallado de Actividades</div>
            <div class="subtitle">${filtros.materia}</div>
            <div class="subtitle">Parcial ${filtros.parcial} - Grupo ${filtros.grupo} - Periodo ${filtros.periodo}</div>
            <div class="generated">Generado: ${new Date().toLocaleString('es-MX')}</div>
        </div>

        <div class="info-section">
            <div class="info-card">
                <div class="info-number">${stats.totalAlumnos}</div>
                <div class="info-label">Total de Alumnos</div>
            </div>
            <div class="info-card">
                <div class="info-number">${stats.totalActividades}</div>
                <div class="info-label">Actividades Evaluadas</div>
            </div>
            <div class="info-card">
                <div class="info-number">${stats.rangoCalificaciones}</div>
                <div class="info-label">Rango de Calificaciones</div>
            </div>
        </div>

        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        ${Object.keys(datos[0]).map(header => `<th>${header}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${datos.map(fila => `
                        <tr>
                            ${Object.entries(fila).map(([key, valor]) => {
                                let className = '';
                                
                                // Colorear información básica
                                if (['Matricula', 'Nombre_Alumno', 'Grupo'].includes(key)) {
                                    className = 'actividad-col';
                                }
                                // Colorear calificaciones de actividades
                                else if (key.includes(' - ') && typeof valor === 'number') {
                                    if (valor >= 9) className = 'excelente';
                                    else if (valor >= 7) className = 'bueno';
                                    else if (valor >= 6) className = 'regular';
                                    else if (valor > 0) className = 'malo';
                                    else className = 'sin-calificar';
                                }
                                
                                return `<td class="${className}">${valor || 'N/A'}</td>`;
                            }).join('')}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div class="footer">
            <div class="logo">🎓 Universidad Tecnológica de la Huasteca Hidalguense (UTHH)</div>
            <div>Sistema de Gestión Académica - Reportes Detallados</div>
            <div style="color: #666; margin-top: 3px;">© 2025 - Plataforma Docente UTHH</div>
        </div>
    </body>
    </html>
  `;
};

// ===============================================
// 📋 FUNCIÓN PARA VISTA PREVIA DE DATOS (SIN ARCHIVO)
// ===============================================

// Vista previa del concentrado (solo datos JSON)
const previsualizarConcentrado = async (req, res) => {
  try {
    const filtros = req.body;
    console.log(`👁️ Generando vista previa del concentrado:`, filtros);

    // Obtener datos del SP
    const datos = await obtenerDatosConcentrado(filtros);
    
    // Extraer metadatos del resultado
    const primeraFila = datos[0];
    const columnas = Object.keys(primeraFila);
    
    // Separar columnas por tipo
    const columnasBasicas = ['Nombre_materia', 'Docente', 'Periodo', 'Parcial', 'Cuatrimestre', 'Grupo', 'Matricula', 'Nombre_Alumno'];
    const columnasActividades = columnas.filter(col => col.startsWith('Cal_'));
    const columnasComponentes = columnas.filter(col => col.startsWith('CalPond_'));
    const columnaCalificacionFinal = 'Calificacion Final';

    // Calcular estadísticas
    const estadisticas = calcularEstadisticasConcentrado(datos);

    console.log(`✅ Vista previa generada: ${datos.length} alumnos`);

    res.json({
      tipo: 'concentrado_final',
      datos: datos.slice(0, 10), // Solo primeros 10 para vista previa
      metadatos: {
        filtros,
        columnas: {
          basicas: columnasBasicas,
          actividades: columnasActividades,
          componentes: columnasComponentes,
          calificacion_final: columnaCalificacionFinal
        },
        estadisticas,
        total_registros: datos.length,
        fecha_generacion: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error al generar vista previa del concentrado:', error);
    res.status(500).json({ 
      error: 'Error al generar vista previa',
      detalle: error.message 
    });
  }
};

// Vista previa del reporte detallado (solo datos JSON)
const previsualizarDetallado = async (req, res) => {
  try {
    const filtros = req.body;
    console.log(`👁️ Generando vista previa del reporte detallado:`, filtros);

    // Obtener datos del SP
    const datos = await obtenerDatosDetallado(filtros);
    
    // Extraer metadatos del resultado
    const primeraFila = datos[0];
    const columnas = Object.keys(primeraFila);
    
    // Separar columnas por tipo
    const columnasBasicas = ['Clave', 'Matricula', 'Nombre_Alumno', 'Grupo', 'Docente', 'Clave_Materia', 'Nombre_materia', 'Periodo', 'Parcial', 'Cuatrimestre'];
    const columnasActividades = columnas.filter(col => !columnasBasicas.includes(col));

    // Calcular estadísticas
    const estadisticas = calcularEstadisticasDetallado(datos);

    console.log(`✅ Vista previa generada: ${datos.length} alumnos, ${columnasActividades.length} actividades`);

    res.json({
      tipo: 'reporte_detallado',
      datos: datos.slice(0, 10), // Solo primeros 10 para vista previa
      metadatos: {
        filtros,
        columnas: {
          basicas: columnasBasicas,
          actividades: columnasActividades
        },
        estadisticas: {
          ...estadisticas,
          total_registros: datos.length
        },
        fecha_generacion: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error al generar vista previa del reporte detallado:', error);
    res.status(500).json({ 
      error: 'Error al generar vista previa',
      detalle: error.message 
    });
  }
};

// ===============================================
// 📤 EXPORTS
// ===============================================
module.exports = {
  // Funciones para obtener filtros dinámicos
  obtenerParcialesDisponibles,
  obtenerGruposDisponibles,
  obtenerPeriodosDisponibles,
  obtenerMateriasConDatos,

  // Funciones de vista previa (solo datos JSON)
  previsualizarConcentrado,
  previsualizarDetallado,

  // Funciones de exportación Excel (Stream directo)
  generarConcentradoExcel,
  generarDetalladoExcel,

  // Funciones de exportación PDF (Stream directo)
  generarConcentradoPDF,
  generarDetalladoPDF
};