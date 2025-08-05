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

// ✅ Generar reporte Excel CON COLORES CORREGIDOS (sin negro)
const generarReporteExcel = async (req, res) => {
  try {
    const filtros = req.body;
    console.log(`📊 Generando reporte Excel con filtros:`, filtros);

    const datos = await obtenerDatosConcentradoCompleto(filtros);
    
    if (!datos || datos.length === 0) {
      return res.status(404).json({ 
        error: 'No se encontraron datos para los filtros seleccionados' 
      });
    }
    
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Reporte Completo');

    workbook.creator = 'Sistema UTHH';
    workbook.created = new Date();
    workbook.modified = new Date();

    // ✅ TÍTULO PRINCIPAL
    const titulo = `Reporte Completo de Calificaciones`;
    
    worksheet.mergeCells('A1:H1');
    worksheet.getCell('A1').value = titulo;
    worksheet.getCell('A1').font = { size: 18, bold: true, color: { argb: 'FF1B4F72' } };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    let filaActual = 3;
    
    worksheet.getCell(`A${filaActual}`).value = 'Información del Reporte:';
    worksheet.getCell(`A${filaActual}`).font = { size: 14, bold: true, color: { argb: 'FF1B4F72' } };
    filaActual++;

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
      if (fila[0]) {
        worksheet.getCell(`A${filaActual + index}`).value = fila[0];
        worksheet.getCell(`A${filaActual + index}`).font = { bold: true };
      }
      if (fila[1]) {
        worksheet.getCell(`B${filaActual + index}`).value = fila[1];
      }
      
      if (fila[2]) {
        worksheet.getCell(`D${filaActual + index}`).value = fila[2];
        worksheet.getCell(`D${filaActual + index}`).font = { bold: true };
      }
      if (fila[3]) {
        worksheet.getCell(`E${filaActual + index}`).value = fila[3];
      }
    });

    filaActual += infoReporte.length + 1;

    const stats = calcularEstadisticasLimpias(datos);
    
    worksheet.getCell(`A${filaActual}`).value = 'Estadísticas Generales:';
    worksheet.getCell(`A${filaActual}`).font = { size: 14, bold: true, color: { argb: 'FF1B4F72' } };
    filaActual++;

    const estadisticas = [
      ['Total de alumnos:', stats.totalAlumnos, 'Total actividades:', stats.totalActividades],
      ['Aprobados (7+):', `${stats.aprobados} (${stats.porcentajeAprobados}%)`, 'Total componentes:', stats.totalComponentes],
      ['Reprobados (<7):', `${stats.reprobados} (${stats.porcentajeReprobados}%)`, 'Rango calificaciones:', `${stats.calificacionMinima} - ${stats.calificacionMaxima}`]
    ];

    estadisticas.forEach((fila, index) => {
      worksheet.getCell(`A${filaActual + index}`).value = fila[0];
      worksheet.getCell(`A${filaActual + index}`).font = { bold: true };
      worksheet.getCell(`B${filaActual + index}`).value = fila[1];
      
      if (fila[2]) {
        worksheet.getCell(`D${filaActual + index}`).value = fila[2];
        worksheet.getCell(`D${filaActual + index}`).font = { bold: true };
      }
      if (fila[3]) {
        worksheet.getCell(`E${filaActual + index}`).value = fila[3];
      }
    });

    filaActual += estadisticas.length + 2;

    // ✅ FUNCIÓN PARA OBTENER VALOR CORRECTO (INCLUYE 0s)
    function obtenerValorParaExcel(valor, columna) {
      if (valor === null || 
          valor === undefined || 
          valor === '' || 
          valor === 'NULL' ||
          valor === 'null' ||
          (typeof valor === 'string' && valor.trim() === '') ||
          (typeof valor === 'number' && isNaN(valor))) {
        
        if (!['No.', 'Matricula', 'Nombre_Alumno'].includes(columna)) {
          return 0;
        } else {
          return valor;
        }
      }
      
      if (typeof valor === 'number') {
        return valor;
      }
      
      if (!['No.', 'Matricula', 'Nombre_Alumno'].includes(columna)) {
        const numeroVal = parseFloat(valor);
        if (!isNaN(numeroVal)) {
          return numeroVal;
        } else if (typeof valor === 'string' && valor.toLowerCase() === 'null') {
          return 0;
        }
      }
      
      return valor;
    }

    if (datos.length > 0) {
      const todasLasColumnas = Object.keys(datos[0]);
      const columnasAExcluir = ['Grupo', 'Docente', 'Nombre_materia', 'Periodo', 'Parcial', 'Cuatrimestre'];
      const columnasLimpias = todasLasColumnas.filter(col => !columnasAExcluir.includes(col));
      
      const actividades = columnasLimpias.filter(col => 
        col.includes(' - ') || col.startsWith('Prom_') || col.startsWith('CalPond_')
      );
      
      const mapeoActividades = {};
      const referenciasActividades = [];
      let numeroActividad = 1;
      
      // ✅ PALETA DE COLORES PROFESIONAL Y BONITA
      const coloresComponentes = [
        'FFE3F2FD', // Azul cielo claro - profesional
        'FFE8F5E8', // Verde menta claro - fresco
        'FFFFF3E0', // Naranja melocotón - cálido
        'FFE0F7FA', // Turquesa claro - moderno
        'FFF9FFF9', // Verde muy claro - suave
        'FFF0F8FF', // Azul Alice - elegante
        'FFFAF0E6', // Lino - neutro cálido
        'FFE6F3FF', // Azul powder - suave
      ];
      
      let componenteActual = '';
      let indiceColor = 0;
      
      actividades.forEach(actividad => {
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
      
      console.log(`📋 Columnas en la tabla: ${columnasLimpias.length}`);
      console.log(`🔢 Actividades mapeadas: ${actividades.length}`);

      // ✅ ENCABEZADOS DE LA TABLA
      columnasLimpias.forEach((header, index) => {
        const cell = worksheet.getCell(filaActual, index + 1);
        
        let headerMostrar = header;
        if (header === 'Nombre_Alumno') {
          headerMostrar = 'Nombre';
        } else if (mapeoActividades[header]) {
          headerMostrar = mapeoActividades[header].numero.toString();
        }
        
        cell.value = headerMostrar;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        
        // ✅ COLOR DE FONDO MODERNO PARA HEADERS
        let colorFondo = 'FF1B4F72'; // Azul profesional oscuro
        if (mapeoActividades[header]) {
          // ✅ USAR VERSIÓN MÁS OSCURA DEL COLOR BASE
          const colorBase = mapeoActividades[header].color;
          // Convertir a versión más oscura para mejor contraste
          if (colorBase.includes('E3F2FD')) colorFondo = 'FF1976D2'; // Azul
          else if (colorBase.includes('E8F5E8')) colorFondo = 'FF388E3C'; // Verde
          else if (colorBase.includes('FFF3E0')) colorFondo = 'FFF57C00'; // Naranja
          else if (colorBase.includes('E0F7FA')) colorFondo = 'FF00838F'; // Turquesa
          else if (colorBase.includes('F9FFF9')) colorFondo = 'FF43A047'; // Verde claro
          else if (colorBase.includes('F0F8FF')) colorFondo = 'FF1565C0'; // Azul Alice
          else if (colorBase.includes('FAF0E6')) colorFondo = 'FF8D6E63'; // Lino
          else colorFondo = 'FF3949AB'; // Azul powder
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

      // ✅ FILAS DE DATOS
      datos.forEach((fila, filaIndex) => {
        columnasLimpias.forEach((columna, colIndex) => {
          const valorOriginal = fila[columna];
          const cell = worksheet.getCell(filaActual + filaIndex, colIndex + 1);
          
          const valorMostrar = obtenerValorParaExcel(valorOriginal, columna);
          cell.value = valorMostrar;
          
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
          
          // ✅ COLOREAR SEGÚN TIPO DE COLUMNA
          if (columna === 'Calificacion_Final') {
            const calificacion = parseFloat(valorMostrar) || 0;
            if (calificacion >= 8) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1F2EB' } }; // Verde éxito suave
            } else if (calificacion >= 7) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF4F4' } }; // Verde muy claro
            } else if (calificacion >= 5) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCF3CF' } }; // Amarillo suave
            } else {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDEDEC' } }; // Rosa suave (muy claro)
            }
            cell.font = { bold: true };
            
            if (valorMostrar === 0) {
              cell.font = { bold: true, italic: true, color: { argb: 'FF5A6C7D' } };
            }
          }
          else if (mapeoActividades[columna] && typeof valorMostrar === 'number') {
            let colorBase = mapeoActividades[columna].color;
            
            if (valorMostrar === 0) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2F7' } }; // Gris azulado muy claro
              cell.font = { italic: true, color: { argb: 'FF5A6C7D' } }; // Gris azulado más suave
            }
            else if (valorMostrar >= 8) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorBase } };
            } else if (valorMostrar >= 7) {
              // ✅ GRADIENTES MÁS SUAVES
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorBase.replace('CC', 'E6') } };
            } else if (valorMostrar >= 5) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorBase.replace('CC', 'F0') } };
            } else if (valorMostrar > 0) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorBase.replace('CC', 'F5') } };
            }
            
            if (columna.startsWith('Prom_') || columna.startsWith('CalPond_')) {
              if (valorMostrar === 0) {
                cell.font = { bold: true, italic: true, color: { argb: 'FF5A6C7D' } };
              } else {
                cell.font = { bold: true };
              }
            }
          }
          else if (['No.', 'Matricula', 'Nombre_Alumno'].includes(columna)) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFB' } }; // Gris muy claro moderno
            if (columna === 'No.') {
              cell.alignment = { horizontal: 'center' };
            }
            if (columna === 'Matricula') {
              cell.font = { bold: true };
            }
          }
        });
      });

      // ✅ AUTO-AJUSTAR ANCHOS
      worksheet.columns.forEach((column, index) => {
        const headerName = columnasLimpias[index];
        
        if (headerName === 'No.') {
          column.width = 6;
        } else if (headerName === 'Matricula') {
          column.width = 14;
        } else if (headerName === 'Nombre_Alumno') {
          column.width = 35;
        } else if (headerName === 'Calificacion_Final') {
          column.width = 14;
        } else if (mapeoActividades[headerName]) {
          column.width = 8;
        } else {
          column.width = 11;
        }
      });
      
      // ✅ TABLA DE REFERENCIA CORREGIDA (SIN NEGRO)
      const filaReferencia = filaActual + datos.length + 3;
      
      worksheet.getCell(`A${filaReferencia}`).value = 'Referencias de Actividades:';
      worksheet.getCell(`A${filaReferencia}`).font = { size: 14, bold: true, color: { argb: 'FF1B4F72' } };
      
      const headersRef = ['No.', 'Descripción de la Actividad'];
      headersRef.forEach((header, index) => {
        const cell = worksheet.getCell(filaReferencia + 2, index + 1);
        cell.value = header;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF1B4F72' } // Azul profesional para combinar
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        cell.alignment = { horizontal: 'center' };
      });
      
      // ✅ FILAS DE REFERENCIA CON COLORES CORREGIDOS
      referenciasActividades.forEach((ref, index) => {
        const fila = filaReferencia + 3 + index;
        
        // ✅ NÚMERO CON COLOR PROFESIONAL
        const cellNumero = worksheet.getCell(fila, 1);
        cellNumero.value = ref.numero;
        cellNumero.alignment = { horizontal: 'center' };
        cellNumero.font = { bold: true, color: { argb: 'FF2C3E50' } }; // ✅ TEXTO GRIS OSCURO PROFESIONAL
        cellNumero.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: ref.color } // ✅ FONDO CON COLOR SUAVE
        };
        cellNumero.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        
        // ✅ DESCRIPCIÓN CON COLOR SUAVE Y BONITO
        const cellDesc = worksheet.getCell(fila, 2);
        cellDesc.value = ref.nombre;
        cellDesc.font = { color: { argb: 'FF2C3E50' } }; // ✅ TEXTO GRIS OSCURO PROFESIONAL
        cellDesc.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: ref.color.replace('E3', 'F7').replace('E8', 'F9').replace('FF', 'F5') } // ✅ AÚN MÁS SUAVE
        };
        cellDesc.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
      
      worksheet.getColumn(1).width = Math.max(worksheet.getColumn(1).width || 0, 6);
      worksheet.getColumn(2).width = Math.max(worksheet.getColumn(2).width || 0, 50);
    }

    const filename = `Reporte_Limpio_${filtros.materia.replace(/\s+/g, '_')}_P${filtros.parcial}_G${filtros.grupo}_${Date.now()}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    console.log(`📁 Enviando archivo Excel con colores corregidos: ${filename}`);
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
// 📊 FUNCIÓN DE EXPORTACIÓN A PDF - SIMPLE SIN GRÁFICOS
// ===============================================

// ✅ Generar reporte PDF SIMPLE (sin gráficos, con valores 0)
const generarReportePDF = async (req, res) => {
  let browser = null;
  
  try {
    const filtros = req.body;
    console.log(`📊 Generando reporte PDF simple:`, filtros);

    // ✅ Obtener datos del SP_ConcentradoCompleto
    const datos = await obtenerDatosConcentradoCompleto(filtros);
    
    if (!datos || datos.length === 0) {
      return res.status(404).json({ 
        error: 'No se encontraron datos para los filtros seleccionados' 
      });
    }
    
    // ✅ USAR ESTADÍSTICAS LIMPIAS (criterio 7+)
    const stats = calcularEstadisticasLimpias(datos);

    // ✅ Generar HTML SIMPLE (sin gráficos)
    const htmlContent = generarHTMLLimpio(datos, filtros, stats);

    // ✅ CONFIGURAR PUPPETEER SIMPLE
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // ✅ CARGAR CONTENIDO HTML SIN ESPERAR GRÁFICOS
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    // ✅ GENERAR PDF INMEDIATAMENTE
    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: true,
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
    const filename = `Reporte_${filtros.materia.replace(/\s+/g, '_')}_P${filtros.parcial}_G${filtros.grupo}_${Date.now()}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    // ✅ STREAM DIRECTO
    console.log(`📁 Enviando archivo PDF simple: ${filename}`);
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
// 🎨 FUNCIÓN PARA GENERAR HTML SIMPLE - SIN GRÁFICOS, CON VALORES 0
// ===============================================

