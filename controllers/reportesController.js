const { sql, config } = require('../db/sqlConfig');
const ExcelJS = require('exceljs');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// ✅ CACHE EN MEMORIA PARA EVITAR MÚLTIPLES EJECUCIONES DEL SP
const cache = new Map();

// ===============================================
// 🔍 FUNCIONES PARA OBTENER FILTROS DINÁMICOS (Sin cambios)
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
// 📊 FUNCIÓN PARA OBTENER DATOS CON CACHE
// ===============================================

// ✅ FUNCIÓN PARA sp_ConcentradoCompleto CON CACHE
const obtenerDatosConcentradoCompleto = async (filtros) => {
  const { parcial, grupo, periodo, cuatrimestre, materia } = filtros;
  
  // ✅ CREAR CLAVE ÚNICA PARA EL CACHE
  const cacheKey = `${parcial}-${grupo}-${periodo}-${cuatrimestre}-${materia}`;
  
  // ✅ VERIFICAR SI YA TENEMOS LOS DATOS EN CACHE
  if (cache.has(cacheKey)) {
    console.log(`🔄 Usando datos del cache para: ${cacheKey}`);
    return cache.get(cacheKey);
  }
  
  try {
    const pool = await sql.connect(config);
    
    console.log(`📊 Ejecutando sp_ConcentradoCompleto:`);
    console.log(`   - Parcial: ${parcial}, Grupo: ${grupo}`);
    console.log(`   - Periodo: ${periodo}, Cuatrimestre: ${cuatrimestre}`);
    console.log(`   - Materia: ${materia}`);

    const request = pool.request();
    
    // ✅ AUMENTAR TIMEOUT ESPECÍFICO PARA ESTA CONSULTA
    request.timeout = 180000; // 3 minutos
    
    const result = await request
      .input('Parcial', sql.Int, parseInt(parcial))
      .input('Grupo', sql.VarChar, grupo)
      .input('Periodo', sql.VarChar, periodo)
      .input('Cuatrimestre', sql.VarChar, cuatrimestre)
      .input('Materia', sql.VarChar, materia)
      .execute('sp_ConcentradoCompleto');

    if (result.recordset.length === 0) {
      throw new Error('No se encontraron datos para los filtros seleccionados');
    }

    console.log(`✅ Datos obtenidos: ${result.recordset.length} registros`);
    
    // ✅ GUARDAR EN CACHE POR 5 MINUTOS
    cache.set(cacheKey, result.recordset);
    setTimeout(() => {
      cache.delete(cacheKey);
      console.log(`🗑️ Cache eliminado para: ${cacheKey}`);
    }, 5 * 60 * 1000); // 5 minutos

    return result.recordset;

  } catch (error) {
    console.error('❌ Error al obtener datos del concentrado completo:', error);
    throw error;
  }
};

// ===============================================
// 📄 FUNCIÓN DE EXPORTACIÓN A EXCEL - LIMPIA Y ORGANIZADA
// ===============================================

