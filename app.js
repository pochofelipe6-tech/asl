// Generado desde server.ts por npm run build. No editar directamente.

// server.ts
import path from "node:path";
import { readFile as readFile2 } from "node:fs/promises";
import express7 from "express";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import XLSX from "xlsx";

// src/server/excel.ts
import express from "express";
import { createHash, randomUUID } from "node:crypto";

// src/shared/excel.ts
var COLUMNAS_EXCEL = [
  "Fecha envio informaci\xF3n",
  "Llave",
  "C\xF3digo CD",
  "C\xF3digo Material",
  "Cantidad",
  "Fecha Vencimiento",
  "Usuario",
  "Fecha Modificaci\xF3n",
  "Material",
  "CD",
  "Factor",
  "HL",
  "Hectolitros",
  "Cajas",
  "Mes",
  "D\xEDas Vencimiento",
  "Rango D\xEDas 1",
  "D\xEDa",
  "Empaque",
  "L\xEDnea",
  "USD/HL",
  "Costo USD",
  "Gerencia",
  "Semana",
  "TRM",
  "Clase Envase",
  "Vencimiento 2",
  "Vida \xDAtil",
  "Dias Venc Actual",
  "Venc Actual",
  "Log\xEDstica",
  "Ventas",
  "Valor UN",
  "Valor total",
  "Canal",
  "Venta",
  "Politica_Min_Dias",
  "Politica_Max_Dias",
  "Venta",
  "Mes 1",
  "A\xF1o"
];
var MAX_FILAS = 3e5;
var MAX_ARCHIVO = 100 * 1024 * 1024;
var MAX_FILAS_BLOQUE = 500;
var numericas = /* @__PURE__ */ new Set([4, 12, 13, 21, 28, 33]);
function validarColumnas(columnas) {
  if (!Array.isArray(columnas) || columnas.length !== COLUMNAS_EXCEL.length) throw new Error("La hoja Data debe tener exactamente 41 columnas. Usa la plantilla.");
  for (let i = 0; i < COLUMNAS_EXCEL.length; i++) {
    if (String(columnas[i] ?? "").trim() !== COLUMNAS_EXCEL[i]) throw new Error(`La columna ${i + 1} debe llamarse \xAB${COLUMNAS_EXCEL[i]}\xBB. Usa el orden de la plantilla.`);
  }
}
function fechaExcel(valor) {
  if (valor === null || valor === void 0 || valor === "") return null;
  if (typeof valor === "number" && Number.isFinite(valor) && valor >= 1 && valor < 2958466) return Math.floor(valor);
  if (typeof valor !== "string") throw new Error("Escribe una fecha v\xE1lida de Excel, AAAA-MM-DD o DD/MM/AAAA.");
  const texto = valor.trim();
  if (!texto) return null;
  if (/^\d{1,7}$/.test(texto)) return fechaExcel(Number(texto));
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  const local = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
  if (!iso && !local) throw new Error("Escribe una fecha v\xE1lida de Excel, AAAA-MM-DD o DD/MM/AAAA.");
  const [anio, mes, dia] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [Number(local[3]), Number(local[2]), Number(local[1])];
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (anio < 1900 || fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) throw new Error("La fecha no existe.");
  return fechaExcel((fecha.getTime() - Date.UTC(1899, 11, 30)) / 864e5);
}
function normalizarFila(fila, numeroFila) {
  if (!Array.isArray(fila) || fila.length !== COLUMNAS_EXCEL.length) throw new Error(`Fila ${numeroFila}: se esperaban 41 valores.`);
  const valores = fila.map((valor, columna) => {
    try {
      if (valor === void 0 || valor === null || valor === "") return null;
      if (typeof valor !== "string" && typeof valor !== "number" && typeof valor !== "boolean") throw new Error("El valor no es una celda v\xE1lida.");
      if (typeof valor === "number" && !Number.isFinite(valor)) throw new Error("El n\xFAmero no es v\xE1lido.");
      if (typeof valor === "string" && valor.length > 2e3) throw new Error("El texto supera los 2.000 caracteres.");
      if (columna === 0 || columna === 5) return fechaExcel(valor);
      if (numericas.has(columna)) {
        if (typeof valor === "string" && !valor.trim()) return null;
        if (typeof valor === "boolean" || typeof valor === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(valor.trim())) throw new Error("Usa una celda num\xE9rica, sin s\xEDmbolos de moneda ni separadores de miles.");
        const numero = Number(valor);
        if (!Number.isFinite(numero)) throw new Error("El n\xFAmero no es v\xE1lido.");
        return numero;
      }
      return valor;
    } catch (error) {
      throw new Error(`Fila ${numeroFila}, ${COLUMNAS_EXCEL[columna]}: ${error instanceof Error ? error.message : "valor no v\xE1lido"}`);
    }
  });
  if (valores[0] === null) throw new Error(`Fila ${numeroFila}: falta Fecha envio informaci\xF3n.`);
  if (new TextEncoder().encode(JSON.stringify(valores)).length > 16e3) throw new Error(`La fila ${numeroFila} contiene demasiado texto.`);
  return valores;
}

// src/server/excel.ts
var ErrorCarga = class extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function rutasExcel(pool, sesion, alImportar) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!sesion(req)) {
      res.status(401).json({ error: "Inicia sesi\xF3n para gestionar el Excel." });
      return;
    }
    if (!pool) {
      res.status(503).json({ error: "Falta configurar la conexi\xF3n a la base de datos." });
      return;
    }
    if (!["GET", "HEAD"].includes(req.method) && req.get("sec-fetch-site") === "cross-site") {
      res.status(403).json({ error: "Abre la aplicaci\xF3n para realizar esta operaci\xF3n." });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  async function bloquear(client, id, usuario) {
    if (!uuid.test(id)) throw new ErrorCarga(400, "La carga no es v\xE1lida.");
    const result = await client.query(`select *, creado_en < now() - interval '24 hours' as vencida from frescura_importaciones where id=$1 and usuario_id=$2 for update`, [id, usuario]);
    const carga = result.rows[0];
    if (!carga) throw new ErrorCarga(404, "No se encontr\xF3 esta carga.");
    if (carga.vencida && carga.estado === "pendiente") throw new ErrorCarga(410, "La carga venci\xF3. Selecciona el archivo de nuevo.");
    return carga;
  }
  async function transaccion(accion) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await accion(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  router.get("/archivo", async (_req, res) => {
    const result = await pool.query("select id, archivo, filas, cargado_en from frescura_consolidado_lotes order by cargado_en desc limit 1");
    if (!result.rows.length) throw new ErrorCarga(404, "Todav\xEDa no hay un Excel cargado.");
    res.json({ ...result.rows[0], columnas: COLUMNAS_EXCEL });
  });
  router.get("/datos", async (req, res) => {
    const { lote, despues = "1", desde, hasta } = req.query;
    let rango;
    if (desde !== void 0 || hasta !== void 0) {
      if (typeof desde !== "string" || typeof hasta !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) throw new ErrorCarga(400, "Selecciona la fecha inicial y final.");
      try {
        rango = [fechaExcel(desde), fechaExcel(hasta)];
      } catch {
        throw new ErrorCarga(400, "El rango contiene una fecha inv\xE1lida.");
      }
      if (rango[0] > rango[1]) throw new ErrorCarga(400, "La fecha inicial debe ser anterior o igual a la final.");
    }
    if (typeof lote !== "string" || lote.length > 200 || typeof despues !== "string" || !/^\d{1,7}$/.test(despues)) throw new ErrorCarga(400, "La descarga solicitada no es v\xE1lida.");
    const existe = await pool.query("select id from frescura_consolidado_lotes where id=$1", [lote]);
    if (!existe.rows.length) throw new ErrorCarga(404, "No se encontr\xF3 el archivo solicitado.");
    const filtro = rango ? " and (valores->>0)::numeric >= $3 and (valores->>0)::numeric < $4" : "";
    const parametros = [lote, Number(despues), ...rango ? [rango[0], rango[1] + 1] : []];
    const result = await pool.query("select fila_excel, valores from frescura_consolidado where lote_id=$1 and fila_excel>$2" + filtro + " order by fila_excel limit 2001", parametros);
    const total = Number(despues) === 1 && rango ? (await pool.query("select count(*)::int as n from frescura_consolidado where lote_id=$1 and fila_excel>$2" + filtro, parametros)).rows[0].n : void 0;
    const filas = [];
    let bytes = 0;
    for (const fila of result.rows.slice(0, 2e3)) {
      const tamano = Buffer.byteLength(JSON.stringify(fila));
      if (filas.length && bytes + tamano > 1e6) break;
      filas.push(fila);
      bytes += tamano;
    }
    res.json({ filas, total, siguiente: result.rows.length > filas.length ? filas.at(-1).fila_excel : null });
  });
  router.post("/importaciones", async (req, res) => {
    const { archivo, filas, columnas } = req.body ?? {};
    if (typeof archivo !== "string" || archivo.length > 180 || !/\.(xlsx|xlsb)$/i.test(archivo) || /[\/\\\x00-\x1f]/.test(archivo)) throw new ErrorCarga(400, "Selecciona un archivo .xlsx o .xlsb v\xE1lido.");
    if (!Number.isSafeInteger(filas) || filas < 1 || filas > MAX_FILAS) throw new ErrorCarga(400, `El archivo debe contener entre 1 y ${MAX_FILAS} filas.`);
    try {
      validarColumnas(columnas);
    } catch (error) {
      throw new ErrorCarga(400, error.message);
    }
    const usuario = sesion(req).sub;
    const id = randomUUID();
    await transaccion(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext($1))", ["excel:" + usuario]);
      await client.query(`delete from frescura_importaciones where estado <> 'completa' and creado_en < now() - interval '24 hours'`);
      const activas = await client.query(`select count(*)::int as n from frescura_importaciones where usuario_id=$1 and estado='pendiente'`, [usuario]);
      if (activas.rows[0].n >= 3) throw new ErrorCarga(409, "Ya tienes tres cargas pendientes. Cancela una antes de continuar.");
      const actual = await client.query("select id from frescura_consolidado_lotes order by cargado_en desc limit 1");
      await client.query("insert into frescura_importaciones(id,usuario_id,archivo,filas,lote_base) values($1,$2,$3,$4,$5)", [id, usuario, archivo, filas, actual.rows[0]?.id ?? null]);
    });
    res.status(201).json({ id, recibidas: 0 });
  });
  router.put("/importaciones/:id/filas", async (req, res) => {
    const { offset, filas } = req.body ?? {};
    if (!Number.isSafeInteger(offset) || offset < 0 || !Array.isArray(filas) || !filas.length || filas.length > MAX_FILAS_BLOQUE) throw new ErrorCarga(400, "El bloque de filas no es v\xE1lido.");
    let anterior = 1;
    const normalizadas = filas.map((fila) => {
      if (!fila || !Number.isSafeInteger(fila.fila_excel) || Number(fila.fila_excel) <= anterior || Number(fila.fila_excel) > 1048576) throw new ErrorCarga(400, "Las filas deben conservar su orden en Excel.");
      anterior = Number(fila.fila_excel);
      try {
        return { fila_excel: anterior, valores: normalizarFila(fila.valores, anterior) };
      } catch (error) {
        throw new ErrorCarga(400, error.message);
      }
    });
    const hash = createHash("sha256").update(JSON.stringify(normalizadas)).digest("hex");
    const recibidas = await transaccion(async (client) => {
      const carga = await bloquear(client, String(req.params.id), sesion(req).sub);
      if (carga.estado !== "pendiente") throw new ErrorCarga(409, "Esta carga ya no admite filas.");
      if (carga.ultimo_offset === offset && carga.ultimo_hash === hash) return carga.recibidas;
      if (offset !== carga.recibidas || offset + filas.length > carga.filas || normalizadas[0].fila_excel <= carga.ultima_fila) throw new ErrorCarga(409, "Las filas recibidas no coinciden con el progreso de la carga.");
      await client.query(`insert into frescura_importacion_filas(importacion_id,posicion,fila_excel,valores)
        select $1, $2 + (ordinalidad - 1)::int, (fila->>'fila_excel')::int, fila->'valores'
        from jsonb_array_elements($3::jsonb) with ordinality as t(fila,ordinalidad)`, [carga.id, offset, JSON.stringify(normalizadas)]);
      const total = offset + filas.length;
      await client.query("update frescura_importaciones set recibidas=$2,ultima_fila=$3,ultimo_offset=$4,ultimo_hash=$5 where id=$1", [carga.id, total, anterior, offset, hash]);
      return total;
    });
    res.json({ recibidas });
  });
  router.get("/importaciones/:id", async (req, res) => {
    const carga = await transaccion((client) => bloquear(client, String(req.params.id), sesion(req).sub));
    res.json({ estado: carga.estado, recibidas: carga.recibidas, filas: carga.filas, lote: carga.lote_id });
  });
  router.post("/importaciones/:id/finalizar", async (req, res) => {
    const resultado = await transaccion(async (client) => {
      const carga = await bloquear(client, String(req.params.id), sesion(req).sub);
      if (carga.estado === "completa") return { lote: carga.lote_id, filas: carga.filas };
      if (carga.estado !== "pendiente" || carga.recibidas !== carga.filas) throw new ErrorCarga(409, "La carga no est\xE1 completa. El informe anterior sigue activo.");
      const conteo = await client.query("select count(*)::int as n from frescura_importacion_filas where importacion_id=$1", [carga.id]);
      if (conteo.rows[0].n !== carga.filas) throw new ErrorCarga(409, "No coinciden las filas recibidas. El informe anterior sigue activo.");
      await client.query("select pg_advisory_xact_lock(hashtext('excel:activar-lote'))");
      const actual = await client.query("select id from frescura_consolidado_lotes order by cargado_en desc limit 1");
      if ((actual.rows[0]?.id ?? null) !== carga.lote_base) throw new ErrorCarga(409, "Otra carga actualiz\xF3 el informe. Revisa el informe actual antes de volver a importar.");
      const lote = "web-" + carga.id;
      await client.query("insert into frescura_consolidado_lotes(id,archivo,filas,cargado_en) values($1,$2,$3,clock_timestamp())", [lote, carga.archivo, carga.filas]);
      await client.query("insert into frescura_consolidado(lote_id,fila_excel,valores) select $1,fila_excel,valores from frescura_importacion_filas where importacion_id=$2 order by posicion", [lote, carga.id]);
      await client.query("update frescura_importaciones set estado='completa',lote_id=$2 where id=$1", [carga.id, lote]);
      await client.query("delete from frescura_importacion_filas where importacion_id=$1", [carga.id]);
      return { lote, filas: carga.filas };
    });
    alImportar();
    res.json(resultado);
  });
  router.delete("/importaciones/:id", async (req, res) => {
    await transaccion(async (client) => {
      const carga = await bloquear(client, String(req.params.id), sesion(req).sub);
      if (carga.estado === "completa") throw new ErrorCarga(409, "El archivo ya se import\xF3.");
      await client.query("update frescura_importaciones set estado='cancelada' where id=$1", [carga.id]);
      await client.query("delete from frescura_importacion_filas where importacion_id=$1", [carga.id]);
    });
    res.status(204).end();
  });
  router.use((error, _req, res, _next) => {
    if (error instanceof ErrorCarga) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("Error gestionando Excel:", error instanceof Error ? error.message : "error desconocido");
    res.status(500).json({ error: "No se pudo completar la operaci\xF3n con el Excel. Int\xE9ntalo de nuevo." });
  });
  return router;
}

