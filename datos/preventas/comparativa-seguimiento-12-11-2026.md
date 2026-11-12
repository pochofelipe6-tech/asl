# Comparación del seguimiento anterior con la aplicación

Seguimiento posterior: el corte del 13/11/2026 quedó corregido y verificado. Detalle en [correccion-seguimiento-13-11-2026.md](correccion-seguimiento-13-11-2026.md).

## Última actualización: seguimiento copia (2)

Se sustituyó el corte vigente del **12/11/2026** por los **1.228 registros** de `Stock Disp Regional Norte Base - copia (2).xlsx`, hoja Datos. Lote activo: `28320023-8d0f-4e6f-b65c-eebbc186a9b8`. El corte anterior deja de sumarse en la aplicación y se conserva como respaldo. Los 2.365 registros vigentes de otros días y el histórico SO quedaron iguales; se verificó su huella antes y después dentro de la transacción.

| Métrica | Resultado guardado (HL) |
|---|---:|
| Preventa | 23.978,90864 |
| Disponible | 22.835,81838 |
| Agotados | 1.143,09026 |

Se contrastaron las tres métricas de los 17 CD con la primera tabla de Preventa x Canal y los cálculos de los 1.228 registros con Datos: sin diferencias. Las referencias 23426 y 21204 (factor 6; HL 0,0033; Cervezas) se incorporaron al catálogo desde este libro.

La carga de archivos base ahora busca referencias por código de material y centro en los Datos existentes, usando el corte más reciente, y después en el catálogo. Para libros con Datos, completa celdas vacías por el mismo código dentro del libro, en Fuentes y en el catálogo. Recalcula total disponible, disponible final, preventa, inventarios, agotados y llaves; completa mes y semana si faltan. Si hay referencias contradictorias, muestra el detalle para revisarlas. No copia la referencia del producto de la fila anterior.

En este archivo, Factor, HL, CD y categoría ya están completos. El único error Excel es `#N/D` en FRC Día (columna AG), por búsquedas sin coincidencia en Tránsitos: permanece en cero siguiendo el comportamiento actual; no afecta las tres métricas de preventa y no constituye un pronóstico recuperado. Los demás valores auxiliares válidos se conservan.

Respaldo: `respaldo-antes-seguimiento-copia-2.json`. Evidencia del guardado: `resultado-seguimiento-copia-2.json`. Validación actualizada: TypeScript sin errores y 12 pruebas aprobadas; una prueba de integración omitida por no activar conexión en esta ejecución. Esta revisión no volvió a ejecutar la carga ni la auditoría contra Supabase.

---

## Historial de la comparación inicial

**Cambio posterior solicitado:** se retiró el bloqueo por referencias nuevas. Se permite guardar las filas con referencia y revisar las excluidas en la vista previa, con la confirmación de carga parcial. Los registros sin referencia no aportan HL hasta completar sus factores y reimportar el archivo original. Verificado con `12KA (2).xlsx`; el comportamiento de bloqueo descrito abajo es histórico.

**Estado: corregido y verificado en Supabase.** La comparación inicial que sigue documenta la causa del problema antes de corregirlo.

Se incorporaron las referencias 22284 y 22256 y se reimportó el corte en el lote `ce47a06d-ab64-4671-9236-6d70434719ee`. El lote anterior se conserva, además del respaldo local `respaldo-corte-12-antes-correccion.json`. Se verificó que reejecutar la corrección no duplica registros.

La auditoría posterior confirmó 1.003 registros tanto en Excel como en el corte vigente: Riohacha suma 773,78436 HL de preventa y 748,33794 HL disponibles; el total suma 19.720,93616 HL de preventa y 18.571,78786 HL disponibles. Los agotados permanecen en 1.149,14830 HL. El JSON de auditoría corresponde a esta verificación posterior; el cuadro inferior documenta el estado anterior.

La importación ahora bloquea materiales desconocidos nuevos y centros sin referencia. Los materiales del archivo base que ya estaban fuera de la hoja Datos del seguimiento anterior se identifican en `src/shared/preventas-exclusiones.ts` y mantienen la confirmación explícita de exclusión. Esta lista conserva el alcance del seguimiento auditado; no representa referencias de conversión ni permite excluir automáticamente materiales nuevos. Para ampliar ese alcance se necesitan referencias verificadas.

Validación del código: TypeScript sin errores; nueve pruebas aprobadas y dos pruebas de integración omitidas por no activar conexión en esa ejecución. El guardado real y la lectura posterior se comprobaron directamente contra Supabase.

Corte analizado: **12/11/2026** (serial Excel 46338).