// ✅ Generar HTML simple para PDF (sin gráficos, con valores 0)
// ✅ FUNCIÓN HTML MEJORADA - GARANTIZA QUE APAREZCAN LOS 0s
const generarHTMLLimpio = (datos, filtros, stats) => {
  // ✅ CREAR MAPEO DE ACTIVIDADES A NÚMEROS
  const todasLasColumnas = Object.keys(datos[0]);
  const columnasAExcluir = ['Grupo', 'Docente', 'Nombre_materia', 'Periodo', 'Parcial', 'Cuatrimestre'];
  const columnasLimpias = todasLasColumnas.filter(col => !columnasAExcluir.includes(col));
  
  const actividades = columnasLimpias.filter(col => 
    col.includes(' - ') || col.startsWith('Prom_') || col.startsWith('CalPond_')
  );
  
  const mapeoActividades = {};
  const referenciasActividades = [];
  let numeroActividad = 1;
  
  // ✅ COLORES POR COMPONENTE
  const coloresComponentes = [
    '#E3F2FD', '#F3E5F5', '#E8F5E8', '#FFF3E0', '#F1F8E9', '#EDE7F6', '#E0F2F1'
  ];
  
  let componenteActual = '';
  let indiceColor = 0;
  
  actividades.forEach(actividad => {
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

  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Reporte Simple</title>
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
            .valor-cero { color: #6c757d; font-style: italic; }
            
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
            <div class="title">📊 Reporte de Calificaciones</div>
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
                            colorFondo = '#' + colorFondo.replace(/(.{2})(.{4})/, '99$2');
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
                                
                                // ✅ FUNCIÓN MEJORADA PARA DETECTAR VALORES VACÍOS Y MOSTRAR 0
                                function obtenerValorMostrar(val) {
                                    // Verificar si es null, undefined, string vacía, o NaN
                                    if (val === null || 
                                        val === undefined || 
                                        val === '' || 
                                        val === 'NULL' ||
                                        val === 'null' ||
                                        (typeof val === 'string' && val.trim() === '') ||
                                        (typeof val === 'number' && isNaN(val))) {
                                        return '0';
                                    }
                                    
                                    // Si es un número válido pero es 0, mantenerlo como 0
                                    if (typeof val === 'number' && val === 0) {
                                        return '0';
                                    }
                                    
                                    // Para columnas que no son de información básica, convertir a número si es posible
                                    if (!['No.', 'Matricula', 'Nombre_Alumno'].includes(columna)) {
                                        const numeroVal = parseFloat(val);
                                        if (!isNaN(numeroVal)) {
                                            return numeroVal.toString();
                                        } else if (typeof val === 'string' && val.toLowerCase() === 'null') {
                                            return '0';
                                        }
                                    }
                                    
                                    return val;
                                }
                                
                                const valorMostrar = obtenerValorMostrar(valor);
                                const esValorCero = valorMostrar === '0';
                                
                                // ✅ APLICAR ESTILOS SEGÚN TIPO DE COLUMNA
                                if (columna === 'Calificacion_Final') {
                                    className = 'calificacion-final';
                                    const cal = parseFloat(valorMostrar) || 0;
                                    if (cal >= 8) className += ' aprobado';
                                    else if (cal >= 7) className += ' regular';
                                    else className += ' reprobado';
                                    
                                    if (esValorCero) className += ' valor-cero';
                                    
                                } else if (mapeoActividades[columna]) {
                                    let colorBase = mapeoActividades[columna].color;
                                    const valorNum = parseFloat(valorMostrar) || 0;
                                    
                                    if (esValorCero) {
                                        className = 'valor-cero';
                                        estilo = `background-color: #f8f9fa; color: #6c757d;`;
                                    } else if (valorNum >= 8) {
                                        estilo = `background-color: ${colorBase};`;
                                    } else if (valorNum >= 7) {
                                        estilo = `background-color: ${colorBase}E8;`;
                                    } else if (valorNum >= 5) {
                                        estilo = `background-color: ${colorBase}D0;`;
                                    } else if (valorNum > 0) {
                                        estilo = `background-color: ${colorBase}C0;`;
                                    }
                                } else if (['No.', 'Matricula', 'Nombre_Alumno'].includes(columna)) {
                                    className = 'info-basic';
                                }
                                
                                return `<td class="${className}" style="${estilo}">${valorMostrar}</td>`;
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
            <div>Sistema de Gestión Académica - Reporte de Calificaciones</div>
            <div style="color: #666; margin-top: 3px;">© 2025 - Plataforma Docente UTHH</div>
        </div>
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