// src/server/preventas.ts
import express2 from "express";
import { randomUUID as randomUUID2 } from "node:crypto";
import { readFile } from "node:fs/promises";

// src/shared/preventas.ts
var COLUMNAS_PREVENTAS = ["Fecha", "Cond de Exp", "Centro", "Material", "Descripci\xF3n", "UM", "Status", "Stock Disp", "Cant en planta", "Cant en transito", "Cant entrega Pendien", "Total Disponible", "Cant de pedidos", "Cantidad en Pedidos", "Disponible Final", "Canal", "Factor", "HL", "HL Preventa", "Inventarios", "Agotados", "CD", "Llave", "Tr\xE1nsitos", "TMS", "Llave 2", "Llave 3", "Llave 4", "FRC", "Categor\xEDa", "Mes", "Semana", "FRC D\xEDa", "FRC W", "Mes"];
var MAX_PREVENTAS = 1e4;
var numericas2 = [7, 8, 9, 10, 12, 13, 16, 17, 23, 24, 28, 31, 32, 33];
function normalizarPreventa(input, numero = 1) {
  if (!Array.isArray(input) || input.length !== 35) throw new Error(`Fila ${numero}: se requieren las 35 columnas de Datos.`);
  const fila = input.map((v) => v === null || v === void 0 ? null : typeof v === "number" && Number.isFinite(v) ? v : String(v).trim());
  const fecha = fechaExcel(fila[0]);
  if (!fecha) throw new Error(`Fila ${numero}: falta la fecha.`);
  fila[0] = fecha;
  for (const i of [2, 3, 4, 15, 21]) {
    if (!fila[i] || String(fila[i]).length > 180) throw new Error(`Fila ${numero}: completa ${COLUMNAS_PREVENTAS[i]} (m\xE1ximo 180 caracteres).`);
    fila[i] = String(fila[i]).trim();
  }
  for (const i of numericas2) {
    const valor = fila[i] === null || fila[i] === "" ? 0 : Number(fila[i]);
    if (!Number.isFinite(valor) || Math.abs(valor) > 1e12) throw new Error(`Fila ${numero}: ${COLUMNAS_PREVENTAS[i]} debe ser num\xE9rico.`);
    fila[i] = valor;
  }
  if (Number(fila[16]) <= 0 || Number(fila[17]) <= 0 || Number(fila[13]) < 0) throw new Error(`Fila ${numero}: Factor y HL deben ser positivos; los pedidos no pueden ser negativos.`);
  for (const v of fila) if (typeof v === "string" && v.length > 500) throw new Error(`Fila ${numero}: texto demasiado largo.`);
  fila[11] = Number(fila[7]) + Number(fila[8]) + Number(fila[9]) - Number(fila[10]);
  fila[14] = Number(fila[11]) - Number(fila[13]);
  fila[18] = Number(fila[13]) * Number(fila[16]) * Number(fila[17]);
  fila[19] = Number(fila[11]) * Number(fila[16]) * Number(fila[17]);
  fila[20] = Math.max(Number(fila[18]) - Number(fila[19]), 0);
  fila[22] = `${fila[2]}${fila[3]}${fecha}`;
  fila[25] = `${fila[2]}${fila[3]}`;
  fila[26] = `${fila[2]}${fila[3]}${fila[31]}`;
  fila[27] = `${fila[2]}${fecha}`;
  return fila;
}

// src/server/preventas.ts
function rutasPreventas(pool, sesion) {
  const router = express2.Router();
  router.use((req, res, next) => {
    if (!sesion(req)) {
      res.status(401).json({ error: "Inicia sesi\xF3n para abrir Preventas." });
      return;
    }
    if (req.method !== "GET" && req.get("sec-fetch-site") === "cross-site") {
      res.status(403).json({ error: "Abre la aplicaci\xF3n para guardar datos." });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get("/datos", async (_req, res) => {
    try {
      if (pool) {
        const lote = (await pool.query("select id,archivo,creado_en from public.preventas_lotes order by creado_en desc,id desc limit 1")).rows[0];
        if (lote) {
          const result = await pool.query(`with cortes as (
            select distinct on (d.fecha) d.fecha,d.lote_id
            from public.preventas_datos d join public.preventas_lotes l on l.id=d.lote_id
            order by d.fecha,l.creado_en desc,l.id desc
          ) select row_number() over(order by d.fecha,d.fila)::int as fila,d.valores
            from public.preventas_datos d join cortes c on c.fecha=d.fecha and c.lote_id=d.lote_id
            order by d.fecha,d.fila`);
          const snapshot = (await pool.query(`with cortes as (
            select distinct on (s.fecha_excel) s.fecha_excel,s.lote_id
            from public.preventas_so_snapshot s join public.preventas_lotes l on l.id=s.lote_id
            order by s.fecha_excel,l.creado_en desc,l.id desc
          ) select s.fecha_excel as fecha,s.material,s.descripcion,s.cd,s.agotados_hl::float8 as agotados
            from public.preventas_so_snapshot s join cortes c on c.fecha_excel=s.fecha_excel and c.lote_id=s.lote_id`)).rows;
          res.json({ lote, filas: result.rows.map((r) => ({ id: r.fila, valores: r.valores })), snapshot, persistido: true });
          return;
        }
      }
    } catch (error) {
      if (error.code !== "42P01") {
        console.error("Consulta Preventas:", error.message);
        res.status(503).json({ error: "No se pudo consultar Preventas. Reintenta en un momento." });
        return;
      }
    }
    const inicial = JSON.parse(await readFile("datos/preventas/inicial.json", "utf8"));
    res.json({ lote: { id: null, archivo: inicial.archivo }, filas: inicial.filas.map((valores, i) => ({ id: i + 1, valores })), snapshot: inicial.snapshot, persistido: false });
  });
  router.post("/guardar", async (req, res) => {
    if (!pool) {
      res.status(503).json({ error: "Configura la conexi\xF3n de Supabase para guardar." });
      return;
    }
    const { archivo, filas, modo, loteBase, snapshot = [] } = req.body ?? {};
    if (!["importar", "agregar"].includes(modo) || !Array.isArray(filas) || !filas.length || filas.length > MAX_PREVENTAS || modo === "agregar" && filas.length !== 1 || typeof archivo !== "string" || archivo.length > 180) {
      res.status(400).json({ error: "La carga no es v\xE1lida. M\xE1ximo 10.000 registros por archivo." });
      return;
    }
    let datos;
    try {
      datos = filas.map((f, i) => normalizarPreventa(f, i + 2));
    } catch (error) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (!Array.isArray(snapshot) || snapshot.length > 2e4 || snapshot.some((s) => !s || !Number.isInteger(s.fecha) || s.fecha < 1 || s.fecha > 2958465 || !["material", "descripcion", "cd"].every((k) => typeof s[k] === "string" && s[k].length > 0 && s[k].length < 500) || !Number.isFinite(s.agotados) || s.agotados < 0 || s.agotados > 1e12)) {
      res.status(400).json({ error: "El corte hist\xF3rico de SO contiene datos no v\xE1lidos." });
      return;
    }
    let client;
    try {
      client = await pool.connect();
    } catch {
      res.status(503).json({ error: "No se pudo conectar a Supabase. Reintenta en un momento." });
      return;
    }
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext('preventas:guardar'))");
      const actual = (await client.query("select id from public.preventas_lotes order by creado_en desc,id desc limit 1")).rows[0]?.id ?? null;
      if (!actual && modo === "agregar") {
        await client.query("rollback");
        res.status(409).json({ error: "Carga primero los datos iniciales en Supabase o importa un Excel completo." });
        return;
      }
      if (actual !== loteBase) {
        await client.query("rollback");
        res.status(409).json({ error: "Los datos cambiaron. Recarga antes de guardar." });
        return;
      }
      let lote = actual;
      if (modo === "agregar") {
        lote = (await client.query(`select d.lote_id from public.preventas_datos d
          join public.preventas_lotes l on l.id=d.lote_id where d.valores->>0=$1
          order by l.creado_en desc,l.id desc limit 1`, [String(datos[0][0])])).rows[0]?.lote_id ?? null;
      }
      if (modo === "importar" || !lote) {
        lote = randomUUID2();
        await client.query("insert into public.preventas_lotes(id,archivo,usuario_id) values($1,$2,$3)", [lote, archivo, sesion(req).sub]);
      }
      const max = (await client.query("select coalesce(max(fila),0)::int as n from public.preventas_datos where lote_id=$1", [lote])).rows[0].n;
      if (max + datos.length > MAX_PREVENTAS) throw new Error("El corte supera los 10.000 registros. Importa un nuevo corte.");
      for (let i = 0; i < datos.length; i += 500) {
        await client.query("insert into public.preventas_datos(lote_id,fila,valores) select $1,$2+ordinality::int,value from jsonb_array_elements($3::jsonb) with ordinality", [lote, max + i, JSON.stringify(datos.slice(i, i + 500))]);
      }
      if (modo === "importar" && snapshot.length) {
        await client.query(`insert into public.preventas_so_snapshot(lote_id,fecha_excel,material,descripcion,cd,agotados_hl)
          select $1,fecha,material,descripcion,cd,agotados from jsonb_to_recordset($2::jsonb)
          as x(fecha integer,material text,descripcion text,cd text,agotados numeric)`, [lote, JSON.stringify(snapshot)]);
      }
      await client.query("commit");
      res.json({ lote, guardadas: datos.length });
    } catch (error) {
      await client.query("rollback");
      const falta = error.code === "42P01";
      console.error("Guardado Preventas:", error.message);
      res.status(503).json({ error: falta ? "Ejecuta preventas_schema.sql y preventas_datos_iniciales.sql en Supabase antes de guardar." : "No se pudieron guardar los datos. No se aplic\xF3 la carga; reintenta." });
    } finally {
      client.release();
    }
  });
  return router;
}

// src/server/formularios.ts
import express3 from "express";

// src/shared/formularios.ts
var CDS_REGIONAL_NORTE = [
  "Apartado",
  "Cartagena KA",
  "Caucasia",
  "Corozal",
  "Cucuta",
  "Curumani",
  "Fonseca",
  "Galapa",
  "La Arenosa",
  "Magangue",
  "Monteria",
  "Riohacha",
  "San Andres",
  "Santa Marta",
  "Turbaco",
  "Valledupar"
];
var UNIDADES = { tipo: "numero", entero: true, minimo: 0 };
var EN_UNIDADES = "Indique todas las respuestas en unidades";
var FORMULARIOS = [
  {
    id: "control-inventarios",
    titulo: "Control de inventarios - Regional Norte",
    descripcion: "Seguimiento al inventario de estibas, isotanques y estibas pl\xE1sticas",
    secciones: [
      {
        titulo: "Centro De Distribuci\xF3n",
        preguntas: [
          // En el Microsoft Form no es obligatoria, pero sin CD la respuesta no se puede ubicar.
          { id: "cd", titulo: "Seleccione el CD", corto: "CD", tipo: "lista", obligatoria: true, opciones: CDS_REGIONAL_NORTE }
        ]
      },
      {
        titulo: "Informaci\xF3n de estibas",
        descripcion: EN_UNIDADES,
        sumable: true,
        preguntas: [
          { id: "estibas_a", titulo: "Cantidad de estibas tipo A", corto: "Tipo A", obligatoria: true, ...UNIDADES },
          { id: "estibas_b", titulo: "Cantidad de estibas tipo B", corto: "Tipo B", obligatoria: true, ...UNIDADES },
          { id: "estibas_c", titulo: "Cantidad de estibas tipo C", corto: "Tipo C", obligatoria: true, ...UNIDADES }
        ]
      },
      {
        titulo: "Informaci\xF3n de HL bloqueados",
        descripcion: EN_UNIDADES,
        preguntas: [
          // Los hectolitros pueden tener decimales.
          { id: "hl_pendientes_verter", titulo: "Cantidad de HL pendientes por verter", corto: "HL pendientes por verter", tipo: "numero", obligatoria: true, minimo: 0 },
          { id: "isotanques_vacios", titulo: "Cantidad de isotanques vac\xEDos", corto: "Isotanques vac\xEDos", obligatoria: true, ...UNIDADES },
          { id: "isotanques_llenos", titulo: "Cantidad de isotanques llenos", corto: "Isotanques llenos", obligatoria: true, ...UNIDADES },
          { id: "necesidad_isotanques", titulo: "Necesidad de isotanques", obligatoria: true, ...UNIDADES }
        ]
      },
      {
        titulo: "Informaci\xF3n de estibas pl\xE1sticas",
        descripcion: EN_UNIDADES,
        sumable: true,
        preguntas: [
          { id: "cajas_330cc_x30", titulo: "Cantidad de estibas pl\xE1sticas 330cc x 30", corto: "330cc x 30", ...UNIDADES },
          { id: "cajas_750cc_x16", titulo: "Cantidad de estibas pl\xE1sticas 750cc x 16", corto: "750cc x 16", ...UNIDADES },
          { id: "cajas_1000cc_x13", titulo: "Cantidad de estibas pl\xE1sticas 1000cc x 13", corto: "1000cc x 13", ...UNIDADES },
          { id: "cajas_250cc_x38", titulo: "Cantidad de estibas pl\xE1sticas 250cc x 38", corto: "250cc x 38", ...UNIDADES },
          { id: "cajas_225cc_x38", titulo: "Cantidad de estibas pl\xE1sticas 225cc x 38", corto: "225cc x 38", ...UNIDADES }
        ]
      }
    ]
  }
];
var MAX_RESPUESTAS_LISTADO = 5e3;
var LIMITE_TEXTO = 500;
var LIMITE_PARRAFO = 4e3;
var buscarFormulario = (id) => FORMULARIOS.find((f) => f.id === id);
var preguntasDe = (formulario) => formulario.secciones.flatMap((s) => s.preguntas);
var invalida = (p) => new Error(`La respuesta de "${p.titulo}" no es v\xE1lida.`);
function normalizarValor(p, valor) {
  if (valor === void 0 || valor === null || typeof valor === "string" && !valor.trim()) {
    if (p.obligatoria) throw new Error(`Responde "${p.titulo}".`);
    return null;
  }
  switch (p.tipo) {
    case "texto":
    case "parrafo": {
      if (typeof valor !== "string") throw invalida(p);
      if (valor.trim().length > (p.tipo === "texto" ? LIMITE_TEXTO : LIMITE_PARRAFO)) throw new Error(`La respuesta de "${p.titulo}" es demasiado larga.`);
      return valor.trim();
    }
    case "numero": {
      const numero = typeof valor === "number" ? valor : typeof valor === "string" && /^-?\d+([.,]\d+)?$/.test(valor.trim()) ? Number(valor.trim().replace(",", ".")) : NaN;
      if (!Number.isFinite(numero) || Math.abs(numero) > 1e12) throw new Error(`"${p.titulo}": el valor debe ser un n\xFAmero.`);
      if (p.entero && !Number.isInteger(numero)) throw new Error(`"${p.titulo}": escribe un n\xFAmero entero.`);
      if (p.minimo !== void 0 && numero < p.minimo) throw new Error(`"${p.titulo}": el valor debe ser ${p.minimo} o m\xE1s.`);
      return numero;
    }
    case "fecha": {
      if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw invalida(p);
      const fecha = /* @__PURE__ */ new Date(`${valor}T00:00:00Z`);
      if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor) throw invalida(p);
      return valor;
    }
    case "lista":
    case "opcion":
      if (typeof valor !== "string" || !p.opciones?.includes(valor)) throw invalida(p);
      return valor;
  }
}
function normalizarRespuestas(formulario, datos) {
  if (!datos || typeof datos !== "object" || Array.isArray(datos)) throw new Error("Las respuestas no son v\xE1lidas.");
  const entrada = datos;
  return Object.fromEntries(preguntasDe(formulario).map((p) => [p.id, normalizarValor(p, entrada[p.id])]));
}