Fuentes: `Stock Disp Regional Norte Base - copia (1).xlsx`, hoja `Datos` y tabla `Preventa x Canal`; consulta directa de los cortes vigentes de Supabase, con la misma selección de lotes que usa la aplicación. El lote vigente de este corte es `9ebdd259-69f7-4178-add7-6d56e2368f7b`, archivo `12KA.xlsx`. Se reprodujo también la transformación de `Downloads/12KA.xlsx`.

## Resultado

**La diferencia está en la importación de la aplicación: su catálogo no contiene dos materiales presentes en el seguimiento anterior.** `transformarBase`, en `src/shared/preventas-base.ts`, excluye los registros cuyo material no tiene referencia de factor, HL y categoría en `src/shared/preventas-catalogo.ts`.

| Concepto (HL) | Excel anterior | Base de la aplicación | Faltante en aplicación |
|---|---:|---:|---:|
| Preventa Riohacha | 773,78436 | 755,96436 | 17,82000 |
| Disponible Riohacha | 748,33794 | 730,51794 | 17,82000 |
| Agotados Riohacha | 25,44642 | 25,44642 | 0 |
| Preventa Montería | 1.761,41270 | 1.761,33350 | 0,07920 |
| Preventa total | 19.720,93616 | 19.703,03696 | 17,89920 |
| Disponible total | 18.571,78786 | 18.553,88866 | 17,89920 |
| Agotados totales | 1.149,14830 | 1.149,14830 | 0 |

Los valores redondeados de Riohacha son 774 frente a 756 HL. La diferencia total visible es 19.721 frente a 19.703 HL.

## Registros que explican toda la diferencia

| CD | Centro | Material | Descripción | Canal | Pedidos | Factor | HL/unidad | HL preventa | Fila en Datos | Fila en 12KA.xlsx |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|
| Riohacha | AV30 | 22284 | BBC LAGER BR 29.7L X1 | TAT | 60 | 1 | 0,297 | 17,82 | 367 | 849 |
| Montería | AV39 | 22256 | POKER LTA 330CC X12 SHRINKPACK | TAT | 2 | 12 | 0,0033 | 0,0792 | 375 | 1164 |

Riohacha: `60 × 1 × 0,297 = 17,82 HL`. El inventario es `70 × 1 × 0,297 = 20,79 HL`; no genera agotados. Por eso faltan los mismos 17,82 HL en preventa y disponible, y los agotados permanecen iguales.

Montería: `2 × 12 × 0,0033 = 0,0792 HL`. Tampoco genera agotados.

Ambos registros están en el archivo base original. Sus referencias no existen en el catálogo actual de la aplicación, y la reproducción del importador confirma su exclusión por ese motivo.

## Comprobaciones

- La hoja Datos del seguimiento tiene 1.003 registros; Supabase tiene 1.001 para esa misma fecha. Solo faltan los dos registros anteriores; no hay registros adicionales en Supabase respecto a esa hoja.
- Para los 1.001 registros coincidentes, las columnas que intervienen en preventa, disponible y agotados coinciden. No hay diferencias en pedidos, factor, HL ni resultados calculados.
- Se recalcularon las cinco columnas derivadas de los 1.003 registros del Excel con `normalizarPreventa`: ninguna diferencia numérica superior a 0,00000001.
- La tabla dinámica del seguimiento coincide con la suma de su hoja Datos en los importes comparados. No se encontró un error del seguimiento anterior que explique esta diferencia.
- La fecha de los 1.003 registros del Excel es 46338, correspondiente al 12/11/2026. La comparación usa exactamente ese corte de Supabase.
- Los campos vacíos de cantidad en planta en Excel corresponden a cero en la aplicación y no alteran el cálculo.
- El nombre `La Arenosa` aparece como `La Árenosa` en Supabase; sus importes coinciden. No explica la diferencia de Riohacha.
- `FRC Día` es 42 en los registros del seguimiento y 0 en la aplicación. Este campo no interviene en las tres métricas comparadas; requiere una revisión separada si se usa en otro informe.

El archivo bruto de 15 columnas contiene otros materiales sin referencia que el importador excluye. No se concluye que todos deban incluirse: el seguimiento anterior tampoco los incorpora en su hoja Datos. La diferencia demostrada entre ese seguimiento y la aplicación corresponde exactamente a los dos registros identificados.

## Corrección necesaria

Incorporar las referencias verificadas de 22284 y 22256 al catálogo y volver a importar el corte del 12/11/2026 mediante un lote nuevo que conserve el anterior. Revisar también la presentación de exclusiones para que la carga no parezca completa cuando faltan referencias.

Esta auditoría solo consultó la base de datos: no modificó registros, referencias ni fórmulas. El detalle de la comparación se conserva en `auditoria-seguimiento.json`; se puede regenerar con `scripts/auditar-seguimiento-preventas.ts` y la conexión local configurada.
