# Comparativa del Excel y la aplicación de frescura

## Resultado

La información consolidada se cargó correctamente. Después de esta comparación se implementaron las selecciones iniciales y las principales reglas encontradas; las cifras iniciales contrastadas coinciden con el Excel. Sigue siendo necesario validar otras combinaciones de filtros y los casos especiales antes de certificar una equivalencia completa.

Se compararon los archivos `2. IF Regional Norte 2026 (H2).xlsb` y `2. Data IF 2026 (H2).xlsb` con la aplicación y el último lote del consolidado en Supabase.

## Integridad del consolidado

- Se compararon las 41 columnas de las 146.182 filas no vacías de la hoja `Data` con la copia preparada para la importación: **0 diferencias**.
- Se compararon todas esas filas preparadas con el último lote de Supabase: **146.182 filas, 0 faltantes y 0 diferencias en los valores**.
- La comparación verifica los valores guardados. No significa que PostgreSQL esté ejecutando las fórmulas de Excel o actualizando su caché de tablas dinámicas.

## Pruebas con las selecciones guardadas en Excel

Se leyeron las segmentaciones, los filtros de las tablas dinámicas y los totales guardados. Después se aplicaron esas condiciones al consolidado en Supabase. Las cifras siguientes son hectolitros sin redondear, salvo las columnas de valor indicadas.

| Módulo | Resultado del contraste |
| --- | --- |
| Diario SKU | Para Corozal, material 22269, año 2026 y las nueve fechas guardadas, coinciden los nueve totales; por ejemplo, el 02/09/2026 da **71,5728**. |
| Resumen | El total guardado y el consolidado con los filtros correspondientes coinciden: **652,9756 hl**, **116.122.821,91 COP** y **29.534,9137103984 USD**. La tabla de los cinco materiales principales suma **438,83264 hl** en ambas fuentes. |
| TD SKUS | Con las selecciones guardadas y el filtro de los cinco materiales principales, coinciden **568,83449 hl** y los códigos 7584, 22269, 23060, 9150 y 23047. |
| IF 30 a 60 días | Con las selecciones guardadas, los materiales seleccionados y el filtro de valor de Excel, coinciden **5.415,6234 hl** en 21 grupos. |
| Riesgos CD | Con las selecciones guardadas, material 7584 y el filtro de valor de Excel, coinciden **3.007,50608 hl**. |
| Tendencia diaria | Con las selecciones guardadas, coinciden **2.945,76475 hl** para el 02/09/2026 y **814,75722 hl** para el 23/10/2026. La variación guardada es **2.131,00753 hl**. |
| KA | Con las selecciones guardadas y el filtro de valor de Excel, coinciden **621,6668 hl**. |
| Riesgos rango días | Con las selecciones guardadas coinciden **528,49906 hl** en la tabla por material y **544,24357 hl** en la tabla por CD. En la segunda, el filtro de los 15 materiales principales se evalúa por cada CD, de modo que los dos totales no tienen por qué ser iguales. |

Estas pruebas son muestras importantes, no una certificación de cada celda o combinación de filtros de las tablas.

## Cambios implementados después de la comparación

- Se cargan las selecciones guardadas en el Excel para los ocho módulos y se permite seleccionar varios valores en los filtros superiores.
- Se aplica el umbral de 10 hectolitros en las agrupaciones de IF 30 a 60 días, Riesgos CD y KA, y los límites de 5 o 15 materiales en las tablas correspondientes. En Riesgos rango días, los 15 principales por CD se calculan para cada centro.
- Tendencia diaria muestra la variación entre el primer y el último corte seleccionado y el resumen de octubre, noviembre y diciembre. Se eliminó la suma general de cortes en esa tabla y en Diario SKU cuando se comparan varias fechas.
- Resumen incluye Compromiso y Riesgo con los valores iniciales del libro. Compromiso es editable durante la sesión; los cambios no se guardan en Supabase y se restablecen al recargar la página. La fila de riesgo se calcula con los valores de diciembre y muestra que faltan datos cuando diciembre no está en la selección.
- Se verificaron en el navegador los totales iniciales de los ocho módulos, los dos totales de Riesgos rango días, los indicadores de Tendencia y el recálculo al editar Compromiso. También se comprobó una selección múltiple de centros.

