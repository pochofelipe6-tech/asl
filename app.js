// Generado desde server.ts por npm run build. No editar directamente.

// server.ts
import path from "node:path";
import { readFile } from "node:fs/promises";
import express2 from "express";
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
var app = express2();
app.use("/api/excel", express2.json({ limit: "2mb" }));
app.use(express2.json());
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
    res.redirect("/panel");
    return;
  }
  res.sendFile(path.join(import.meta.dirname, "public", "index.html"));
});
app.use(express2.static(path.join(import.meta.dirname, "public")));
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
    const contenido = await readFile(path.join(import.meta.dirname, "datos", "frescura", archivo));
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
