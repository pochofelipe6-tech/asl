# Corrección del seguimiento del 13/11/2026

La aplicación excluía dos filas del centro `AV03` porque faltaba su referencia a Barranquilla. Los materiales 17155 y 22102 ya tenían los factores correctos: 6 unidades por empaque y 0,00269 HL por unidad. En este corte la diferencia no provenía de factores faltantes.

Además, la fila 181 de `13KA.xlsx` trae Stock Disp = 0, planta vacía, Total Disponible = 549, pedidos = 100 y Disponible Final = 449. Recalcular planta como cero eliminaba inventario disponible. Ahora se recupera la planta omitida a partir del total solo cuando Total Disponible = Disponible Final + pedidos y el componente recuperado es no negativo. Los valores explícitos no se sustituyen.

Se recuperaron 2,421 HL de preventa, 1,614 HL disponibles y 0,807 HL agotados. Se guardaron las 995 filas del corte en un lote nuevo; el anterior permanece como respaldo. Los 3.593 registros vigentes de otros días y el histórico SO conservaron sus huellas durante la transacción.

| Métrica | HL exactos | Redondeado como la imagen |
|---|---:|---:|
| Preventa | 20.621,54684 | 20.622 |
| Disponible | 18.508,95792 | 18.509 |
| Agotados | 2.112,58892 | 2.113 |

Los valores redondeados de las tres métricas coinciden con los 18 CD de la imagen. También coinciden los totales de preventa y disponible por TAT, KA y T4. La respuesta real de `http://localhost:3001/api/preventas/datos` se verificó después del guardado: HTTP 200, datos persistidos y 995 filas para el corte.

Para referencias nuevas, la importación puede deducir Factor y HL si la descripción indica un único volumen y un único número de unidades: `330 cc × 6` significa Factor = 6 y HL = 330 / 100.000 = 0,0033. Las referencias existentes tienen prioridad; las presentaciones ambiguas no se adivinan. En el archivo base se conserva el alcance de Cervezas/Maltas del seguimiento. No se incorporaron al total los 515 registros de otros materiales sin referencia del seguimiento.

La hoja Datos también consulta las referencias históricas enviadas por la aplicación y utiliza la presentación como alternativa para completar conversiones vacías. Las celdas vacías de Fuentes ya no impiden buscar en el histórico o catálogo.

Validación: compilación y TypeScript correctos; 18 pruebas aprobadas y una prueba de integración omitida. El guardado y la lectura real se verificaron por separado contra Supabase y la aplicación local.

Evidencia: `correccion-corte-13-resultado.json`. Respaldo: `respaldo-corte-13-antes-correccion.json`. Script reproducible: `scripts/corregir-corte-13-preventas.ts` (audita sin modificar; `--aplicar` guarda la corrección).
