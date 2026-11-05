// Generado desde server.ts por npm run build. No editar directamente.
import path from "node:path";
import { readFile } from "node:fs/promises";
import express from "express";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, JWT_SECRET, PORT = "3001" } = process.env;
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !JWT_SECRET) {
  console.error("Faltan variables de entorno. Copia .env.example como .env (o .env.local) y rell\xE9nalo.");
  process.exit(1);
}
const clienteSupabase = () => createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const COOKIE = "sesion";
const DURACION_SESION = 8 * 60 * 60 * 1e3;
const isProd = process.env.NODE_ENV === "production";
const app = express();
app.use(express.json());
app.use(cookieParser());
const leerSesion = (req) => {
  const token = req.cookies[COOKIE];
  if (typeof token !== "string") return null;
  try {
    const datos = jwt.verify(token, JWT_SECRET);
    return typeof datos === "object" ? datos : null;
  } catch {
    return null;
  }
};
app.get("/", (req, res, next) => leerSesion(req) ? res.redirect("/panel") : next());
app.use(express.static(path.join(import.meta.dirname, "public")));
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1e3,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera unos minutos e int\xE9ntalo de nuevo." }
});
const ERRORES_AUTH = {
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
const dbFrescura = process.env.SUPABASE_DB_URL ? new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 3, connectionTimeoutMillis: 15e3 }) : null;
const camposFrescura = ["anio", "fecha_envio", "mes_1", "vencimiento_2", "linea", "clase_envase", "canal", "empaque", "gerencia", "cd", "codigo_cd", "codigo_material", "material", "fecha_vencimiento", "dias_venc_actual", "costo_usd"];
const gruposFrescura = {
  diario: ["cd", "codigo_material", "material", "fecha_vencimiento", "dias_venc_actual", "fecha_envio"],
  resumen: ["cd", "codigo_material", "material", "mes_1"],
  sku: ["codigo_material", "material", "cd"],
  if: ["codigo_material", "material", "cd", "fecha_vencimiento", "dias_venc_actual", "vencimiento_2"],
  riesgo: ["gerencia", "cd", "codigo_material", "material", "fecha_vencimiento", "dias_venc_actual", "vencimiento_2"],
  tendencia: ["cd", "fecha_envio", "mes_1"],
  ka: ["codigo_material", "material", "cd", "fecha_vencimiento", "dias_venc_actual", "vencimiento_2"],
  rango: ["codigo_material", "material", "cd", "vencimiento_2"]
};
let opcionesFrescura = null;
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
  try {
    const loteResult = await dbFrescura.query("select id from public.frescura_consolidado_lotes order by cargado_en desc limit 1");
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
          const ultimas = opcionesFrescura.valores.fecha_envio.slice(-9);
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
    if (!historico && !req.query.fecha_envio && opcionesFrescura.ultimaFecha) {
      parametros.push(opcionesFrescura.ultimaFecha);
      condiciones.push(`fecha_envio::text = $${parametros.length}`);
    }
    const dimensions = columnas.join(", ");
    const agrupada = `select ${dimensions}, sum(coalesce(hectolitros, 0))::float8 as hectolitros, sum(coalesce(valor_total, 0))::float8 as valor_total, sum(coalesce(costo_usd, 0))::float8 as costo_usd from public.frescura_consolidado_detalle where ${condiciones.join(" and ")} group by ${dimensions}`;
    const requiereUmbral = ["if", "riesgo", "ka"].includes(req.params.modulo);
    const particion = columnas.filter((c) => c !== "vencimiento_2").join(", ");
    const consulta = requiereUmbral ? `select ${dimensions}, hectolitros, valor_total, costo_usd from (select *, sum(hectolitros) over (partition by ${particion}) as total_fecha from (${agrupada}) grupos) filtrados where total_fecha >= 10 order by ${dimensions} limit 200001` : `${agrupada} order by ${dimensions} limit 200001`;
    const resultado = await dbFrescura.query(consulta, parametros);
    const truncado = resultado.rows.length > 2e5;
    res.json({ opciones: opcionesFrescura.valores, ultimaFecha: opcionesFrescura.ultimaFecha, historico, filas: resultado.rows.slice(0, 2e5), truncado });
  } catch (error) {
    console.error("Error consultando el consolidado:", error instanceof Error ? error.message : "error desconocido");
    res.status(500).json({ error: "No se pudo consultar el consolidado." });
  }
});
const paginaProtegida = (archivo) => (req, res) => {
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