// src/server/formularios.ts
var TABLA_FALTANTE = "Falta crear la tabla de respuestas. Ejecuta supabase/formularios_schema.sql en Supabase.";
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function rutasFormularios(pool, sesion) {
  const router = express3.Router();
  router.use((req, res, next) => {
    if (!sesion(req)) {
      res.status(401).json({ error: "Inicia sesi\xF3n para abrir los formularios." });
      return;
    }
    if (req.method !== "GET" && req.get("sec-fetch-site") === "cross-site") {
      res.status(403).json({ error: "Abre la aplicaci\xF3n para guardar datos." });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const fallo = (res, error, accion, mensaje) => {
    if (error.code === "42P01") {
      res.status(503).json({ error: TABLA_FALTANTE });
      return;
    }
    console.error(`${accion} de formularios:`, error.message);
    res.status(503).json({ error: mensaje });
  };
  router.get("/respuestas", async (req, res) => {
    const formulario = buscarFormulario(req.query.formulario);
    if (!formulario) {
      res.status(404).json({ error: "El formulario no existe." });
      return;
    }
    if (!pool) {
      res.status(503).json({ error: "Configura la conexi\xF3n de Supabase para consultar las respuestas." });
      return;
    }
    try {
      const { rows } = await pool.query(
        `select id, usuario_nombre, creado_en, respuestas from public.formularios_respuestas
         where formulario = $1 order by creado_en desc, id desc limit ${MAX_RESPUESTAS_LISTADO + 1}`,
        [formulario.id]
      );
      res.json({ respuestas: rows.slice(0, MAX_RESPUESTAS_LISTADO), truncado: rows.length > MAX_RESPUESTAS_LISTADO });
    } catch (error) {
      fallo(res, error, "Consulta", "No se pudieron consultar las respuestas. Reintenta en un momento.");
    }
  });
  router.post("/respuestas", async (req, res) => {
    const formulario = buscarFormulario(req.body?.formulario);
    if (!formulario) {
      res.status(404).json({ error: "El formulario no existe." });
      return;
    }
    if (!pool) {
      res.status(503).json({ error: "Configura la conexi\xF3n de Supabase para guardar." });
      return;
    }
    let respuestas;
    try {
      respuestas = normalizarRespuestas(formulario, req.body?.respuestas);
    } catch (error) {
      res.status(400).json({ error: error.message });
      return;
    }
    const usuario = sesion(req);
    try {
      const { rows } = await pool.query(
        `insert into public.formularios_respuestas (formulario, respuestas, usuario_id, usuario_nombre)
         values ($1, $2, $3, $4) returning id, usuario_nombre, creado_en, respuestas`,
        [formulario.id, JSON.stringify(respuestas), usuario.sub, usuario.nombre]
      );
      res.status(201).json({ respuesta: rows[0] });
    } catch (error) {
      fallo(res, error, "Guardado", "No se pudo guardar la respuesta. Reintenta en un momento.");
    }
  });
  async function buscarRespuesta(req, res, db) {
    const id = req.params.id;
    if (typeof id !== "string" || !UUID.test(id)) {
      res.status(404).json({ error: "La respuesta no existe." });
      return null;
    }
    const { rows } = await db.query("select id, formulario from public.formularios_respuestas where id = $1", [id]);
    const fila = rows[0];
    if (!fila) {
      res.status(404).json({ error: "La respuesta ya no existe. Actualiza la tabla." });
      return null;
    }
    return fila;
  }
  router.put("/respuestas/:id", async (req, res) => {
    if (!pool) {
      res.status(503).json({ error: "Configura la conexi\xF3n de Supabase para guardar." });
      return;
    }
    try {
      const fila = await buscarRespuesta(req, res, pool);
      if (!fila) return;
      const formulario = buscarFormulario(fila.formulario);
      if (!formulario) {
        res.status(404).json({ error: "El formulario no existe." });
        return;
      }
      let respuestas;
      try {
        respuestas = normalizarRespuestas(formulario, req.body?.respuestas);
      } catch (error) {
        res.status(400).json({ error: error.message });
        return;
      }
      const { rows } = await pool.query(
        "update public.formularios_respuestas set respuestas = $2 where id = $1 returning id, usuario_nombre, creado_en, respuestas",
        [fila.id, JSON.stringify(respuestas)]
      );
      res.json({ respuesta: rows[0] });
    } catch (error) {
      fallo(res, error, "Edici\xF3n", "No se pudo guardar el cambio. Reintenta en un momento.");
    }
  });
  router.delete("/respuestas/:id", async (req, res) => {
    if (!pool) {
      res.status(503).json({ error: "Configura la conexi\xF3n de Supabase para eliminar." });
      return;
    }
    try {
      const fila = await buscarRespuesta(req, res, pool);
      if (!fila) return;
      await pool.query("delete from public.formularios_respuestas where id = $1", [fila.id]);
      res.status(204).end();
    } catch (error) {
      fallo(res, error, "Eliminaci\xF3n", "No se pudo eliminar la respuesta. Reintenta en un momento.");
    }
  });
  return router;
}

// src/server/solicitudes.ts
import express4 from "express";

// src/shared/solicitudes.ts
var ID_SOLICITUDES = "solicitudes-material";
var MAX_SOLICITUDES_LISTADO = 5e3;
var MAX_LOTE = 50;
var CENTROS_DESTINO = [
  { codigo: "AV10", cd: "Turbaco", solicitante: "Camilo Tatis" },
  { codigo: "AV11", cd: "Santa Marta", solicitante: "Victor Villa" },
  { codigo: "AV12", cd: "Valledupar", solicitante: "Eduardo Diaz" },
  { codigo: "AV13", cd: "Corozal", solicitante: "Jes\xFAs Alfonso Iriarte" },
  { codigo: "AV20", cd: "C\xFAcuta", solicitante: "Karen Paredes" },
  { codigo: "AV29", cd: "San Andr\xE9s", solicitante: "Laura Mu\xF1oz" },
  { codigo: "AV30", cd: "Riohacha", solicitante: "Jordin Virguez" },
  { codigo: "AV32", cd: "Magangu\xE9", solicitante: "Jes\xFAs Alfonso Iriarte" },
  { codigo: "AV36", cd: "Fonseca", solicitante: "Eduardo Diaz" },
  { codigo: "AV38", cd: "Curuman\xED", solicitante: "Eduardo Diaz" },
  { codigo: "AV39", cd: "Monter\xEDa", solicitante: "Jose Acosta" },
  { codigo: "AV40", cd: "Caucasia", solicitante: "Jose Acosta" },
  { codigo: "AV41", cd: "Apartad\xF3", solicitante: "Pedro Osorio" },
  { codigo: "AV74", cd: "La Arenosa", solicitante: "Piedad Santiago" },
  { codigo: "AV76", cd: "Galapa", solicitante: "Oscar Celis" }
];
var MATERIALES = {
  "401235": "TERMO PACK LTA 330/355/473 CAL 2.0X53 cm - 26 TN",
  "404234": "TERMO 24 PACK LATA 269 CAL 2,0 X 48cm - 95 TN",
  "414100": "BANDEJA CTON LTA 269X24 GENERICA LINEA",
  "407874": "BANDEJA CARTON KRAFT 24LTA 330/355 GENER",
  "404431": "PAD CARTON X 24 LATA 330/355 GENERICO",
  "404435": "PAD CARTON X 24 LATA 269",
  "400090": "PLASTICO SUPER STRECH CALIBRE 0.8 MILS",
  "400512": "PLASTICO STRECH CALIBRE 0.6 MILS",
  "414562": "CAJA TERC KRAFT 4X6P AGUILA 330NR MANUAL",
  "419470": "CAJA TERC KRAFT 4X6P CLUB COL 330NR MANU",
  "421509": "CANASTILLA CLUB COL 330 R NEW VBI",
  "414867": "CANASTILLA 6 BOTNR PONY EXP",
  "409190": "BANDEJA CRTON PONY MLTA 330NRX24 TXT LEG",
  "423932": "CANASTILLA 6 CLUB COL 330CC EXP USA",
  "423933": "CAJA CARTON CLUB COL 330 X24 USA NVBI",
  "421016": "CANASTILLA PONY MALTA 330cc X6P CH",
  "414695": "CAJA CARTON AGUILA LIG 330NR X 24 MAN CI",
  "423438": "CANASTILLA 6BOT 330NR CORONITA NL VALLE",
  "424357": "CAJA CARTON 4X6U BTA 330 CORONA ATL",
  "423431": "CANASTILLA 6BOT 210NR CORONITA NL VALLE",
  "424356": "CAJA CARTON 4X6U BTA 210 CORONITA ATL",
  "424453": "CAJA SIXPACK CORONA EXTRA LATA 269 ATL",
  "420369": "CAJA 24 PACK CORONA LATA 269",
  "424386": "CANASTILLA 6BOT 330ML MICHELOB ULTRA",
  "424606": "CAJA CTON 4X6 BTA 330 MICHELOB ULTRA ATL",
  "424608": "CAJA CTON 24 BTA 330 MICHELOB ULTRA ATL",
  "424804": "CAJA CTON 4X6U BTA 210 MICHELOB ULTRA",
  "424807": "CAJA CTON X24 LOOSP 210NR MICHELOB ULTRA",
  "424805": "CANASTILLA 6BOT 210ML MICHELOB ULTRA",
  "423430": "CANASTILLA 6BOT 210NR CORONITA WR NL TOC",
  "423760": "CAJA CTON 4X6U BTA 210 CORONITA AHORRO",
  "422776": "CANASTILLA WR 6BOT 330 CORONA CERO TOC",
  "424601": "CANASTILLA WR 6P 330 CORONA CERO TOC CI",
  "422750": "CAJA CTON 4X6U BTA 330 CORONA CERO TOC",
  "423759": "CANASTILLA 6BOT 330 CORONA VALLE AHORRO",
  "423437": "CANASTILLA 6BOT 330 CORONA VALLE AHORRO",
  "423758": "CAJA CTON 4X6U BTA 330 CORONA TOC AHORRO",
  "420367": "CAJA SIXPACK CORONA LATA 269",
  "409750": "BANDEJA KRAFT BUD 269 LTA 2PX12U",
  "424458": "CAJA CORONA CERO LTA 269 X6 ED FEP 26",
  "423536": "CAJA CORONA CERO LTA 269 X6 ED FEP 26",
  "424387": "CAJA CTON 4X6U BTA 330 MICHELOB ULTRA TO",
  "424388": "CAJA CTON X24U BTA 330 MICHELOB ULTRA TO (LOOSEPACK)",
  "404738": "SEPARADOR PET 106X128CM RECUBRIMIENTO"
};
var MAX_DESCRIPCION = 120;
var MAX_CANTIDAD = 1e9;
var limpiar = (v) => typeof v === "string" ? v.trim().replace(/\s+/g, " ") : typeof v === "number" ? String(v) : "";
var sinTildes = (v) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function buscarCentro(valor) {
  const texto = limpiar(valor);
  if (!texto) return void 0;
  const codigo = /^[a-z]{2}\d{2}\b/i.exec(texto)?.[0].toUpperCase();
  return CENTROS_DESTINO.find((c) => c.codigo === codigo) ?? CENTROS_DESTINO.find((c) => sinTildes(c.cd) === sinTildes(texto));
}
function codigoMaterial(valor) {
  const texto = limpiar(valor).toUpperCase();
  return /^[A-Z0-9-]{1,20}$/.test(texto) ? texto : "";
}
function leerCantidad(valor) {
  if (typeof valor === "number") return Number.isInteger(valor) && valor > 0 && valor <= MAX_CANTIDAD ? valor : null;
  const texto = limpiar(valor).replace(/\s/g, "");
  const digitos = /^\d{1,3}(\.\d{3})+$/.test(texto) ? texto.replace(/\./g, "") : texto;
  if (!/^\d{1,10}$/.test(digitos)) return null;
  const cantidad = Number(digitos);
  return cantidad > 0 && cantidad <= MAX_CANTIDAD ? cantidad : null;
}
function revisarSolicitud(datos) {
  const d = datos && typeof datos === "object" && !Array.isArray(datos) ? datos : {};
  const errores = {};
  const centro = buscarCentro(d.centro);
  const textoCentro = limpiar(d.centro);
  if (!centro) errores.centro = textoCentro ? `El centro "${textoCentro.slice(0, 30)}" no tiene solicitante asignado. Elige uno de la lista.` : "Elige o escribe el c\xF3digo del centro.";
  const material = codigoMaterial(d.material);
  if (!material) errores.material = limpiar(d.material) ? "El c\xF3digo de material solo lleva letras y n\xFAmeros." : "Escribe el c\xF3digo del material.";
  const descripcion = material && MATERIALES[material] || limpiar(d.descripcion).toUpperCase();
  if (material && !descripcion) errores.descripcion = "Es un material nuevo: escribe su descripci\xF3n.";
  else if (descripcion.length > MAX_DESCRIPCION) errores.descripcion = `La descripci\xF3n es muy larga (m\xE1ximo ${MAX_DESCRIPCION} caracteres).`;
  const cantidad = leerCantidad(d.cantidad);
  if (cantidad === null) errores.cantidad = limpiar(d.cantidad) ? "Escribe un n\xFAmero entero mayor que 0, sin comas." : "Escribe la cantidad.";
  if (!centro || !material || cantidad === null || Object.keys(errores).length) return { solicitud: null, errores };
  return { solicitud: { centro: centro.codigo, solicitante: centro.solicitante, material, descripcion, cantidad }, errores };
}

// src/server/solicitudes.ts
var TABLA_FALTANTE2 = "Falta crear la tabla de respuestas. Ejecuta supabase/formularios_schema.sql en Supabase.";
var UUID2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var COLUMNAS = "id, usuario_nombre, creado_en, respuestas";
function rutasSolicitudes(pool, sesion) {
  const router = express4.Router();
  router.use((req, res, next) => {
    if (!sesion(req)) {
      res.status(401).json({ error: "Inicia sesi\xF3n para abrir las solicitudes." });
      return;
    }
    if (req.method !== "GET" && req.get("sec-fetch-site") === "cross-site") {
      res.status(403).json({ error: "Abre la aplicaci\xF3n para guardar datos." });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const fallo = (res, error, accion, mensaje) => {
    if (error.code === "42P01") {
      res.status(503).json({ error: TABLA_FALTANTE2 });
      return;
    }
    console.error(`${accion} de solicitudes:`, error.message);
    res.status(503).json({ error: mensaje });
  };
  const leer = (req, res) => {
    const { solicitud, errores } = revisarSolicitud(req.body?.solicitud);
    if (!solicitud) {
      res.status(400).json({ error: Object.values(errores)[0] ?? "La solicitud no es v\xE1lida." });
      return null;
    }
    return solicitud;
  };
  const idValido = (req) => typeof req.params.id === "string" && UUID2.test(req.params.id);
  router.get("/", async (_req, res) => {
    if (!pool) {
      res.status(503).json({ error: "Configura la conexi\xF3n de Supabase para consultar las solicitudes." });
      return;
    }
    try {
      const { rows } = await pool.query(
        `select ${COLUMNAS} from public.formularios_respuestas
         where formulario = $1 order by creado_en desc, id desc limit ${MAX_SOLICITUDES_LISTADO + 1}`,
        [ID_SOLICITUDES]
      );
      res.json({ solicitudes: rows.slice(0, MAX_SOLICITUDES_LISTADO), truncado: rows.length > MAX_SOLICITUDES_LISTADO });
    } catch (error) {
      fallo(res, error, "Consulta", "No se pudieron consultar las solicitudes. Reintenta en un momento.");
    }
  });
  router.post("/", async (req, res) => {
    if (!pool) {
      res.status(503).json({ error: "Configura la conexi\xF3n de Supabase para guardar." });
      return;
    }
    const lista = req.body?.solicitudes;
    if (!Array.isArray(lista) || !lista.length || lista.length > MAX_LOTE) {
      res.status(400).json({ error: `Env\xEDa entre 1 y ${MAX_LOTE} art\xEDculos.` });
      return;
    }
    const solicitudes = [];
    for (const [i, datos] of lista.entries()) {
      const { solicitud, errores } = revisarSolicitud(datos);
      if (!solicitud) {
        res.status(400).json({ error: `Art\xEDculo ${i + 1}: ${Object.values(errores)[0] ?? "no es v\xE1lido."}` });
        return;
      }
      solicitudes.push(solicitud);
    }
    const usuario = sesion(req);
    try {
      const { rows } = await pool.query(
        `insert into public.formularios_respuestas (formulario, respuestas, usuario_id, usuario_nombre)
         select $1, x.valor, $3, $4 from jsonb_array_elements($2::jsonb) with ordinality as x(valor, n)
         order by x.n returning ${COLUMNAS}`,
        [ID_SOLICITUDES, JSON.stringify(solicitudes), usuario.sub, usuario.nombre]
      );
      res.status(201).json({ solicitudes: rows });
    } catch (error) {
      fallo(res, error, "Guardado", "No se pudo guardar la solicitud. Reintenta en un momento.");
    }
  });
  router.put("/:id", async (req, res) => {
    if (!pool) {
      res.status(503).json({ error: "Configura la conexi\xF3n de Supabase para guardar." });
      return;
    }
    if (!idValido(req)) {
      res.status(404).json({ error: "La solicitud no existe." });
      return;
    }
    const solicitud = leer(req, res);
    if (!solicitud) return;
    try {
      const { rows } = await pool.query(
        `update public.formularios_respuestas set respuestas = $3
         where id = $1 and formulario = $2 returning ${COLUMNAS}`,
        [req.params.id, ID_SOLICITUDES, JSON.stringify(solicitud)]
      );
      if (!rows[0]) {
        res.status(404).json({ error: "La solicitud ya no existe. Actualiza la tabla." });
        return;
      }
      res.json({ solicitud: rows[0] });
    } catch (error) {
      fallo(res, error, "Edici\xF3n", "No se pudo guardar el cambio. Reintenta en un momento.");
    }
  });
  router.delete("/:id", async (req, res) => {
    if (!pool) {
      res.status(503).json({ error: "Configura la conexi\xF3n de Supabase para eliminar." });
      return;
    }
    if (!idValido(req)) {
      res.status(404).json({ error: "La solicitud no existe." });
      return;
    }
    try {
      const { rowCount } = await pool.query("delete from public.formularios_respuestas where id = $1 and formulario = $2", [req.params.id, ID_SOLICITUDES]);
      if (!rowCount) {
        res.status(404).json({ error: "La solicitud ya no existe. Actualiza la tabla." });
        return;
      }
      res.status(204).end();
    } catch (error) {
      fallo(res, error, "Eliminaci\xF3n", "No se pudo eliminar la solicitud. Reintenta en un momento.");
    }
  });
  return router;
}

// src/server/cargas.ts
import express5 from "express";
import { gunzipSync } from "node:zlib";

// src/shared/t1.ts
var MAX_FILAS_T1 = 4e5;
var GERENCIAS = [
  { cdRodar: "Arenosa", cd: "La Arenosa", gerencia: "Barranquilla", lider: "Piedad Santiago", gerente: "Jairo Tovar", ol: "LIS", cdWip: "La Arenosa", cdFms: "La Arenosa" },
  { cdRodar: "Galapa", cd: "Galapa", gerencia: "Barranquilla", lider: "Victor Villa", gerente: "Jairo Tovar", ol: "ASL", cdWip: "Galapa", cdFms: "Galapa" },
  { cdRodar: "LA ARENOSA", cd: "La Arenosa", gerencia: "Barranquilla", lider: "Piedad Santiago", gerente: "Jairo Tovar", ol: "LIS", cdWip: "La Arenosa", cdFms: "La Arenosa" },
  { cdRodar: "CARTAGENA", cd: "Cartagena Ka", gerencia: "Cartagena", lider: "Adelfa Herrera", gerente: "Marlon Gonzales", ol: "CONALCA", cdWip: "Cartagena Ka", cdFms: "Cartagena Ka" },
  { cdRodar: "Cartagena Ka", cd: "Cartagena Ka", gerencia: "Cartagena", lider: "Adelfa Herrera", gerente: "Marlon Gonzales", ol: "CONALCA", cdWip: "Cartagena Ka", cdFms: "Cartagena Ka" },
  { cdRodar: "Turbaco", cd: "Turbaco", gerencia: "Cartagena", lider: "Adelfa Herrera", gerente: "Marlon Gonzales", ol: "CONALCA", cdWip: "Turbaco", cdFms: "Turbaco" },
  { cdRodar: "CUCUTA", cd: "Cucuta", gerencia: "Cucuta", lider: "Lizeth Martinez", gerente: "Karen Molina", ol: "LIS", cdWip: "Cucuta", cdFms: "C\xFAcuta" },
  { cdRodar: "C\xFAcuta", cd: "Cucuta", gerencia: "Cucuta", lider: "Lizeth Martinez", gerente: "Karen Molina", ol: "LIS", cdWip: "Cucuta", cdFms: "C\xFAcuta" },
  { cdRodar: "APARTADO", cd: "Apartado", gerencia: "Monteria", lider: "Pedro Osorio", gerente: "Gerson Vanegas", ol: "ASL", cdWip: "Apartado", cdFms: "Apartado" },
  { cdRodar: "Apartad\xF3", cd: "Apartado", gerencia: "Monteria", lider: "Pedro Osorio", gerente: "Gerson Vanegas", ol: "ASL", cdWip: "Apartado", cdFms: "Apartado" },
  { cdRodar: "CAUCASIA", cd: "Caucasia", gerencia: "Monteria", lider: "Jose Acosta", gerente: "Gerson Vanegas", ol: "ASL", cdWip: "Caucasia", cdFms: "Caucasia" },
  { cdRodar: "MONTERIA", cd: "Monteria", gerencia: "Monteria", lider: "Jose Acosta", gerente: "Gerson Vanegas", ol: "ASL", cdWip: "Monteria", cdFms: "Monteria" },
  { cdRodar: "Monter\xEDa", cd: "Monteria", gerencia: "Monteria", lider: "Jose Acosta", gerente: "Gerson Vanegas", ol: "ASL", cdWip: "Monteria", cdFms: "Monteria" },
  { cdRodar: "Riohacha", cd: "Riohacha", gerencia: "Santa Marta", lider: "Victor Villa", gerente: "Juan Vega", ol: "SEDIAL", cdWip: "Riohacha", cdFms: "Riohacha" },
  { cdRodar: "Santa Marta", cd: "Santa Marta", gerencia: "Santa Marta", lider: "Victor Villa", gerente: "Juan Vega", ol: "LIS", cdWip: "Santa Marta", cdFms: "Santa Marta" },
  { cdRodar: "Corozal", cd: "Corozal", gerencia: "Sincelejo", lider: "Alfonso Iriarte", gerente: "Snaider Polo", ol: "SEDIAL", cdWip: "Corozal", cdFms: "Corozal" },
  { cdRodar: "MAGANGUE", cd: "Magangue", gerencia: "Sincelejo", lider: "Liseth Pe\xF1a", gerente: "Snaider Polo", ol: "SEDIAL", cdWip: "Magangue", cdFms: "Magangu\xE9" },
  { cdRodar: "Magangu\xE9", cd: "Magangue", gerencia: "Sincelejo", lider: "Liseth Pe\xF1a", gerente: "Snaider Polo", ol: "SEDIAL", cdWip: "Magangue", cdFms: "Magangu\xE9" },
  { cdRodar: "CURUMANI", cd: "Curumani", gerencia: "Valledupar", lider: "Brayan Epalza", gerente: "Guadalupe Montero", ol: "SEDIAL", cdWip: "Curumani", cdFms: "Curumani" },
  { cdRodar: "Curuman\xED", cd: "Curumani", gerencia: "Valledupar", lider: "Brayan Epalza", gerente: "Guadalupe Montero", ol: "SEDIAL", cdWip: "Curumani", cdFms: "Curumani" },
  { cdRodar: "Fonseca", cd: "Fonseca", gerencia: "Valledupar", lider: "Eduardo Diaz", gerente: "Guadalupe Montero", ol: "SEDIAL", cdWip: "Fonseca", cdFms: "Fonseca" },
  { cdRodar: "Valledupar", cd: "Valledupar", gerencia: "Valledupar", lider: "Eduardo Diaz", gerente: "Guadalupe Montero", ol: "SEDIAL", cdWip: "Valledupar", cdFms: "Valledupar" },
  { cdRodar: "San Andres", cd: "San Andres", gerencia: "Cartagena", lider: "Laura Mu\xF1oz", gerente: "Marlon Gonzales", ol: "IM", cdWip: "San Andres", cdFms: "San Andres" },
  { cdRodar: "", cd: "UDC Torices", gerencia: "Cartagena", lider: "Sirith Avecedo", gerente: "Marlon Gonzales", ol: "PC", cdWip: "", cdFms: "UDC Torices" }
];
var clave = (v) => String(v ?? "").trim().toLocaleLowerCase("es");
var porRodar = new Map(GERENCIAS.filter((g) => g.cdRodar).map((g) => [clave(g.cdRodar), g]));
var porNombre = /* @__PURE__ */ new Map();
for (const g of GERENCIAS) if (!porNombre.has(clave(g.cd))) porNombre.set(clave(g.cd), g);
var EPOCA = Date.UTC(1899, 11, 30);
var fechaDeDia = (dia) => new Date(EPOCA + dia * 864e5);
var isoDeDia = (dia) => fechaDeDia(dia).toISOString().slice(0, 10);
function validarColumnas2(datos, tipo) {
  if (!datos || typeof datos !== "object") return "Los datos no son v\xE1lidos.";
  const d = datos;
  if (d.tipo !== tipo || d.version !== 1) return "El tipo de archivo no coincide.";
  const listas = tipo === "atct" ? { numeros: ["fecha", "placa", "ubicacion", "zona", "dias", "minutos"], textos: ["registro", "ingreso", "salida"], diccionarios: ["placas", "ubicaciones", "zonas"] } : { numeros: ["placa", "programada", "enturnamiento", "inicio", "fin", "ubi"], textos: ["espera", "atencion", "ftct"], diccionarios: ["placas", "ubis"] };
  const n = d[listas.numeros[0]]?.length ?? -1;
  if (n < 1 || n > MAX_FILAS_T1) return "La cantidad de filas no es v\xE1lida.";
  for (const k of listas.numeros) {
    const a = d[k];
    if (!Array.isArray(a) || a.length !== n || !a.every((v) => typeof v === "number" && Number.isFinite(v))) return `La columna ${k} no es v\xE1lida.`;
  }
  for (const k of listas.textos) {
    const a = d[k];
    if (!Array.isArray(a) || a.length !== n || !a.every((v) => typeof v === "string" && v.length <= 120)) return `La columna ${k} no es v\xE1lida.`;
  }
  for (const k of listas.diccionarios) {
    const a = d[k];
    if (!Array.isArray(a) || a.length > MAX_FILAS_T1 || !a.every((v) => typeof v === "string" && v.length <= 120)) return `La lista ${k} no es v\xE1lida.`;
  }
  const rango = (col, dic) => {
    const max = d[dic].length;
    return d[col].every((i) => Number.isInteger(i) && i >= 0 && i < max);
  };
  const ok = tipo === "atct" ? rango("placa", "placas") && rango("ubicacion", "ubicaciones") && rango("zona", "zonas") && d.minutos.every((m) => m >= 0 && m < 1440) : rango("placa", "placas") && rango("ubi", "ubis");
  return ok ? null : "Hay \xEDndices fuera de rango.";
}
var orden = new Intl.Collator("es", { numeric: true }).compare;

// src/server/cargas.ts
var TABLA_FALTANTE3 = "Falta crear la tabla de cargas. Ejecuta supabase/t1_schema.sql en Supabase.";
var CONSERVAR = 5;
var LIMITE_CUERPO = "8mb";
var LIMITE_DESCOMPRIMIDO = 80 * 1024 * 1024;
function rutasCargas(pool, sesion, modulo, tipos) {
  const nombres = Object.keys(tipos);
  const router = express5.Router();
  router.use((req, res, next) => {
    if (!sesion(req)) {
      res.status(401).json({ error: `Inicia sesi\xF3n para abrir ${modulo}.` });
      return;
    }
    if (req.method !== "GET" && req.get("sec-fetch-site") === "cross-site") {
      res.status(403).json({ error: "Abre la aplicaci\xF3n para guardar datos." });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const fallo = (res, error, accion, mensaje) => {
    if (error.code === "42P01") {
      res.status(503).json({ error: TABLA_FALTANTE3 });
      return;
    }
    console.error(`${accion} de ${modulo}:`, error.message);
    res.status(503).json({ error: mensaje });
  };
  const tipoDe = (req) => nombres.includes(String(req.params.tipo)) ? String(req.params.tipo) : null;
  const memoria = /* @__PURE__ */ new Map();
  const datosDe = (db, tipo, id) => {
    const guardado = memoria.get(tipo);
    if (guardado?.id === id) return guardado.datos;
    const datos = db.query("select encode(datos, 'base64') as datos from public.t1_cargas where id = $1", [id]).then(({ rows }) => {
      if (!rows[0]) throw new Error("La carga ya no existe.");
      return Buffer.from(String(rows[0].datos).replace(/\s/g, ""), "base64");
    });
    memoria.set(tipo, { id, datos });
    datos.catch(() => {
      if (memoria.get(tipo)?.datos === datos) memoria.delete(tipo);
    });
    return datos;
  };
  router.get("/estado", async (_req, res) => {
    if (!pool) {
      res.status(503).json({ error: `Configura la conexi\xF3n de Supabase para consultar ${modulo}.` });
      return;
    }
    try {
      const { rows } = await pool.query(
        `select distinct on (tipo) id, tipo, archivo, filas, to_char(desde, 'YYYY-MM-DD') as desde, to_char(hasta, 'YYYY-MM-DD') as hasta, usuario_nombre, creado_en
         from public.t1_cargas where tipo = any($1) order by tipo, creado_en desc, id desc`,
        [nombres]
      );
      for (const r of rows) datosDe(pool, r.tipo, String(r.id)).catch(() => void 0);
      res.json(Object.fromEntries(nombres.map((t) => [t, rows.find((r) => r.tipo === t) ?? null])));
    } catch (error) {
      fallo(res, error, "Consulta", `No se pudo consultar ${modulo}. Reintenta en un momento.`);
    }
  });
  router.get("/datos/:tipo", async (req, res) => {
    const tipo = tipoDe(req);
    if (!tipo) {
      res.status(404).json({ error: "Tipo de datos desconocido." });
      return;
    }
    if (!pool) {
      res.status(503).json({ error: `Configura la conexi\xF3n de Supabase para consultar ${modulo}.` });
      return;
    }
    try {
      const { rows } = await pool.query("select id from public.t1_cargas where tipo = $1 order by creado_en desc, id desc limit 1", [tipo]);
      if (!rows[0]) {
        res.status(404).json({ error: "A\xFAn no se ha cargado ese archivo." });
        return;
      }
      const datos = await datosDe(pool, tipo, String(rows[0].id));
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Encoding", "gzip");
      res.send(datos);
    } catch (error) {
      fallo(res, error, "Consulta", `No se pudieron consultar los datos de ${modulo}.`);
    }
  });
  router.post("/cargar/:tipo", express5.raw({ type: "application/octet-stream", limit: LIMITE_CUERPO }), async (req, res) => {
    const tipo = tipoDe(req);
    if (!tipo) {
      res.status(404).json({ error: "Tipo de datos desconocido." });
      return;
    }
    if (!pool) {
      res.status(503).json({ error: "Configura la conexi\xF3n de Supabase para guardar." });
      return;
    }
    const archivo = decodeURIComponent(String(req.get("x-archivo") ?? req.get("x-t1-archivo") ?? "")).trim().slice(0, 180);
    if (!archivo || !Buffer.isBuffer(req.body) || !req.body.length) {
      res.status(400).json({ error: "Falta el archivo." });
      return;
    }
    let columnas;
    try {
      columnas = JSON.parse(gunzipSync(req.body, { maxOutputLength: LIMITE_DESCOMPRIMIDO }).toString("utf8"));
    } catch {
      res.status(400).json({ error: "El archivo lleg\xF3 da\xF1ado o es demasiado grande. Int\xE9ntalo de nuevo." });
      return;
    }
    const problema = tipos[tipo].validar(columnas);
    if (problema) {
      res.status(400).json({ error: problema });
      return;
    }
    const dias = tipos[tipo].dias(columnas);
    let desde = Infinity, hasta = -Infinity;
    for (const d of dias) {
      if (d < desde) desde = d;
      if (d > hasta) hasta = d;
    }
    const usuario = sesion(req);
    let client;
    try {
      client = await pool.connect();
    } catch {
      res.status(503).json({ error: "No se pudo conectar a Supabase. Reintenta en un momento." });
      return;
    }
    try {
      await client.query("begin");
      const { rows } = await client.query(
        `insert into public.t1_cargas (tipo, archivo, filas, desde, hasta, datos, usuario_id, usuario_nombre)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, creado_en`,
        [tipo, archivo, dias.length, isoDeDia(desde), isoDeDia(hasta), req.body, usuario.sub, usuario.nombre]
      );
      await client.query(
        `delete from public.t1_cargas where tipo = $1 and id not in
         (select id from public.t1_cargas where tipo = $1 order by creado_en desc, id desc limit ${CONSERVAR})`,
        [tipo]
      );
      await client.query("commit");
      memoria.set(tipo, { id: String(rows[0].id), datos: Promise.resolve(req.body) });
      res.status(201).json({ tipo, archivo, filas: dias.length, desde: isoDeDia(desde), hasta: isoDeDia(hasta), creado_en: rows[0].creado_en });
    } catch (error) {
      await client.query("rollback").catch(() => void 0);
      fallo(res, error, "Guardado", "No se pudo guardar el archivo. No se aplic\xF3 la carga; reintenta.");
    } finally {
      client.release();
    }
  });
  return router;
}

// src/server/montacargas.ts
import express6 from "express";

// src/shared/montacargas.ts
var MONTACARGAS = [
  { cod: "AV74", cd: "La Arenosa", placa: "328", configuracion: "Doble Horquilla", chasis: "308FGJ35-35321", motor: "2510599", tipo: "8FGJ35", combustible: "GLP", alquilado: "Bavaria", contrato: "Leasing" },
  { cod: "AV41", cd: "Apartado", placa: "569", configuracion: "Doble Horquilla", chasis: "308FGJ35-68104", motor: "2750440", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Bavaria", contrato: "Leasing" },
  { cod: "AV76", cd: "Galapa", placa: "571", configuracion: "Doble Horquilla", chasis: "308FGJ35-68176", motor: "2771484", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Bavaria", contrato: "Propio" },
  { cod: "AV76", cd: "Galapa", placa: "572", configuracion: "Doble Horquilla", chasis: "308FGJ35-68190", motor: "2771638", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Bavaria", contrato: "Renta" },
  { cod: "AV30", cd: "Riohacha", placa: "573", configuracion: "Doble Horquilla", chasis: "308FGJ35-68204", motor: "2771692", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Bavaria", contrato: "Renta" },
  { cod: "AV32", cd: "Magangu\xE9", placa: "612", configuracion: "Doble Horquilla", chasis: "308FGJ35-80916", motor: "2807784", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Spot(VLC)" },
  { cod: "AV32", cd: "Magangu\xE9", placa: "613", configuracion: "Doble Horquilla", chasis: "308FGJ35-80921", motor: "2807916", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV20", cd: "C\xFAcuta", placa: "640", configuracion: "Doble Horquilla", chasis: "308FGJ35-80859", motor: "2806291", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Renta" },
  { cod: "AV13", cd: "Corozal", placa: "651", configuracion: "Doble Horquilla", chasis: "308FGJ35-92324", motor: "2842438", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV13", cd: "Corozal", placa: "652", configuracion: "Doble Horquilla", chasis: "308FGJ35-92348", motor: "2842898", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV13", cd: "Corozal", placa: "653", configuracion: "Doble Horquilla", chasis: "308FGJ35-92362", motor: "2843117", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV10", cd: "Turbaco", placa: "654", configuracion: "Doble Horquilla", chasis: "308FGJ35-92395", motor: "2843782", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Renta" },
  { cod: "AV10", cd: "Turbaco", placa: "655", configuracion: "Doble Horquilla", chasis: "308FGJ35-92435", motor: "2844480", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Renta" },
  { cod: "AV11", cd: "Santa Marta", placa: "656", configuracion: "Doble Horquilla", chasis: "308FGJ35-92465", motor: "2845043", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Renta" },
  { cod: "AV11", cd: "Santa Marta", placa: "657", configuracion: "Doble Horquilla", chasis: "308FGJ35-92497", motor: "2845500", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Renta" },
  { cod: "AV11", cd: "Santa Marta", placa: "658", configuracion: "Doble Horquilla", chasis: "308FGJ35-92506", motor: "2845594", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Renta" },
  { cod: "AV30", cd: "Riohacha", placa: "659", configuracion: "Doble Horquilla", chasis: "308FGJ35-92553", motor: "2846422", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV30", cd: "Riohacha", placa: "660", configuracion: "Doble Horquilla", chasis: "308FGJ35-92563", motor: "2846527", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Renta" },
  { cod: "AV39", cd: "Monteria", placa: "661", configuracion: "Doble Horquilla", chasis: "308FGJ35-93738", motor: "2871067", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV39", cd: "Monteria", placa: "662", configuracion: "Doble Horquilla", chasis: "308FGJ35-93736", motor: "2871035", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV41", cd: "Apartado", placa: "663", configuracion: "Doble Horquilla", chasis: "308FGJ35-93730", motor: "2870924", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV10", cd: "Turbaco", placa: "686", configuracion: "Doble Horquilla", chasis: "308FGJ35-93827", motor: "2872434", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV20", cd: "C\xFAcuta", placa: "687", configuracion: "Doble Horquilla", chasis: "308FGJ35-93817", motor: "2872329", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Back up" },
  { cod: "AV74", cd: "La Arenosa", placa: "688", configuracion: "Doble Horquilla", chasis: "308FGJ35-93814", motor: "2872221", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV20", cd: "C\xFAcuta", placa: "748", configuracion: "Doble Horquilla", chasis: "308FGJ35-95344", motor: "2902554", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV10", cd: "Turbaco", placa: "749", configuracion: "Doble Horquilla", chasis: "308FGJ35-95346", motor: "2902575", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Propio" },
  { cod: "AV48", cd: "Turbaco", placa: "750", configuracion: "Doble Horquilla", chasis: "308FGJ35-95347", motor: "2902584", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV74", cd: "La Arenosa", placa: "752", configuracion: "Doble Horquilla", chasis: "308FGJ35-95354", motor: "2902861", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV20", cd: "C\xFAcuta", placa: "754", configuracion: "Doble Horquilla", chasis: "308FGJ35-95361", motor: "2902917", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV10", cd: "Turbaco", placa: "758", configuracion: "Doble Horquilla", chasis: "308FGJ35-95376", motor: "2903305", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Renta" },
  { cod: "AV20", cd: "C\xFAcuta", placa: "759", configuracion: "Doble Horquilla", chasis: "308FGJ35-95382", motor: "2903579", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV20", cd: "C\xFAcuta", placa: "760", configuracion: "Doble Horquilla", chasis: "308FGJ35-95391", motor: "2903482", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV10", cd: "Turbaco", placa: "762", configuracion: "Doble Horquilla", chasis: "308FGJ35-95401", motor: "2903991", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Renta" },
  { cod: "AV10", cd: "Turbaco", placa: "763", configuracion: "Doble Horquilla", chasis: "308FGJ35-95403", motor: "2903675", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Spot(VLC)" },
  { cod: "AV10", cd: "Turbaco", placa: "767", configuracion: "Doble Horquilla", chasis: "308FGJ35-95420", motor: "2904028", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Propio" },
  { cod: "AV36", cd: "Fonseca", placa: "785", configuracion: "Doble Horquilla", chasis: "308FGJ35-97009", motor: "2933924", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV40", cd: "Caucasia", placa: "800", configuracion: "Doble Horquilla", chasis: "308FGJ35-97107", motor: "2934685", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Renta" },
  { cod: "AV76", cd: "Galapa", placa: "801", configuracion: "Doble Horquilla", chasis: "308FGJ35-97105", motor: "2934669", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Renta" },
  { cod: "AV12", cd: "Valledupar", placa: "805", configuracion: "Doble Horquilla", chasis: "308FGJ35-97124", motor: "2934861", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Renta" },
  { cod: "AV38", cd: "Curumani", placa: "807", configuracion: "Doble Horquilla", chasis: "308FGJ35-97128", motor: "2934874", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV11", cd: "Santa Marta", placa: "808", configuracion: "Doble Horquilla", chasis: "308FGJ35-97136", motor: "2934982", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Renta" },
  { cod: "AV12", cd: "Valledupar", placa: "810", configuracion: "Doble Horquilla", chasis: "308FGJ35-97145", motor: "2935021", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Renta" },
  { cod: "AV39", cd: "Monteria", placa: "831", configuracion: "Doble Horquilla", chasis: "308FGJ35-93135", motor: "2858732", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV12", cd: "Valledupar", placa: "834", configuracion: "Doble Horquilla", chasis: "308FGJ35-97152", motor: "2935067", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Renta" },
  { cod: "AV40", cd: "Caucasia", placa: "835", configuracion: "Doble Horquilla", chasis: "308FGJ35-97169", motor: "2935248", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV39", cd: "Monteria", placa: "837", configuracion: "Doble Horquilla", chasis: "308FGJ35-93117", motor: "2858248", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV76", cd: "Galapa", placa: "858", configuracion: "Doble Horquilla", chasis: "308FGJ35-99750", motor: "2958721", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV76", cd: "Galapa", placa: "861", configuracion: "Doble Horquilla", chasis: "308FGJ35-99782", motor: "2959135", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Renta" },
  { cod: "AV76", cd: "Galapa", placa: "865", configuracion: "Doble Horquilla", chasis: "308FGJ35-99761", motor: "2958991", tipo: "32-8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Spot(VLC)" },
  { cod: "AV39", cd: "Monteria", placa: "892", configuracion: "Doble Horquilla", chasis: "308FGJ35-A0499", motor: "4Y*2967494", tipo: "8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV32", cd: "Corozal", placa: "CP21", configuracion: "Doble Horquilla", chasis: "328FGJ35-93398", motor: "4Y*2866221", tipo: "8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Propio" },
  { cod: "AV76", cd: "Galapa", placa: "CP3", configuracion: "Doble Horquilla", chasis: "308FGJ35-92736", motor: "4Y*2849694", tipo: "8FGJ35", combustible: "GLP", alquilado: "Distoyota", contrato: "Renta" },
  { cod: "AV74", cd: "La Arenosa", placa: "MC7", configuracion: "Doble Horquilla", chasis: "8FBJ35-16220", motor: "AT06209", tipo: "8FBJ35", combustible: "ELECTRICO", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV74", cd: "La Arenosa", placa: "MC8", configuracion: "Doble Horquilla", chasis: "8FBJ35-16120", motor: "AT06209", tipo: "8FBJ35", combustible: "ELECTRICO", alquilado: "Distoyota", contrato: "Leasing" },
  { cod: "AV29", cd: "San Andres", placa: "SAI01", configuracion: "Sencillo", chasis: "", motor: "", tipo: "123", combustible: "GLP", alquilado: "", contrato: "" },
  { cod: "AV29", cd: "San Andres", placa: "SAI1", configuracion: "Sencillo", chasis: "FGZN30-40319", motor: "4Y2938383", tipo: "FGZN30", combustible: "GLP", alquilado: "SLA", contrato: "Renta" },
  { cod: "AV69", cd: "UDC Torices", placa: "UC10", configuracion: "Sencillo", chasis: "8FBE20-58482", motor: "FF31739", tipo: "8FBE20", combustible: "ELECTRICO", alquilado: "Distoyota", contrato: "Propio" }
];

// src/shared/ofe.ts
var MAX_FILAS_FMS = 2e5;
var clave2 = (v) => String(v ?? "").trim().toLocaleLowerCase("es");
var porChasisBase = new Map(MONTACARGAS.map((m) => [clave2(m.chasis), m]));
var porCdFms = /* @__PURE__ */ new Map();
for (const g of GERENCIAS) if (g.cdFms && !porCdFms.has(clave2(g.cdFms))) porCdFms.set(clave2(g.cdFms), g);
var claveChasis = (chasis) => clave2(chasis);
var CDS_FMS = [...porCdFms.values()].map((g) => g.cdFms).sort(new Intl.Collator("es").compare);
function revisarMontacargas(datos) {
  const d = datos ?? {};
  const chasis = typeof d.chasis === "string" ? d.chasis.trim() : "";
  const placa = typeof d.placa === "string" ? d.placa.trim() : "";
  const cd = typeof d.cd === "string" ? CDS_FMS.find((x) => clave2(x) === clave2(d.cd)) : void 0;
  if (chasis.length < 3 || chasis.length > 60 || !/^[\p{L}\p{N}][\p{L}\p{N} ._/-]*$/u.test(chasis)) return { error: "Escribe el n\xFAmero de chasis tal como sale en Data FMS (columna Forklift)." };
  if (!cd) return { error: "Elige el CD del montacargas." };
  if (!placa || placa.length > 20 || /[<>]/.test(placa)) return { error: "Escribe la placa o n\xFAmero de m\xE1quina (m\xE1ximo 20 caracteres)." };
  return { montacargas: { chasis, cd, placa } };
}
function validarColumnasFms(datos) {
  const d = datos;
  if (!d || d.tipo !== "fms" || d.version !== 1) return "El tipo de archivo no coincide.";
  const n = d.fecha?.length ?? 0;
  const numeros = (a, vacios = false) => Array.isArray(a) && a.length === n && a.every((v) => vacios && v === null || typeof v === "number" && Number.isFinite(v));
  if (n < 1 || n > MAX_FILAS_FMS || !numeros(d.fecha) || !numeros(d.forklift) || !numeros(d.ralenti, true) || !numeros(d.carga, true) || !numeros(d.movimiento, true)) return "Las columnas no son v\xE1lidas.";
  if (!Array.isArray(d.turno) || d.turno.length !== n || !d.turno.every((t) => typeof t === "string" && t.length <= 20)) return "La columna Turno no es v\xE1lida.";
  if (!Array.isArray(d.forklifts) || !d.forklifts.every((v) => typeof v === "string" && v.length <= 120)) return "La lista de montacargas no es v\xE1lida.";
  if (!d.forklift.every((i) => Number.isInteger(i) && i >= 0 && i < d.forklifts.length)) return "Hay valores fuera de rango.";
  return null;
}
var orden2 = new Intl.Collator("es", { numeric: true }).compare;

// src/server/montacargas.ts
var TABLA_FALTANTE4 = "Falta crear la tabla de montacargas. Ejecuta supabase/t1_schema.sql en Supabase.";
var MAX_CAMBIOS = 1e3;
function rutasMontacargas(pool, sesion) {
  const router = express6.Router();
  const fallo = (res, error, mensaje) => {
    if (error.code === "42P01") {
      res.status(503).json({ error: TABLA_FALTANTE4 });
      return;
    }
    console.error("Montacargas de OFE:", error.message);
    res.status(503).json({ error: mensaje });
  };
  const sinBase = (res) => {
    res.status(503).json({ error: "Configura la conexi\xF3n de Supabase para la lista de montacargas." });
  };
  router.get("/", async (_req, res) => {
    if (!pool) {
      sinBase(res);
      return;
    }
    try {
      const { rows } = await pool.query(
        `select chasis, cd, placa, usuario_nombre, actualizado_en from public.ofe_montacargas order by actualizado_en desc limit ${MAX_CAMBIOS}`
      );
      res.json({ cambios: rows });
    } catch (error) {
      fallo(res, error, "No se pudo consultar la lista de montacargas. Reintenta en un momento.");
    }
  });
  router.put("/", async (req, res) => {
    if (!pool) {
      sinBase(res);
      return;
    }
    const revision = revisarMontacargas(req.body);
    if ("error" in revision) {
      res.status(400).json({ error: revision.error });
      return;
    }
    const { chasis, cd, placa } = revision.montacargas;
    const usuario = sesion(req);
    try {
      const { rows } = await pool.query(
        `insert into public.ofe_montacargas (clave, chasis, cd, placa, usuario_id, usuario_nombre) values ($1, $2, $3, $4, $5, $6)
         on conflict (clave) do update set chasis = excluded.chasis, cd = excluded.cd, placa = excluded.placa,
           usuario_id = excluded.usuario_id, usuario_nombre = excluded.usuario_nombre, actualizado_en = now()
         returning chasis, cd, placa, usuario_nombre, actualizado_en`,
        [claveChasis(chasis), chasis, cd, placa, usuario.sub, usuario.nombre]
      );
      res.json({ cambio: rows[0] });
    } catch (error) {
      fallo(res, error, "No se pudo guardar el montacargas. Reintenta en un momento.");
    }
  });
  router.delete("/", async (req, res) => {
    if (!pool) {
      sinBase(res);
      return;
    }
    const chasis = typeof req.query.chasis === "string" ? req.query.chasis : "";
    if (!chasis.trim() || chasis.length > 60) {
      res.status(400).json({ error: "Falta el n\xFAmero de chasis." });
      return;
    }
    try {
      const { rowCount } = await pool.query("delete from public.ofe_montacargas where clave = $1", [claveChasis(chasis)]);
      if (!rowCount) {
        res.status(404).json({ error: "Ese montacargas no tiene cambios guardados." });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      fallo(res, error, "No se pudo quitar el montacargas. Reintenta en un momento.");
    }
  });
  return router;
}

// src/shared/wip.ts
var COLUMNAS_WIP = ["Fecha", "CD", "0. Pendiente", "1. En Pausa", "2. Liberado", "3. Asignado", "4. Armado", "5. En verificaci\xF3n", "6. Verificados", "7. En Cargue", "8. Finalizado", "Total DTs"];
var ESTADOS_WIP = COLUMNAS_WIP.slice(2, 11);
var MAX_FILAS_WIP = 1e5;
var clave3 = (v) => String(v ?? "").trim().toLocaleLowerCase("es");
var porCdWip = /* @__PURE__ */ new Map();
for (const g of GERENCIAS) if (g.cdWip && !porCdWip.has(clave3(g.cdWip))) porCdWip.set(clave3(g.cdWip), g);
function validarColumnasWip(datos) {
  const d = datos;
  if (!d || d.tipo !== "wip" || d.version !== 1) return "El tipo de archivo no coincide.";
  const n = d.fecha?.length ?? 0;
  const numeros = (a, largo = n) => Array.isArray(a) && a.length === largo && a.every((v) => typeof v === "number" && Number.isFinite(v));
  if (n < 1 || n > MAX_FILAS_WIP || !numeros(d.fecha) || !numeros(d.cd) || !numeros(d.total)) return "Las columnas no son v\xE1lidas.";
  if (!Array.isArray(d.cds) || !d.cds.every((v) => typeof v === "string" && v.length <= 120)) return "La lista de CD no es v\xE1lida.";
  if (!Array.isArray(d.estados) || d.estados.length !== ESTADOS_WIP.length || !d.estados.every((e) => Array.isArray(e) && e.length === n && e.every((v) => v === null || typeof v === "number" && Number.isFinite(v)))) return "Los estados no son v\xE1lidos.";
  if (!d.cd.every((i) => Number.isInteger(i) && i >= 0 && i < d.cds.length) || !d.total.every((t) => t > 0)) return "Hay valores fuera de rango.";
  return null;
}
var orden3 = new Intl.Collator("es").compare;

// src/server/t1.ts
var rutasT1 = (pool, sesion) => rutasCargas(pool, sesion, "Seguimiento T1", {
  atct: { validar: (d) => validarColumnas2(d, "atct"), dias: (d) => d.fecha },
  espera: { validar: (d) => validarColumnas2(d, "espera"), dias: (d) => d.enturnamiento.map((s) => Math.floor(s / 86400)) }
});
var rutasWip = (pool, sesion) => rutasCargas(pool, sesion, "Seguimiento WIP", {
  wip: { validar: validarColumnasWip, dias: (d) => d.fecha }
});
var rutasOfe = (pool, sesion) => {
  const router = rutasCargas(pool, sesion, "OFE", {
    fms: { validar: validarColumnasFms, dias: (d) => d.fecha }
  });
  router.use("/montacargas", rutasMontacargas(pool, sesion));
  return router;
};

// server.ts
var { SUPABASE_URL = "", SUPABASE_PUBLISHABLE_KEY = "", JWT_SECRET = "", PORT = "3001" } = process.env;
var variablesFaltantes = Object.entries({ SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, JWT_SECRET }).filter(([, valor]) => !valor.trim()).map(([nombre]) => nombre);
if (variablesFaltantes.length) {
  console.error(`Faltan variables de autenticaci\xF3n: ${variablesFaltantes.join(", ")}. Config\xFAralas en el entorno del servidor.`);
}
var clienteSupabase = () => createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
var COOKIE = "sesion";
var DURACION_SESION = 8 * 60 * 60 * 1e3;
var isProd = process.env.NODE_ENV === "production";
var app = express7();
app.use("/api/excel", express7.json({ limit: "2mb" }));
app.use("/api/preventas", express7.json({ limit: "20mb" }));
app.use(express7.json());
app.use(cookieParser());
app.use("/api", (_req, res, next) => {
  if (variablesFaltantes.length) {
    res.status(503).json({
      error: "El inicio de sesi\xF3n no est\xE1 disponible. Contacta con el administrador.",
      code: "AUTH_NOT_CONFIGURED",
      variablesFaltantes
    });
    return;
  }
  next();
});
var leerSesion = (req) => {
  if (variablesFaltantes.length) return null;
  const token = req.cookies[COOKIE];
  if (typeof token !== "string") return null;
  try {
    const datos = jwt.verify(token, JWT_SECRET);
    return typeof datos === "object" ? datos : null;
  } catch {
    return null;
  }
};
app.get("/", (req, res) => {
  if (leerSesion(req)) {
    res.redirect("/modulos");
    return;
  }
  res.sendFile(path.join(import.meta.dirname, "public", "index.html"));
});
app.use(express7.static(path.join(import.meta.dirname, "public")));
var limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1e3,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera unos minutos e int\xE9ntalo de nuevo." }
});
var ERRORES_AUTH = {
  invalid_credentials: [401, "Correo o contrase\xF1a incorrectos."],
  email_not_confirmed: [403, "Tu correo a\xFAn no est\xE1 confirmado. Contacta con el administrador."],
  user_banned: [403, "Tu usuario est\xE1 desactivado. Contacta con el administrador."],
  over_request_rate_limit: [429, "Demasiados intentos. Espera unos minutos e int\xE9ntalo de nuevo."]
};
app.post("/api/login", limiteLogin, async (req, res) => {
  const correo = String(req.body?.correo ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  if (!correo || !password) {
    res.status(400).json({ error: "Escribe tu correo y contrase\xF1a." });
    return;
  }
  const { data, error } = await clienteSupabase().auth.signInWithPassword({ email: correo, password });
  if (error) {
    const conocido = error.code ? ERRORES_AUTH[error.code] : void 0;
    if (conocido) {
      res.status(conocido[0]).json({ error: conocido[1] });
      return;
    }
    console.error("Error de Supabase Auth:", error.code, error.message);
    res.status(500).json({ error: "No se pudo iniciar sesi\xF3n. Int\xE9ntalo m\xE1s tarde." });
    return;
  }
  const { user } = data;
  const email = user.email ?? correo;
  const nombre = user.user_metadata?.nombre || email.split("@")[0];
  const rol = user.app_metadata?.rol || "sin rol";
  const sesion = { sub: user.id, correo: email, nombre, rol };
  const token = jwt.sign(sesion, JWT_SECRET, { expiresIn: DURACION_SESION / 1e3 });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: DURACION_SESION
  });
  res.json({ nombre });
});
app.post("/api/logout", (req, res) => {
  res.clearCookie(COOKIE);
  res.status(204).end();
});
app.get("/api/me", (req, res) => {
  const sesion = leerSesion(req);
  if (!sesion) {
    res.status(401).json({ error: "No has iniciado sesi\xF3n." });
    return;
  }
  res.json({ correo: sesion.correo, nombre: sesion.nombre, rol: sesion.rol });
});
var dbFrescura = process.env.SUPABASE_DB_URL ? new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 3, connectionTimeoutMillis: 15e3 }) : null;
app.use("/api/preventas", rutasPreventas(dbFrescura, leerSesion));
app.use("/api/formularios", rutasFormularios(dbFrescura, leerSesion));
app.use("/api/solicitudes", rutasSolicitudes(dbFrescura, leerSesion));
app.use("/api/t1", rutasT1(dbFrescura, leerSesion));
app.use("/api/wip", rutasWip(dbFrescura, leerSesion));
app.use("/api/ofe", rutasOfe(dbFrescura, leerSesion));
app.get("/api/frescura/indice.json", async (req, res) => {
  if (!leerSesion(req)) {
    res.status(401).json({ error: "No has iniciado sesi\xF3n." });
    return;
  }
  if (!dbFrescura) {
    res.status(503).json({ error: "Falta configurar la conexi\xF3n a la base de datos." });
    return;
  }
  try {
    const resultado = await dbFrescura.query(
      "select id, nombre, rango_excel from public.frescura_hojas order by id"
    );
    if (!resultado.rows.length) {
      res.status(404).json({ error: "No hay hojas importadas en el informe." });
      return;
    }
    const sheets = resultado.rows.map((hoja) => {
      const rango = XLSX.utils.decode_range(hoja.rango_excel || "A1:A1");
      return {
        id: hoja.id,
        name: hoja.nombre,
        startRow: rango.s.r + 1,
        startColumn: rango.s.c,
        rows: rango.e.r - rango.s.r + 1,
        columns: rango.e.c - rango.s.c + 1
      };
    });
    const lote = await dbFrescura.query("select id from public.frescura_consolidado_lotes order by cargado_en desc limit 1");
    res.json({ sheets, filtrosRecientes: String(lote.rows[0]?.id ?? "").startsWith("web-") });
  } catch (error) {
    console.error("Error consultando el cat\xE1logo de hojas:", error instanceof Error ? error.message : "error desconocido");
    res.status(500).json({ error: "No se pudo consultar el cat\xE1logo del informe." });
  }
});
app.get("/api/frescura/:archivo", async (req, res) => {
  if (!leerSesion(req)) {
    res.status(401).json({ error: "No has iniciado sesi\xF3n." });
    return;
  }
  const archivo = req.params.archivo;
  if (!/^(indice|\d+)\.json$/.test(archivo)) {
    res.sendStatus(404);
    return;
  }
  try {
    const contenido = await readFile2(path.join(import.meta.dirname, "datos", "frescura", archivo));
    res.type("json").send(contenido);
  } catch {
    res.status(404).json({ error: "La informaci\xF3n solicitada no est\xE1 disponible." });
  }
});
var camposFrescura = ["anio", "fecha_envio", "mes_1", "vencimiento_2", "linea", "clase_envase", "canal", "empaque", "gerencia", "cd", "codigo_cd", "codigo_material", "material", "fecha_vencimiento", "dias_venc_actual", "costo_usd"];
var gruposFrescura = {
  diario: ["cd", "codigo_material", "material", "fecha_vencimiento", "dias_venc_actual", "fecha_envio"],
  resumen: ["cd", "codigo_material", "material", "mes_1"],
  sku: ["codigo_material", "material", "cd"],
  if: ["codigo_material", "material", "cd", "fecha_vencimiento", "dias_venc_actual", "vencimiento_2"],
  riesgo: ["gerencia", "cd", "codigo_material", "material", "fecha_vencimiento", "dias_venc_actual", "vencimiento_2"],
  tendencia: ["cd", "fecha_envio", "mes_1"],
  ka: ["codigo_material", "material", "cd", "fecha_vencimiento", "dias_venc_actual", "vencimiento_2"],
  rango: ["codigo_material", "material", "cd", "vencimiento_2"]
};
var opcionesFrescura = null;
app.use("/api/excel", rutasExcel(dbFrescura, leerSesion, () => {
  opcionesFrescura = null;
}));
app.get("/api/consolidado-opciones/costos", async (req, res) => {
  if (!leerSesion(req)) {
    res.status(401).json({ error: "No has iniciado sesi\xF3n." });
    return;
  }
  if (!dbFrescura) {
    res.status(503).json({ error: "Falta configurar la conexi\xF3n a la base de datos." });
    return;
  }
  const busqueda = typeof req.query.q === "string" ? req.query.q.trim().replace(",", ".").slice(0, 40) : "";
  try {
    const resultado = await dbFrescura.query(`select distinct costo_usd::text as valor from public.frescura_consolidado_detalle where lote_id = (select id from public.frescura_consolidado_lotes order by cargado_en desc limit 1) and ($1 = '' or coalesce(costo_usd::text, '') ilike '%' || $1 || '%') order by valor nulls first limit 101`, [busqueda]);
    res.json({ valores: resultado.rows.slice(0, 100).map((fila) => fila.valor), mas: resultado.rows.length > 100 });
  } catch (error) {
    console.error("Error consultando costos:", error instanceof Error ? error.message : "error desconocido");
    res.status(500).json({ error: "No se pudieron consultar los costos." });
  }
});
app.get("/api/consolidado/:modulo", async (req, res) => {
  if (!leerSesion(req)) {
    res.status(401).json({ error: "No has iniciado sesi\xF3n." });
    return;
  }
  const columnas = gruposFrescura[req.params.modulo];
  if (!columnas) {
    res.sendStatus(404);
    return;
  }
  if (!dbFrescura) {
    res.status(503).json({ error: "Falta configurar la conexi\xF3n a la base de datos." });
    return;
  }
  if (req.query.paginado !== "1") {
    res.status(409).json({ error: "Actualiza la p\xE1gina para cargar la versi\xF3n actual del informe." });
    return;
  }
  const tamanoPagina = 5e3;
  const limiteGrupos = 2e5;
  const offsetTexto = req.query.offset ?? "0";
  const loteSolicitado = req.query.lote;
  if (typeof offsetTexto !== "string" || !/^\d{1,6}$/.test(offsetTexto) || Number(offsetTexto) >= limiteGrupos || Number(offsetTexto) % tamanoPagina !== 0 || loteSolicitado !== void 0 && (typeof loteSolicitado !== "string" || !loteSolicitado.length || loteSolicitado.length > 200)) {
    res.status(400).json({ error: "La p\xE1gina solicitada no es v\xE1lida." });
    return;
  }
  const offset = Number(offsetTexto);
  try {
    const loteResult = loteSolicitado === void 0 ? await dbFrescura.query("select id from public.frescura_consolidado_lotes order by cargado_en desc limit 1") : await dbFrescura.query("select id from public.frescura_consolidado_lotes where id = $1", [loteSolicitado]);
    const lote = loteResult.rows[0]?.id;
    if (!lote) {
      res.status(404).json({ error: "No hay datos consolidados." });
      return;
    }
    if (!opcionesFrescura || opcionesFrescura.lote !== lote) {
      const opciones = await dbFrescura.query(`select ${camposFrescura.filter((c) => c !== "costo_usd").map((c) => `array_remove(array_agg(distinct ${c}::text order by ${c}::text), null) as ${c}`).join(", ")} from public.frescura_consolidado_detalle where lote_id=$1`, [lote]);
      const valores = opciones.rows[0];
      opcionesFrescura = { lote, valores, ultimaFecha: valores.fecha_envio.at(-1) ?? "" };
    }
    const opcionesActuales = opcionesFrescura;
    const parametros = [lote];
    const condiciones = ["lote_id = $1"];
    for (const campo of camposFrescura) {
      const valor = req.query[campo];
      if (campo === "fecha_envio" && req.params.modulo === "diario") {
        const fechas = (Array.isArray(valor) ? valor : typeof valor === "string" ? [valor] : []).filter((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v));
        if (valor === "__ninguna__") condiciones.push("false");
        else if (fechas.length) {
          parametros.push(fechas.join(","));
          condiciones.push(`fecha_envio::text = any(string_to_array($${parametros.length}, ','))`);
        } else if (valor !== "__todas__") {
          const ultimas = opcionesActuales.valores.fecha_envio.slice(-9);
          if (ultimas.length) {
            parametros.push(ultimas.join(","));
            condiciones.push(`fecha_envio::text = any(string_to_array($${parametros.length}, ','))`);
          }
        }
      } else if (campo === "costo_usd" && req.params.modulo === "diario") {
        const costos = (Array.isArray(valor) ? valor : typeof valor === "string" ? [valor] : []).filter((v) => typeof v === "string" && (v === "__vacio__" || /^-?\d+(?:\.\d+)?$/.test(v)));
        if (costos.length) {
          const numeros = costos.filter((v) => v !== "__vacio__");
          const partes = [];
          if (numeros.length) {
            parametros.push(numeros.join(","));
            partes.push(`costo_usd::text = any(string_to_array($${parametros.length}, ','))`);
          }
          if (costos.includes("__vacio__")) partes.push("costo_usd is null");
          condiciones.push(`(${partes.join(" or ")})`);
        }
      } else {
        const valores = (Array.isArray(valor) ? valor : typeof valor === "string" ? [valor] : []).filter((v) => typeof v === "string" && v.length <= 150 && !v.includes("") && v !== "__todas__");
        if (valores.includes("__ninguna__")) condiciones.push("false");
        else if (valores.length) {
          const incluyeVacios = valores.includes("__vacio__");
          const presentes = valores.filter((v) => v !== "__vacio__");
          const partes = [];
          if (presentes.length) {
            parametros.push(presentes.join(""));
            partes.push(`${campo}::text = any(string_to_array($${parametros.length}, chr(31)))`);
          }
          if (incluyeVacios) partes.push(`(${campo} is null or ${campo}::text = '')`);
          if (partes.length) condiciones.push(`(${partes.join(" or ")})`);
        }
      }
    }
    const historico = req.params.modulo === "diario" || req.params.modulo === "tendencia" || req.query.fecha_envio === "__todas__";
    if (!historico && !req.query.fecha_envio && opcionesActuales.ultimaFecha) {
      parametros.push(opcionesActuales.ultimaFecha);
      condiciones.push(`fecha_envio::text = $${parametros.length}`);
    }
    const dimensions = columnas.join(", ");
    const agrupada = `select ${dimensions}, sum(coalesce(hectolitros, 0))::float8 as hectolitros, sum(coalesce(valor_total, 0))::float8 as valor_total, sum(coalesce(costo_usd, 0))::float8 as costo_usd from public.frescura_consolidado_detalle where ${condiciones.join(" and ")} group by ${dimensions}`;
    const requiereUmbral = ["if", "riesgo", "ka"].includes(req.params.modulo);
    const particion = columnas.filter((c) => c !== "vencimiento_2").join(", ");
    const paginacion = ` limit ${tamanoPagina + 1} offset ${offset}`;
    const consulta = requiereUmbral ? `select ${dimensions}, hectolitros, valor_total, costo_usd from (select *, sum(hectolitros) over (partition by ${particion}) as total_fecha from (${agrupada}) grupos) filtrados where total_fecha >= 10 order by ${dimensions}${paginacion}` : `${agrupada} order by ${dimensions}${paginacion}`;
    const resultado = await dbFrescura.query(consulta, parametros);
    const hayMas = resultado.rows.length > tamanoPagina;
    const siguienteOffset = hayMas && offset + tamanoPagina < limiteGrupos ? offset + tamanoPagina : null;
    const truncado = hayMas && siguienteOffset === null;
    res.json({ opciones: opcionesActuales.valores, ultimaFecha: opcionesActuales.ultimaFecha, historico, filas: resultado.rows.slice(0, tamanoPagina), truncado, lote, siguienteOffset });
  } catch (error) {
    console.error("Error consultando el consolidado:", error instanceof Error ? error.message : "error desconocido");
    res.status(500).json({ error: "No se pudo consultar el consolidado." });
  }
});
var paginaProtegida = (archivo) => (req, res) => {
  if (!leerSesion(req)) {
    res.redirect("/");
    return;
  }
  res.sendFile(path.join(import.meta.dirname, "views", archivo));
};
app.get("/panel", paginaProtegida("panel.html"));
app.get("/modulos", paginaProtegida("modulos.html"));
app.get("/preventas", paginaProtegida("preventas.html"));
app.get("/formularios", paginaProtegida("formularios.html"));
app.get("/solicitudes", paginaProtegida("solicitudes.html"));
app.get("/activos", paginaProtegida("activos.html"));
app.get("/t1", paginaProtegida("t1.html"));
app.get("/wip", paginaProtegida("wip.html"));
app.get("/ofe", paginaProtegida("ofe.html"));
var server_default = app;
if (!process.env.VERCEL) app.listen(Number(PORT), (err) => {
  if (err) {
    console.error(`No se pudo arrancar en el puerto ${PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`Bavaria Transporte en http://localhost:${PORT}`);
});
export {
  server_default as default
};