// ✅ Generar reporte completo en Excel (Limpio y organizado)
const generarReporteExcel = async (req, res) => {
  try {
    const filtros = req.body;
    console.log(`📊 Generando reporte Excel con filtros:`, filtros);

    // ✅ Obtener datos del SP_ConcentradoCompleto
    const datos = await obtenerDatosConcentradoCompleto(filtros);
    
    if (!datos || datos.length === 0) {
      return res.status(404).json({ 
        error: 'No se encontraron datos para los filtros seleccionados' 
      });
    }
    
    // Crear workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Reporte Completo');

    // Configurar metadatos del archivo
    workbook.creator = 'Sistema UTHH';
    workbook.created = new Date();
    workbook.modified = new Date();

    // ✅ TÍTULO PRINCIPAL
    const titulo = `Reporte Completo de Calificaciones`;
    
    worksheet.mergeCells('A1:H1');
    worksheet.getCell('A1').value = titulo;
    worksheet.getCell('A1').font = { size: 18, bold: true, color: { argb: 'FF009944' } };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    // ✅ INFORMACIÓN DEL REPORTE (NUEVO APARTADO)
    let filaActual = 3;
    
    worksheet.getCell(`A${filaActual}`).value = 'Información del Reporte:';
    worksheet.getCell(`A${filaActual}`).font = { size: 14, bold: true, color: { argb: 'FF2E8B57' } };
    filaActual++;

    // Información en dos columnas
    const infoReporte = [
      ['Materia:', filtros.materia, 'Docente:', datos[0]?.Docente || 'N/A'],
      ['Parcial:', `Parcial ${filtros.parcial}`, 'Grupo:', `Grupo ${filtros.grupo}`],
      ['Periodo:', filtros.periodo, 'Cuatrimestre:', filtros.cuatrimestre],
      ['Fecha de generación:', new Date().toLocaleDateString('es-MX', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }), '', '']
    ];

    infoReporte.forEach((fila, index) => {
      // Columna A y B
      if (fila[0]) {
        worksheet.getCell(`A${filaActual + index}`).value = fila[0];
        worksheet.getCell(`A${filaActual + index}`).font = { bold: true };
      }
      if (fila[1]) {
        worksheet.getCell(`B${filaActual + index}`).value = fila[1];
      }
      
      // Columna D y E (dejamos C vacía para separación)
      if (fila[2]) {
        worksheet.getCell(`D${filaActual + index}`).value = fila[2];
        worksheet.getCell(`D${filaActual + index}`).font = { bold: true };
      }
      if (fila[3]) {
        worksheet.getCell(`E${filaActual + index}`).value = fila[3];
      }
    });

    filaActual += infoReporte.length + 1;

    // ✅ ESTADÍSTICAS GENERALES (SIN PROMEDIO, CRITERIO 7+)
    const stats = calcularEstadisticasLimpias(datos);
    
    worksheet.getCell(`A${filaActual}`).value = 'Estadísticas Generales:';
    worksheet.getCell(`A${filaActual}`).font = { size: 14, bold: true, color: { argb: 'FF2E8B57' } };
    filaActual++;

    const estadisticas = [
      ['Total de alumnos:', stats.totalAlumnos, 'Total actividades:', stats.totalActividades],
      ['Aprobados (7+):', `${stats.aprobados} (${stats.porcentajeAprobados}%)`, 'Total componentes:', stats.totalComponentes],
      ['Reprobados (<7):', `${stats.reprobados} (${stats.porcentajeReprobados}%)`, 'Rango calificaciones:', `${stats.calificacionMinima} - ${stats.calificacionMaxima}`]
    ];

    estadisticas.forEach((fila, index) => {
      // Columna A y B
      worksheet.getCell(`A${filaActual + index}`).value = fila[0];
      worksheet.getCell(`A${filaActual + index}`).font = { bold: true };
      worksheet.getCell(`B${filaActual + index}`).value = fila[1];
      
      // Columna D y E
      if (fila[2]) {
        worksheet.getCell(`D${filaActual + index}`).value = fila[2];
        worksheet.getCell(`D${filaActual + index}`).font = { bold: true };
      }
      if (fila[3]) {
        worksheet.getCell(`E${filaActual + index}`).value = fila[3];
      }
    });

    filaActual += estadisticas.length + 2;

    // ✅ TABLA PRINCIPAL (LIMPIA - SIN COLUMNAS REPETITIVAS)
    if (datos.length > 0) {
      const todasLasColumnas = Object.keys(datos[0]);
      
      // ✅ FILTRAR COLUMNAS - Quitar las repetitivas
      const columnasAExcluir = ['Grupo', 'Docente', 'Nombre_materia', 'Periodo', 'Parcial', 'Cuatrimestre'];
      const columnasLimpias = todasLasColumnas.filter(col => !columnasAExcluir.includes(col));
      
      // ✅ CREAR MAPEO DE ACTIVIDADES A NÚMEROS
      const actividades = columnasLimpias.filter(col => 
        col.includes(' - ') || col.startsWith('Prom_') || col.startsWith('CalPond_')
      );
      
      const mapeoActividades = {};
      const referenciasActividades = [];
      let numeroActividad = 1;
      
      // ✅ COLORES POR COMPONENTE
      const coloresComponentes = [
        'FFE3F2FD', // Azul claro
        'FFF3E5F5', // Morado claro  
        'FFE8F5E8', // Verde claro
        'FFFFF3E0', // Naranja claro
        'FFF1F8E9', // Lima claro
        'FFEDE7F6', // Violeta claro
        'FFE0F2F1', // Teal claro
      ];
      
      let componenteActual = '';
      let indiceColor = 0;
      
      actividades.forEach(actividad => {
        // Detectar cambio de componente
        let componente = '';
        if (actividad.startsWith('Prom_')) {
          componente = actividad.replace('Prom_', '').split('_')[0];
        } else if (actividad.startsWith('CalPond_')) {
          componente = actividad.replace('CalPond_', '').split('_')[0];
        } else if (actividad.includes(' - ')) {
          componente = actividad.split(' - ')[0];
        }
        
        if (componente !== componenteActual) {
          componenteActual = componente;
          indiceColor = (indiceColor + 1) % coloresComponentes.length;
        }
        
        mapeoActividades[actividad] = {
          numero: numeroActividad,
          nombre: actividad,
          color: coloresComponentes[indiceColor]
        };
        
        referenciasActividades.push({
          numero: numeroActividad,
          nombre: actividad,
          color: coloresComponentes[indiceColor]
        });
        
        numeroActividad++;
      });
      
      console.log(`📋 Columnas en la tabla: ${columnasLimpias.length} (eliminadas ${columnasAExcluir.length} repetitivas)`);
      console.log(`🔢 Actividades mapeadas: ${actividades.length}`);

      // ✅ ENCABEZADOS DE LA TABLA (CON NÚMEROS Y NOMBRES SIMPLIFICADOS)
      columnasLimpias.forEach((header, index) => {
        const cell = worksheet.getCell(filaActual, index + 1);
        
        // ✅ CAMBIAR NOMBRES DE HEADERS
        let headerMostrar = header;
        if (header === 'Nombre_Alumno') {
          headerMostrar = 'Nombre';
        } else if (mapeoActividades[header]) {
          headerMostrar = mapeoActividades[header].numero.toString();
        }
        
        cell.value = headerMostrar;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        
        // ✅ COLOR DE FONDO SEGÚN COMPONENTE
        let colorFondo = 'FF009944'; // Verde por defecto
        if (mapeoActividades[header]) {
          colorFondo = mapeoActividades[header].color.replace('FF', 'FF');
          // Para headers, usar versión más oscura
          colorFondo = colorFondo.replace('FF', 'CC');
        }
        
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: colorFondo }
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        cell.alignment = { horizontal: 'center' };
      });

      filaActual++;

      // ✅ FILAS DE DATOS (SOLO COLUMNAS LIMPIAS)
      datos.forEach((fila, filaIndex) => {
        columnasLimpias.forEach((columna, colIndex) => {
          const valor = fila[columna];
          const cell = worksheet.getCell(filaActual + filaIndex, colIndex + 1);
          cell.value = valor;
          
          // Borderes para todas las celdas
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
          
          // ✅ COLOREAR SEGÚN TIPO DE COLUMNA
          // Calificación final (criterio 7+)
          if (columna === 'Calificacion_Final') {
            const calificacion = parseFloat(valor) || 0;
            if (calificacion >= 8) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4EDDA' } }; // Verde fuerte
            } else if (calificacion >= 7) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E8' } }; // Verde claro
            } else if (calificacion >= 5) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } }; // Amarillo
            } else {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } }; // Rojo
            }
            cell.font = { bold: true };
          }
          // ✅ ACTIVIDADES/COMPONENTES CON COLORES POR GRUPO
          else if (mapeoActividades[columna] && typeof valor === 'number') {
            // Color base del componente
            let colorBase = mapeoActividades[columna].color;
            
            // Intensidad según calificación
            if (valor >= 8) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorBase } };
            } else if (valor >= 7) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorBase.replace('FF', 'FF').replace(/(.{2})(.{6})/, '$1E8$2') } };
            } else if (valor >= 5) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorBase.replace('FF', 'FF').replace(/(.{2})(.{6})/, '$1D0$2') } };
            } else if (valor > 0) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorBase.replace('FF', 'FF').replace(/(.{2})(.{6})/, '$1C0$2') } };
            }
            
            // Negrita para promedios y ponderadas
            if (columna.startsWith('Prom_') || columna.startsWith('CalPond_')) {
              cell.font = { bold: true };
            }
          }
          // Información básica del alumno
          else if (['No.', 'Matricula', 'Nombre_Alumno'].includes(columna)) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } }; // Gris muy claro
            if (columna === 'No.') {
              cell.alignment = { horizontal: 'center' };
            }
            if (columna === 'Matricula') {
              cell.font = { bold: true };
            }
          }
        });
      });

      // ✅ AUTO-AJUSTAR ANCHOS DE COLUMNA
      worksheet.columns.forEach((column, index) => {
        const headerName = columnasLimpias[index];
        
        if (headerName === 'No.') {
          column.width = 6;
        } else if (headerName === 'Matricula') {
          column.width = 14;
        } else if (headerName === 'Nombre_Alumno') {
          column.width = 35; // ✅ MÁS ESPACIO PARA NOMBRES
        } else if (headerName === 'Calificacion_Final') {
          column.width = 14;
        } else if (mapeoActividades[headerName]) {
          column.width = 8; // ✅ COLUMNAS DE NÚMEROS MÁS COMPACTAS
        } else {
          column.width = 11;
        }
      });
      
      // ✅ TABLA DE REFERENCIA (NUEVA)
      const filaReferencia = filaActual + datos.length + 3;
      
      // Título de la tabla de referencia
      worksheet.getCell(`A${filaReferencia}`).value = 'Referencias de Actividades:';
      worksheet.getCell(`A${filaReferencia}`).font = { size: 14, bold: true, color: { argb: 'FF2E8B57' } };
      
      // Headers de la tabla de referencia
      const headersRef = ['No.', 'Descripción de la Actividad'];
      headersRef.forEach((header, index) => {
        const cell = worksheet.getCell(filaReferencia + 2, index + 1);
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
      
      // ✅ FILAS DE LA TABLA DE REFERENCIA
      referenciasActividades.forEach((ref, index) => {
        const fila = filaReferencia + 3 + index;
        
        // Número
        const cellNumero = worksheet.getCell(fila, 1);
        cellNumero.value = ref.numero;
        cellNumero.alignment = { horizontal: 'center' };
        cellNumero.font = { bold: true };
        cellNumero.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: ref.color }
        };
        cellNumero.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        
        // Descripción
        const cellDesc = worksheet.getCell(fila, 2);
        cellDesc.value = ref.nombre;
        cellDesc.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: ref.color.replace('FF', 'FF').replace(/(.{2})(.{6})/, '$1F8$2') } // Más claro
        };
        cellDesc.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
      
      // Ajustar anchos de la tabla de referencia
      worksheet.getColumn(1).width = Math.max(worksheet.getColumn(1).width || 0, 6);
      worksheet.getColumn(2).width = Math.max(worksheet.getColumn(2).width || 0, 50);
    }

    // ✅ CONFIGURAR HEADERS PARA DESCARGA
    const filename = `Reporte_Limpio_${filtros.materia.replace(/\s+/g, '_')}_P${filtros.parcial}_G${filtros.grupo}_${Date.now()}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    // ✅ STREAM DIRECTO
    console.log(`📁 Enviando archivo Excel limpio: ${filename}`);
    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('❌ Error al generar reporte Excel:', error);
    res.status(500).json({ 
      error: 'Error al generar reporte Excel',
      detalle: error.message 
    });
  }
};

// ===============================================
// 📊 FUNCIÓN DE EXPORTACIÓN A PDF - LIMPIA Y ORGANIZADA
// ===============================================

// ✅ Generar reporte completo en PDF (Limpio y organizado como Excel)
const generarReportePDF = async (req, res) => {
  let browser = null;
  
  try {
    const filtros = req.body;
    console.log(`📊 Generando reporte PDF:`, filtros);

    // ✅ Obtener datos del SP_ConcentradoCompleto
    const datos = await obtenerDatosConcentradoCompleto(filtros);
    
    if (!datos || datos.length === 0) {
      return res.status(404).json({ 
        error: 'No se encontraron datos para los filtros seleccionados' 
      });
    }
    
    // ✅ USAR ESTADÍSTICAS LIMPIAS (criterio 7+)
    const stats = calcularEstadisticasLimpias(datos);

    // ✅ Generar HTML con la misma lógica del Excel
    const htmlContent = generarHTMLLimpio(datos, filtros, stats);

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
      landscape: true, // Horizontal para ver mejor las columnas
      margin: {
        top: '15mm',
        right: '10mm',
        bottom: '15mm',
        left: '10mm'
      },
      printBackground: true
    });

    await browser.close();

    // ✅ CONFIGURAR HEADERS PARA DESCARGA
    const filename = `Reporte_Limpio_${filtros.materia.replace(/\s+/g, '_')}_P${filtros.parcial}_G${filtros.grupo}_${Date.now()}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    // ✅ STREAM DIRECTO
    console.log(`📁 Enviando archivo PDF limpio: ${filename}`);
    res.send(pdfBuffer);

  } catch (error) {
    if (browser) await browser.close();
    console.error('❌ Error al generar reporte PDF:', error);
    res.status(500).json({ 
      error: 'Error al generar reporte PDF',
      detalle: error.message 
    });
  }
};

