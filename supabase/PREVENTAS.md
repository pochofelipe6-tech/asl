# Activar el guardado de Preventas

En el SQL Editor de tu proyecto Supabase, ejecuta en este orden:

1. `preventas_schema.sql`: crea las tablas y la vista de consulta.
2. `preventas_datos_iniciales.sql`: inserta los 954 registros de Datos y el corte histórico de SO del Excel entregado. Puede ejecutarse nuevamente sin duplicar esa carga inicial.

Después abre Preventas y pulsa **Actualizar**. El encabezado debe mostrar **Guardado en Supabase**. El servidor utiliza la conexión privada `SUPABASE_DB_URL` ya usada por Índice de frescura; no se necesitan claves en el navegador.

Las tablas son:

- `preventas_lotes`: archivo, usuario y fecha de cada importación.
- `preventas_datos`: las 35 columnas originales, con fecha, centro, material, canal y CD indexados.
- `preventas_so_snapshot`: la matriz histórica de la hoja SO, desglosada por fecha, material y CD.
- `preventas_detalle` es una vista con preventa, inventario, disponibilidad y agotados en HL.

Las escrituras se hacen desde el servidor autenticado; RLS bloquea escrituras directas del navegador. Estas tablas no modifican las de frescura ni usuarios.

## Operación

- **Datos:** consulta, ingreso manual, importación de `.xlsx`/`.xlsb` (hoja Datos), plantilla vacía y descarga. La importación se valida y muestra cuántas filas se guardarán antes de crear un nuevo corte activo. El archivo debe tener las mismas 35 columnas; se aceptan hasta 10.000 registros y 60 MB. Los cortes previos se conservan en la base.
- **Preventa por canal:** matriz CD/canal de preventa disponible, totales, agotados, participación SO e indicadores filtrables.
- **SO:** matriz de agotados por material/CD, ordenada por faltantes. Inicia con el corte original de SO y permite consultar el corte calculado desde Datos.

El Excel suministrado tiene Datos para **10/11/2026** y SO para **09/11/2026**. Se conservan como cortes separados. El corte SO no tiene canal ni categoría, así que esos filtros no aplican a esa fecha. El canal `x`º` se conserva tal como aparece en el archivo, con aviso para su revisión.

Las fórmulas se calculan por fila antes de agrupar:

```text
Total disponible = Stock Disp + Cant en planta + Cant en transito − Cant entrega Pendien
HL preventa = Cantidad en Pedidos × Factor × HL
Inventarios HL = Total disponible × Factor × HL
Agotados HL = máximo(HL preventa − Inventarios HL, 0)
Preventa disponible HL = HL preventa − Agotados HL
Participación SO = Agotados HL / HL preventa
```

Hasta ejecutar el SQL, la aplicación muestra una vista de consulta del Excel y avisa que aún no está guardada en Supabase. No simula guardados locales.

## Validación

```powershell
npm run build
node --env-file-if-exists=.env.local --test tests/preventas.test.ts
```

La prueba de base de datos utiliza un esquema temporal independiente, lo elimina al terminar y no escribe en las tablas reales.

## Importar el archivo base (09TAT.xlsx)

En Preventas > Datos, elegir la fecha del corte e Importar Excel. Se reconoce la cabecera del archivo base de 15 columnas, aunque la hoja no se llame Datos. La fecha no se deduce del nombre del archivo.

Las referencias de productos y centros se mantienen en src/shared/preventas-catalogo.ts, obtenidas de Fuentes y del corte Datos del Excel original (Datos tiene prioridad). Se recalculan las cantidades, HL, agotados y llaves. Los campos adicionales de Transitos, TMS y FRC quedan en cero: el archivo base no proporciona esas fuentes. No se copia el historico SO de otro corte.

Los productos o centros sin referencia aparecen en una lista de excluidos. El usuario debe confirmar expresamente que guarda solo las filas con referencia antes de Guardar nuevo corte. Para incorporar los excluidos, se deben completar sus referencias verificadas; no se infieren factores ni categorias de la descripcion.

Validacion con 09TAT.xlsx y fecha 2026-11-10: 1435 filas de origen, 954 transformadas y 481 sin referencia. Las 954 coinciden en las 35 columnas con la carga inicial al comparar por centro, material y canal. La validacion no escribe en Supabase.