Los filtros automáticos de valor se han contrastado con los ejemplos iniciales del libro, pero las reglas completas de cada tabla dinámica ante toda combinación de segmentaciones requieren más validación. El informe utiliza valores de días y rangos guardados en el consolidado, no un recálculo automático al cambiar la fecha del sistema.

## Diferencias detectadas en la comparación inicial

1. **Selecciones iniciales.** El Excel conserva selecciones distintas por informe. Por ejemplo, Riesgos CD utiliza el 23/10/2026, línea Cervezas y código 7584; la aplicación usa por defecto el último corte y no aplica esas selecciones. Diario SKU guarda Corozal, año 2026 y material 22269, mientras que la aplicación inicia con otras selecciones.
2. **Filtros de valor de las tablas dinámicas.** En IF 30 a 60 días, Riesgos CD y KA el Excel tiene un filtro por valor de al menos 10 hectolitros asociado a Fecha Vencimiento. Al aplicar las demás condiciones de IF, el consolidado da **5.426,0217 hl** antes de ese filtro y **5.415,6234 hl** después. La aplicación actual no aplica ese filtro automáticamente. El umbral se aplica en el contexto de agrupación de la tabla dinámica; no equivale necesariamente a descartar cada fila de origen menor de 10.
3. **Principales materiales.** Excel aplica un filtro de los cinco principales a la tabla por material de Resumen y a TD SKUS, y uno de 15 a las tablas de Riesgos rango días. En la tabla por CD de este último informe, la selección de los 15 se hace por centro. La aplicación muestra todos los materiales que cumplen sus filtros en vez de reproducir automáticamente esos criterios.
4. **Selección múltiple.** Muchas segmentaciones de Excel permiten combinar varias opciones, por ejemplo rangos de vencimiento, canales o centros. En la aplicación muchos de esos filtros superiores son de selección única; las casillas de selección múltiple solo están disponibles en algunos controles y encabezados.
5. **Tendencia diaria y fechas históricas.** La tabla de Excel incluye una columna de variación y un resumen Oct/Nov/Dic. La aplicación no los reproduce actualmente. Cuando se muestran varias fechas, la columna Hectolitros de la aplicación suma valores de diferentes cortes; ese acumulado no representa automáticamente inventario de un solo día y debe definirse antes de usarlo como indicador.
6. **Compromiso y Riesgo.** El bloque de Resumen del Excel tiene esos valores y fórmulas; las tres tablas principales de la aplicación no incluyen ese bloque ni recalculan sus fórmulas.
7. **Otros filtros y cálculos.** Los filtros por etiqueta o valor de Excel no se han reproducido completamente. Los días y rangos disponibles proceden de los valores guardados del consolidado; no se ha validado que se recalculen automáticamente como lo harían las fórmulas del libro.
8. **Detalle de totales y vistas.** La tabla por material de Resumen en el libro está limitada a cinco materiales, por eso su subtotal puede ser diferente del total general. Es necesario validar cada tabla y los resultados tras cambiar las segmentaciones, no solo el total inicial.

## Prueba de las consultas de la aplicación

Se solicitó a los ocho módulos el corte 30/10/2026, CD Corozal y línea Cervezas. La suma devuelta por cada consulta coincidió con la suma del consolidado bajo esas mismas condiciones; en KA se aplicó además el canal KA. Esta prueba confirma la agregación básica de esas consultas, pero **no valida los filtros especiales del Excel que faltan**.

## Recomendación

Antes de dar la aplicación por equivalente al Excel en todos los escenarios, repetir la comparación con varias combinaciones de filtros, revisar el comportamiento de los filtros de valor fuera de los ejemplos iniciales y acordar cómo se guardarán y actualizarán los compromisos. Validar los resultados con la persona responsable del informe.