// ===============================================
// 🎨 FUNCIÓN PARA GENERAR HTML LIMPIO (NUEVA - IGUAL QUE EXCEL)
// ===============================================

// ✅ Generar HTML para reporte limpio con números y tabla de referencias
const generarHTMLLimpio = (datos, filtros, stats) => {
  // ✅ CREAR MAPEO DE ACTIVIDADES A NÚMEROS (IGUAL QUE EXCEL)
  const todasLasColumnas = Object.keys(datos[0]);
  const columnasAExcluir = ['Grupo', 'Docente', 'Nombre_materia', 'Periodo', 'Parcial', 'Cuatrimestre'];
  const columnasLimpias = todasLasColumnas.filter(col => !columnasAExcluir.includes(col));
  
  const actividades = columnasLimpias.filter(col => 
    col.includes(' - ') || col.startsWith('Prom_') || col.startsWith('CalPond_')
  );
  
  const mapeoActividades = {};
  const referenciasActividades = [];
  let numeroActividad = 1;
  
  // ✅ COLORES POR COMPONENTE (IGUALES QUE EXCEL)
  const coloresComponentes = [
    '#E3F2FD', // Azul claro
    '#F3E5F5', // Morado claro  
    '#E8F5E8', // Verde claro
    '#FFF3E0', // Naranja claro
    '#F1F8E9', // Lima claro
    '#EDE7F6', // Violeta claro
    '#E0F2F1', // Teal claro
  ];
  
  let componenteActual = '';
  let indiceColor = 0;
  
  actividades.forEach(actividad => {
    // Detectar cambio de componente
    let componente = '';
    if (actividad.startsWith('Prom_')) {
      componente = actividad.replace('Prom_', '').split('_')[0];
    } else if (actividad.startsWith('CalPond_')) {
      componente = actividad.replace('CalPond_', '').split('_')[0];
    } else if (actividad.includes(' - ')) {
      componente = actividad.split(' - ')[0];
    }
    
    if (componente !== componenteActual) {
      componenteActual = componente;
      indiceColor = (indiceColor + 1) % coloresComponentes.length;
    }
    
    mapeoActividades[actividad] = {
      numero: numeroActividad,
      nombre: actividad,
      color: coloresComponentes[indiceColor]
    };
    
    referenciasActividades.push({
      numero: numeroActividad,
      nombre: actividad,
      color: coloresComponentes[indiceColor]
    });
    
    numeroActividad++;
  });

  // Preparar datos para gráfico de pastel (criterio 7+)
  const datosGrafico = {
    aprobados: parseInt(stats.aprobados),
    reprobados: parseInt(stats.reprobados)
  };

  // Preparar datos para histograma de calificaciones
  const calificaciones = datos.map(alumno => parseFloat(alumno['Calificacion_Final']) || 0);
  const rangos = ['0-3', '3-5', '5-7', '7-8', '8-10'];
  const conteoRangos = [0, 0, 0, 0, 0];
  
  calificaciones.forEach(cal => {
    if (cal >= 0 && cal < 3) conteoRangos[0]++;
    else if (cal >= 3 && cal < 5) conteoRangos[1]++;
    else if (cal >= 5 && cal < 7) conteoRangos[2]++;
    else if (cal >= 7 && cal < 8) conteoRangos[3]++;
    else if (cal >= 8 && cal <= 10) conteoRangos[4]++;
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Reporte Limpio</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>
            body { font-family: Arial, sans-serif; margin: 10px; font-size: 9px; }
            .header { text-align: center; margin-bottom: 15px; }
            .title { font-size: 18px; font-weight: bold; color: #009944; }
            .generated { font-size: 8px; color: #999; margin-top: 5px; }
            
            .info-section { 
                display: flex; 
                justify-content: space-between; 
                margin: 10px 0; 
                background: #f8f9fa; 
                padding: 10px; 
                border-radius: 6px; 
                border-left: 4px solid #2E8B57;
            }
            .info-column { flex: 1; margin: 0 10px; }
            .info-item { margin: 3px 0; }
            .info-label { font-weight: bold; color: #2E8B57; }
            
            .stats { display: flex; justify-content: space-around; margin: 15px 0; }
            .stat-card { 
                background: linear-gradient(135deg, #009944, #00b359); 
                color: white; 
                padding: 10px; 
                border-radius: 6px; 
                text-align: center; 
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                flex: 1;
                margin: 0 3px;
            }
            .stat-number { font-size: 16px; font-weight: bold; }
            .stat-label { font-size: 8px; opacity: 0.9; }
            
            .charts-section { margin: 15px 0; }
            .chart-container { 
                width: 48%; 
                height: 200px; 
                display: inline-block; 
                margin: 5px 1%; 
                background: white; 
                border-radius: 6px; 
                padding: 10px; 
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            
            .table-container { margin: 15px 0; }
            table { 
                width: 100%; 
                border-collapse: collapse; 
                font-size: 7px; 
                background: white;
                border-radius: 6px;
                overflow: hidden;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            th { 
                background: #009944; 
                color: white; 
                padding: 5px 2px; 
                text-align: center; 
                font-weight: bold;
                font-size: 7px;
            }
            td { 
                padding: 3px 2px; 
                text-align: center; 
                border-bottom: 1px solid #eee; 
                font-size: 7px;
            }
            
            .ref-section { margin: 20px 0; }
            .ref-title { font-size: 14px; font-weight: bold; color: #2E8B57; margin-bottom: 10px; }
            .ref-table { 
                width: 100%; 
                border-collapse: collapse; 
                font-size: 8px; 
                background: white;
                border-radius: 6px;
                overflow: hidden;
            }
            .ref-table th { 
                background: #2E8B57; 
                color: white; 
                padding: 8px; 
                text-align: center; 
            }
            .ref-table td { 
                padding: 6px 8px; 
                border-bottom: 1px solid #eee; 
            }
            .ref-numero { 
                text-align: center; 
                font-weight: bold; 
                width: 60px;
            }
            
            .info-basic { background-color: #f8f9fa; }
            .calificacion-final { background-color: #e8f5e8; font-weight: bold; }
            .aprobado { color: #27ae60; font-weight: bold; }
            .reprobado { color: #e74c3c; font-weight: bold; }
            .regular { color: #f39c12; font-weight: bold; }
            
            .footer { 
                text-align: center; 
                margin-top: 15px; 
                padding: 10px; 
                background: #f8f9fa; 
                border-radius: 6px;
                font-size: 8px;
            }
            .logo { color: #009944; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="header">
            <div class="title">📊 Reporte Completo de Calificaciones</div>
            <div class="generated">Generado: ${new Date().toLocaleString('es-MX')}</div>
        </div>

        <div class="info-section">
            <div class="info-column">
                <div class="info-item"><span class="info-label">Materia:</span> ${filtros.materia}</div>
                <div class="info-item"><span class="info-label">Parcial:</span> Parcial ${filtros.parcial}</div>
                <div class="info-item"><span class="info-label">Periodo:</span> ${filtros.periodo}</div>
            </div>
            <div class="info-column">
                <div class="info-item"><span class="info-label">Docente:</span> ${datos[0]?.Docente || 'N/A'}</div>
                <div class="info-item"><span class="info-label">Grupo:</span> Grupo ${filtros.grupo}</div>
                <div class="info-item"><span class="info-label">Cuatrimestre:</span> ${filtros.cuatrimestre}</div>
            </div>
        </div>

        <div class="stats">
            <div class="stat-card">
                <div class="stat-number">${stats.totalAlumnos}</div>
                <div class="stat-label">Total Alumnos</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.aprobados}</div>
                <div class="stat-label">Aprobados (7+)<br>${stats.porcentajeAprobados}%</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.reprobados}</div>
                <div class="stat-label">Reprobados (&lt;7)<br>${stats.porcentajeReprobados}%</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.totalActividades}</div>
                <div class="stat-label">Actividades</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.totalComponentes}</div>
                <div class="stat-label">Componentes</div>
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
                        ${columnasLimpias.map(col => {
                          let headerMostrar = col;
                          if (col === 'Nombre_Alumno') {
                            headerMostrar = 'Nombre';
                          } else if (mapeoActividades[col]) {
                            headerMostrar = mapeoActividades[col].numero.toString();
                          }
                          
                          let colorFondo = '#009944';
                          if (mapeoActividades[col]) {
                            colorFondo = mapeoActividades[col].color.replace('#', '').slice(0, 6);
                            colorFondo = '#' + colorFondo.replace(/(.{2})(.{4})/, '99$2'); // Más oscuro para header
                          }
                          
                          return `<th style="background-color: ${colorFondo};">${headerMostrar}</th>`;
                        }).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${datos.map(fila => `
                        <tr>
                            ${columnasLimpias.map(columna => {
                                const valor = fila[columna];
                                let className = '';
                                let estilo = '';
                                
                                // Clasificar columnas
                                if (columna === 'Calificacion_Final') {
                                    className = 'calificacion-final';
                                    const cal = parseFloat(valor) || 0;
                                    if (cal >= 8) className += ' aprobado';
                                    else if (cal >= 7) className += ' regular';
                                    else className += ' reprobado';
                                } else if (mapeoActividades[columna] && typeof valor === 'number') {
                                    let colorBase = mapeoActividades[columna].color;
                                    
                                    // Intensidad según calificación
                                    if (valor >= 8) {
                                        estilo = `background-color: ${colorBase};`;
                                    } else if (valor >= 7) {
                                        estilo = `background-color: ${colorBase}E8;`;
                                    } else if (valor >= 5) {
                                        estilo = `background-color: ${colorBase}D0;`;
                                    } else if (valor > 0) {
                                        estilo = `background-color: ${colorBase}C0;`;
                                    }
                                } else if (['No.', 'Matricula', 'Nombre_Alumno'].includes(columna)) {
                                    className = 'info-basic';
                                }
                                
                                return `<td class="${className}" style="${estilo}">${valor || ''}</td>`;
                            }).join('')}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div class="ref-section">
            <div class="ref-title">Referencias de Actividades:</div>
            <table class="ref-table">
                <thead>
                    <tr>
                        <th>No.</th>
                        <th>Descripción de la Actividad</th>
                    </tr>
                </thead>
                <tbody>
                    ${referenciasActividades.map(ref => `
                        <tr>
                            <td class="ref-numero" style="background-color: ${ref.color}; font-weight: bold;">${ref.numero}</td>
                            <td style="background-color: ${ref.color}F8;">${ref.nombre}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div class="footer">
            <div class="logo">🎓 Universidad Tecnológica de la Huasteca Hidalguense (UTHH)</div>
            <div>Sistema de Gestión Académica - Reporte Completo de Calificaciones</div>
            <div style="color: #666; margin-top: 3px;">© 2025 - Plataforma Docente UTHH</div>
        </div>

        <script>
            // Gráfico de Pastel - Aprobados vs Reprobados (criterio 7+)
            const ctxPie = document.getElementById('pieChart').getContext('2d');
            new Chart(ctxPie, {
                type: 'pie',
                data: {
                    labels: ['Aprobados (7+)', 'Reprobados (<7)'],
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
                            font: { size: 12, weight: 'bold' }
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
                            text: 'Distribución por Rangos',
                            font: { size: 12, weight: 'bold' }
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

// ===============================================
// 🧮 FUNCIÓN PARA ESTADÍSTICAS LIMPIAS (CRITERIO 7+)
// ===============================================

// ✅ Calcular estadísticas con criterio de aprobación 7+ (sin promedio general)
const calcularEstadisticasLimpias = (datos) => {
  const totalAlumnos = datos.length;
  const calificacionesFinales = datos
    .map(alumno => parseFloat(alumno['Calificacion_Final']) || 0)
    .filter(cal => cal > 0);

  // ✅ CRITERIO NUEVO: Aprobado con 7+
  const aprobados = calificacionesFinales.filter(cal => cal >= 7).length;
  const reprobados = calificacionesFinales.filter(cal => cal < 7).length;

  // Contar actividades y componentes
  const primeraFila = datos[0] || {};
  const columnasActividades = Object.keys(primeraFila).filter(col => col.includes(' - ')).length;
  const columnasComponentes = Object.keys(primeraFila).filter(col => col.startsWith('Prom_')).length;

  return {
    totalAlumnos,
    aprobados,
    reprobados,
    porcentajeAprobados: totalAlumnos > 0 ? ((aprobados / totalAlumnos) * 100).toFixed(1) : '0.0',
    porcentajeReprobados: totalAlumnos > 0 ? ((reprobados / totalAlumnos) * 100).toFixed(1) : '0.0',
    calificacionMaxima: calificacionesFinales.length > 0 ? Math.max(...calificacionesFinales).toFixed(2) : '0.00',
    calificacionMinima: calificacionesFinales.length > 0 ? Math.min(...calificacionesFinales).toFixed(2) : '0.00',
    totalActividades: columnasActividades,
    totalComponentes: columnasComponentes
  };
};

// ===============================================
// 📋 FUNCIÓN PARA VISTA PREVIA (TAMBIÉN CON CRITERIO 7+)
// ===============================================

// ✅ Vista previa del reporte completo (actualizada para criterio 7+)
const previsualizarReporte = async (req, res) => {
  try {
    const filtros = req.body;
    console.log(`👁️ Generando vista previa del reporte:`, filtros);

    const datos = await obtenerDatosConcentradoCompleto(filtros);
    
    const primeraFila = datos[0];
    const columnas = Object.keys(primeraFila);
    
    // Separar columnas por tipo
    const columnasBasicas = ['No.', 'Matricula', 'Nombre_Alumno', 'Grupo', 'Docente', 'Nombre_materia', 'Periodo', 'Parcial', 'Cuatrimestre'];
    const columnasActividades = columnas.filter(col => col.includes(' - '));
    const columnasPromedios = columnas.filter(col => col.startsWith('Prom_'));
    const columnasPonderadas = columnas.filter(col => col.startsWith('CalPond_'));
    const columnaCalificacionFinal = 'Calificacion_Final';

    // ✅ USAR ESTADÍSTICAS LIMPIAS (criterio 7+)
    const estadisticas = calcularEstadisticasLimpias(datos);

    console.log(`✅ Vista previa generada: ${datos.length} alumnos (criterio aprobación: 7+)`);

    res.json({
      tipo: 'reporte_completo',
      datos: datos.slice(0, 10), // Solo primeros 10 para vista previa
      metadatos: {
        filtros,
        columnas: {
          basicas: columnasBasicas,
          actividades: columnasActividades,
          promedios: columnasPromedios,
          ponderadas: columnasPonderadas,
          calificacion_final: columnaCalificacionFinal
        },
        estadisticas,
        total_registros: datos.length,
        fecha_generacion: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error al generar vista previa:', error);
    res.status(500).json({ 
      error: 'Error al generar vista previa',
      detalle: error.message 
    });
  }
};

// ===============================================
// 📤 EXPORTS SIMPLIFICADOS
// ===============================================
module.exports = {
  // Funciones para obtener filtros dinámicos (sin cambios)
  obtenerParcialesDisponibles,
  obtenerGruposDisponibles,
  obtenerPeriodosDisponibles,
  obtenerMateriasConDatos,

  // ✅ FUNCIONES ÚNICAS CON STREAM DIRECTO + CACHE (MÉTODO QUE FUNCIONABA)
  previsualizarReporte,
  generarReporteExcel,
  generarReportePDF
};