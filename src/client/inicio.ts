// Inicio "Comando Central": los módulos que aún se construyen avisan qué les falta al tocarlos.
// Tema, usuario y cierre de sesión los maneja modulos.ts, cargado en la misma página.
// Además arma el fondo vivo (ver public/escena-inicio.css): luces, nubes, llovizna, gotas y humo encima de la foto.
import { porId } from './dom';

const mensaje = porId('ccMensaje');
let ocultar = 0;

// Al elegir un módulo, su botón da un impulso hacia adelante (public/escena-inicio.css) y luego se abre el módulo.
const quieto = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
for (const enlace of document.querySelectorAll<HTMLAnchorElement>('.cc-menu a.cc-boton')) {
  enlace.addEventListener('click', evento => {
    // Abrir en otra pestaña o ventana (Ctrl, Shift, rueda…) sigue igual, sin animación.
    if (quieto() || evento.defaultPrevented || evento.button !== 0 || evento.ctrlKey || evento.metaKey || evento.shiftKey || evento.altKey) return;
    evento.preventDefault();
    enlace.classList.add('cc-lanzar');
    setTimeout(() => location.assign(enlace.href), 300);
  });
}
// Al volver con "Atrás", el botón aparece en su lugar (la página puede venir guardada tal como se fue).
addEventListener('pageshow', () => document.querySelectorAll('.cc-lanzar').forEach(b => b.classList.remove('cc-lanzar')));

for (const boton of document.querySelectorAll<HTMLButtonElement>('.cc-boton.pronto')) {
  boton.addEventListener('click', () => {
    // Los que aún no están listos dan un golpecito hacia adelante y vuelven.
    boton.classList.remove('cc-golpe');
    void boton.offsetWidth;
    boton.classList.add('cc-golpe');
    const falta = boton.dataset.falta;
    mensaje.textContent = `${boton.dataset.modulo ?? 'Este módulo'} está en construcción. ${falta ? `Falta ${falta}.` : 'Muy pronto estará disponible.'}`;
    mensaje.classList.add('visible');
    clearTimeout(ocultar);
    ocultar = window.setTimeout(() => mensaje.classList.remove('visible'), 6000);
  });
}

// ---------- Fondo vivo ----------
// Todas las posiciones van en píxeles de la foto (public/img/comando/fondo-inicio.jpg, 1779 × 884).

const ANCHO = 1779;
const ALTO = 884;
/** Una luz: punto brillante con halo (r = radio del núcleo); o un reflejo en el piso (elipse rx × ry). */
interface Luz { x: number; y: number; r?: number; rx?: number; ry?: number; color: string; fuerza?: number }
const AMBAR = '255,170,52';
const ROJO = '255,40,24';
const CALIDA = '255,214,150';

// Camión: luces de gálibo del techo del remolque (fijas, ámbar).
const GALIBO: Luz[] = [[495, 505], [520, 497], [542, 491], [565, 485], [587, 478], [610, 472], [635, 465], [660, 458], [682, 451], [705, 445],
  [730, 438], [752, 431], [775, 425], [800, 418], [822, 411], [845, 405], [867, 397], [890, 391]].map(([x, y]) => ({ x, y, r: 2.6, color: AMBAR, fuerza: 0.8 }));
// Luces de parqueo (intermitentes): las laterales de abajo del remolque, las esquinas traseras y la del frente de la cabina.
const PARQUEO: Luz[] = [
  ...[[485, 627], [505, 626], [522, 625], [540, 623], [557, 622], [575, 621], [592, 621], [610, 620], [630, 619], [650, 617], [672, 616],
    [695, 615], [722, 613], [750, 611], [780, 610], [807, 608], [837, 607], [877, 605]].map(([x, y]) => ({ x, y, r: 3.6, color: AMBAR })),
  { x: 915, y: 635, r: 7, color: AMBAR }, { x: 1050, y: 638, r: 7, color: AMBAR }, { x: 409, y: 596, r: 6, color: AMBAR },
  // Su reflejo en el piso mojado.
  { x: 915, y: 770, rx: 9, ry: 55, color: AMBAR, fuerza: 0.55 }, { x: 1050, y: 775, rx: 9, ry: 55, color: AMBAR, fuerza: 0.55 },
  { x: 660, y: 745, rx: 150, ry: 16, color: AMBAR, fuerza: 0.22 }, { x: 412, y: 735, rx: 10, ry: 45, color: AMBAR, fuerza: 0.4 },
];
// Traseras rojas encendidas (y las de arriba del remolque), con su reflejo.
const TRASERAS: Luz[] = [
  { x: 925, y: 635, r: 5, color: ROJO }, { x: 936, y: 635, r: 5, color: ROJO }, { x: 1032, y: 638, r: 5, color: ROJO }, { x: 1041, y: 638, r: 5, color: ROJO },
  { x: 915, y: 377, r: 3.5, color: ROJO, fuerza: 0.85 }, { x: 975, y: 391, r: 3, color: ROJO, fuerza: 0.8 }, { x: 1000, y: 397, r: 3, color: ROJO, fuerza: 0.8 }, { x: 1052, y: 410, r: 3.5, color: ROJO, fuerza: 0.85 },
  { x: 930, y: 775, rx: 12, ry: 70, color: ROJO, fuerza: 0.5 }, { x: 1037, y: 780, rx: 12, ry: 70, color: ROJO, fuerza: 0.5 },
];
// Montacargas: dos balizas rojas que destellan alternadas, luces rojas fijas y la luz azul de seguridad en el piso.
const BALIZA_A: Luz[] = [{ x: 1597, y: 497, r: 7, color: ROJO }, { x: 1600, y: 850, rx: 26, ry: 34, color: ROJO, fuerza: 0.45 }];
const BALIZA_B: Luz[] = [{ x: 1623, y: 502, r: 7, color: ROJO }, { x: 1628, y: 852, rx: 26, ry: 34, color: ROJO, fuerza: 0.45 }];
const MONTA: Luz[] = [{ x: 1583, y: 495, r: 3.5, color: ROJO, fuerza: 0.8 }, { x: 1570, y: 520, r: 4, color: ROJO, fuerza: 0.7 }, { x: 1635, y: 523, r: 4, color: ROJO, fuerza: 0.7 }];
const SPOT: Luz[] = [{ x: 1160, y: 792, rx: 52, ry: 16, color: '50,140,255' }, { x: 1160, y: 792, rx: 22, ry: 7, color: '170,215,255' }];
// Bodegas: faroles de los muelles y el interior iluminado.
const FAROLES: Luz[] = [[1109, 476], [1205, 461], [1400, 422], [1745, 357]].map(([x, y]) => ({ x, y, r: 9, color: CALIDA, fuerza: 0.7 }));
const INTERIOR: Luz[] = [
  { x: 1095, y: 585, rx: 28, ry: 55, color: '255,176,80', fuerza: 0.22 }, { x: 1182, y: 570, rx: 38, ry: 60, color: '255,176,80', fuerza: 0.22 },
  { x: 1308, y: 545, rx: 62, ry: 62, color: '255,176,80', fuerza: 0.22 }, { x: 1612, y: 480, rx: 135, ry: 55, color: '255,176,80', fuerza: 0.2 },
];
const GRUPOS: [clase: string, luces: Luz[]][] = [
  ['cc-g-interior', INTERIOR], ['cc-g-farol', FAROLES], ['cc-g-galibo', GALIBO], ['cc-g-trasera', TRASERAS], ['cc-g-parqueo', PARQUEO],
  ['cc-g-monta', MONTA], ['cc-g-baliza-a', BALIZA_A], ['cc-g-baliza-b', BALIZA_B], ['cc-g-spot', SPOT],
];
/** Contorno del cielo (sin el logo, el mapa, el remolque ni la bodega): ahí se mueven las nubes. Llega hasta y = 570. */
const CIELO = '0,190 522,190 522,0 1300,0 1300,250 948,366 905,370 478,506 470,532 410,548 0,552';
const ALTO_CIELO = 570;
const ESCAPE = { x: 473, y: 536 };

function armarEscena(escena: HTMLElement) {
  const lienzos = GRUPOS.map(([clase, luces]) => ({ lienzo: lienzoDeGrupo(clase, luces), luces }));
  const dibujarTodo = () => lienzos.forEach(({ lienzo, luces }) => dibujarGrupo(lienzo, luces, escena.clientWidth));
  let pendiente = 0;
  new ResizeObserver(() => { cancelAnimationFrame(pendiente); pendiente = requestAnimationFrame(dibujarTodo); }).observe(escena);
  escena.append(...lienzos.map(l => l.lienzo));

  for (let i = 0; i < 5; i++) {
    const humo = document.createElement('i');
    humo.className = 'cc-humo';
    Object.assign(humo.style, { left: pct(ESCAPE.x, ANCHO), top: pct(ESCAPE.y, ALTO), animationDelay: `${(i * 0.84).toFixed(2)}s` });
    escena.append(humo);
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { escena.prepend(...armarNubes(false)); return; }
  // Lo que pesa más (cielo que fluye, texturas de nubes y lluvia) se arma cuando el navegador queda libre.
  // Orden de abajo hacia arriba: cielo que fluye, sombras y luces de nubes, relámpagos; encima las luces y la llovizna.
  const luego = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1200 }) : setTimeout(fn, 300));
  luego(() => {
    const cielo = armarCielo(escena);
    escena.prepend(...(cielo ? [cielo] : []), ...armarNubes(true), armarRayos(escena));
    armarLluvia(escena);
  });
}

/** Máscara con bordes suaves a partir de un contorno (en px de la foto) y la zona que cubre el elemento. */
function mascara(puntos: string, caja: string, suavizado: number): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${caja}' preserveAspectRatio='none'><filter id='b' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='${suavizado}'/></filter><polygon points='${puntos}' fill='white' filter='url(%23b)'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/%2523/g, '%23')}")`;
}
function ponerMascara(el: HTMLElement, url: string) {
  el.style.setProperty('-webkit-mask-image', url);
  el.style.setProperty('mask-image', url);
}

const pct = (v: number, total: number) => `${((v / total) * 100).toFixed(4)}%`;
const alcance = (l: Luz) => (l.r !== undefined ? { ax: l.r * 4, ay: l.r * 4 } : { ax: l.rx ?? 0, ay: l.ry ?? 0 });

/** Un lienzo solo del tamaño que ocupan sus luces (no de toda la escena: así pesa poco). */
function lienzoDeGrupo(clase: string, luces: Luz[]): HTMLCanvasElement {
  const caja = cajaDe(luces);
  const lienzo = document.createElement('canvas');
  lienzo.className = clase;
  Object.assign(lienzo.style, { left: pct(caja.x, ANCHO), top: pct(caja.y, ALTO), width: pct(caja.ancho, ANCHO), height: pct(caja.alto, ALTO) });
  return lienzo;
}
function cajaDe(luces: Luz[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of luces) {
    const { ax, ay } = alcance(l);
    x0 = Math.min(x0, l.x - ax); y0 = Math.min(y0, l.y - ay); x1 = Math.max(x1, l.x + ax); y1 = Math.max(y1, l.y + ay);
  }
  return { x: Math.floor(x0 - 2), y: Math.floor(y0 - 2), ancho: Math.ceil(x1 - x0 + 4), alto: Math.ceil(y1 - y0 + 4) };
}
function dibujarGrupo(lienzo: HTMLCanvasElement, luces: Luz[], anchoEscena: number) {
  if (!anchoEscena) return;
  const caja = cajaDe(luces);
  const escala = (anchoEscena / ANCHO) * Math.min(2, devicePixelRatio || 1);
  lienzo.width = Math.max(1, Math.round(caja.ancho * escala));
  lienzo.height = Math.max(1, Math.round(caja.alto * escala));
  const ctx = lienzo.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(escala, 0, 0, escala, -caja.x * escala, -caja.y * escala);
  ctx.globalCompositeOperation = 'lighter';
  for (const l of luces) {
    const f = l.fuerza ?? 1;
    ctx.save();
    ctx.translate(l.x, l.y);
    let radio: number;
    if (l.r !== undefined) radio = l.r * 4;
    else { radio = l.ry ?? 1; ctx.scale((l.rx ?? 1) / radio, 1); }
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radio);
    if (l.r !== undefined) {
      // Núcleo casi blanco, color alrededor y un halo que se apaga.
      g.addColorStop(0, `rgba(255,248,235,${f})`);
      g.addColorStop(0.16, `rgba(${l.color},${0.95 * f})`);
      g.addColorStop(0.42, `rgba(${l.color},${0.32 * f})`);
      g.addColorStop(1, `rgba(${l.color},0)`);
    } else {
      g.addColorStop(0, `rgba(${l.color},${0.9 * f})`);
      g.addColorStop(0.5, `rgba(${l.color},${0.35 * f})`);
      g.addColorStop(1, `rgba(${l.color},0)`);
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, radio, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// --- Nubes: ruido suave que se repite de lado a lado (así la capa avanza sin cortes) ---

function azar(semilla: number) {
  let a = semilla >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Ruido de valor en varias octavas, repetible en horizontal; nubes estiradas a lo ancho (como las de la foto). */
function ruido(ancho: number, alto: number, semilla: number): Float32Array {
  const salida = new Float32Array(ancho * alto);
  const al = azar(semilla);
  let amplitud = 1, total = 0;
  for (let o = 0; o < 5; o++) {
    const cx = 3 << o;
    const cy = Math.max(2, Math.round(cx * (alto / ancho) * 2.2));
    const rejilla = Float32Array.from({ length: cx * (cy + 1) }, al);
    for (let y = 0; y < alto; y++) {
      const fy = (y / alto) * cy, j = Math.floor(fy), ty = fy - j, sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < ancho; x++) {
        const fx = (x / ancho) * cx, i = Math.floor(fx), tx = fx - i, sx = tx * tx * (3 - 2 * tx);
        const i1 = (i + 1) % cx;
        const a = rejilla[j * cx + i], b = rejilla[j * cx + i1], c = rejilla[(j + 1) * cx + i], d = rejilla[(j + 1) * cx + i1];
        salida[y * ancho + x] += amplitud * ((a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy);
      }
    }
    total += amplitud;
    amplitud *= 0.52;
  }
  for (let k = 0; k < salida.length; k++) salida[k] /= total;
  return salida;
}
function texturaNubes(semilla: number, color: [number, number, number], desde: number, hasta: number, alfa: number): string {
  const ancho = 768, alto = 250;
  const n = ruido(ancho, alto, semilla);
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho; lienzo.height = alto;
  const ctx = lienzo.getContext('2d')!;
  const img = ctx.createImageData(ancho, alto);
  for (let k = 0; k < n.length; k++) {
    const t = Math.min(1, Math.max(0, (n[k] - desde) / (hasta - desde)));
    img.data[k * 4] = color[0]; img.data[k * 4 + 1] = color[1]; img.data[k * 4 + 2] = color[2];
    img.data[k * 4 + 3] = Math.round(255 * alfa * t * t * (3 - 2 * t));
  }
  ctx.putImageData(img, 0, 0);
  return lienzo.toDataURL('image/png');
}
/** Sombras y luces de nubes que pasan por encima del cielo (dos capas, de abajo hacia arriba). */
function armarNubes(mover: boolean): HTMLElement[] {
  const url = mascara(CIELO, `0 0 ${ANCHO} ${ALTO_CIELO}`, 9);
  const capas: [clase: string, textura: string][] = [
    ['cc-nubes cc-nubes-sombra', texturaNubes(7, [38, 16, 8], 0.48, 0.78, 0.95)],
    ['cc-nubes cc-nubes-luz', texturaNubes(19, [255, 150, 60], 0.52, 0.8, 0.85)],
  ];
  return capas.map(([clase, textura]) => {
    const nubes = document.createElement('div');
    nubes.className = clase;
    ponerMascara(nubes, url);
    const capa = document.createElement('div');
    capa.className = 'cc-nubes-capa';
    capa.style.backgroundImage = `url("${textura}")`;
    if (!mover) capa.style.animation = 'none';
    nubes.append(capa);
    return nubes;
  });
}

// --- Cielo que fluye: las nubes de la propia foto se desplazan y se arremolinan (WebGL) ---
// Técnica de "mapa de flujo": la foto se lee corrida a lo largo de un viento con remolinos; dos fases desfasadas se
// mezclan para que el movimiento no salte nunca. Solo se dibuja el cielo (máscara), un poco adentro de sus bordes para
// no arrastrar el logo, el mapa, el remolque ni la bodega.
const CIELO_VIVO = '0,202 532,202 532,0 1288,0 1288,238 948,352 905,357 478,492 0,538';

function armarCielo(escena: HTMLElement): HTMLCanvasElement | null {
  const lienzo = document.createElement('canvas');
  lienzo.className = 'cc-cielo-vivo';
  const gl = lienzo.getContext('webgl', { premultipliedAlpha: false, antialias: false });
  if (!gl) return null;
  const sombreador = (tipo: number, fuente: string) => {
    const s = gl.createShader(tipo)!;
    gl.shaderSource(s, fuente);
    gl.compileShader(s);
    return s;
  };
  const programa = gl.createProgram()!;
  gl.attachShader(programa, sombreador(gl.VERTEX_SHADER, `
    attribute vec2 p; varying vec2 uv;
    void main(){ uv = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0., 1.); }`));
  gl.attachShader(programa, sombreador(gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform sampler2D foto; uniform float t; uniform float alto; varying vec2 uv;
    float h(vec2 q){ return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
    float ruido(vec2 q){ vec2 i = floor(q), f = fract(q); vec2 s = f * f * (3. - 2. * f);
      return mix(mix(h(i), h(i + vec2(1., 0.)), s.x), mix(h(i + vec2(0., 1.)), h(i + vec2(1., 1.)), s.x), s.y); }
    void main(){
      vec2 p = vec2(uv.x, uv.y * alto);
      // Viento hacia la izquierda con remolinos lentos.
      float a = ruido(p * vec2(3., 6.) + vec2(t * .015, 0.)) * 6.2832;
      vec2 viento = vec2(1., 0.) + .45 * vec2(cos(a), sin(a) * .5);
      float ciclo = 7.;
      float f0 = fract(t / ciclo), f1 = fract(t / ciclo + .5);
      vec2 d = viento * vec2(.011, .011 * 2.012);
      vec3 c0 = texture2D(foto, p + d * f0).rgb;
      vec3 c1 = texture2D(foto, p + d * f1).rgb;
      gl_FragColor = vec4(mix(c0, c1, abs(1. - 2. * f0)), 1.);
    }`));
  gl.linkProgram(programa);
  if (!gl.getProgramParameter(programa, gl.LINK_STATUS)) return null;
  gl.useProgram(programa);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const ubicacion = gl.getAttribLocation(programa, 'p');
  gl.enableVertexAttribArray(ubicacion);
  gl.vertexAttribPointer(ubicacion, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1f(gl.getUniformLocation(programa, 'alto'), ALTO_CIELO / ALTO);
  const uTiempo = gl.getUniformLocation(programa, 't');

  const foto = new Image();
  foto.decoding = 'async';
  foto.src = '/img/comando/fondo-inicio.jpg';
  let lista = false;
  foto.onload = () => {
    const textura = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, textura);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, foto);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    lista = true;
    lienzo.classList.add('cc-cielo-listo');
  };
  const medir = () => {
    const escala = Math.min(1.5, devicePixelRatio || 1);
    lienzo.width = Math.max(1, Math.round(escena.clientWidth * escala));
    lienzo.height = Math.max(1, Math.round(escena.clientWidth * (ALTO_CIELO / ANCHO) * escala));
    gl.viewport(0, 0, lienzo.width, lienzo.height);
  };
  new ResizeObserver(medir).observe(escena);
  medir();
  ponerMascara(lienzo, mascara(CIELO_VIVO, `0 0 ${ANCHO} ${ALTO_CIELO}`, 12));
  // Unos 30 cuadros por segundo bastan para un cielo; el navegador lo pausa solo con la pestaña oculta.
  const inicio = performance.now();
  let ultimo = 0;
  const cuadro = (ahora: number) => {
    requestAnimationFrame(cuadro);
    if (!lista || ahora - ultimo < 33) return;
    ultimo = ahora;
    gl.uniform1f(uTiempo, (ahora - inicio) / 1000);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  requestAnimationFrame(cuadro);
  return lienzo;
}

// --- Relámpagos en la parte oscura del cielo ---
// Cada 5 a 13 s: un rayo que se ramifica (o solo el destello dentro de las nubes). Como mucho dos destellos por
// segundo y en una zona limitada (sin destellos fuertes que abarquen la pantalla); con "reducir movimiento" no hay.
const ZONA_RAYOS = { x: 520, y: 0, ancho: 780, alto: 380 };

function armarRayos(escena: HTMLElement): HTMLCanvasElement {
  const lienzo = document.createElement('canvas');
  lienzo.className = 'cc-rayos';
  const z = ZONA_RAYOS;
  Object.assign(lienzo.style, { left: pct(z.x, ANCHO), top: pct(z.y, ALTO), width: pct(z.ancho, ANCHO), height: pct(z.alto, ALTO) });
  ponerMascara(lienzo, mascara(CIELO, `${z.x} ${z.y} ${z.ancho} ${z.alto}`, 9));
  const ctx = lienzo.getContext('2d')!;
  let escala = 1;
  const medir = () => {
    escala = (escena.clientWidth / ANCHO) * Math.min(2, devicePixelRatio || 1);
    lienzo.width = Math.max(1, Math.round(z.ancho * escala));
    lienzo.height = Math.max(1, Math.round(z.alto * escala));
  };
  new ResizeObserver(medir).observe(escena);
  medir();
  const al = azar((Date.now() >>> 3) & 0xffff);

  /** Línea quebrada entre dos puntos (desplazamiento del punto medio, cada vez más fino). */
  const quebrar = (x0: number, y0: number, x1: number, y1: number, desvio: number, nivel: number): [number, number][] => {
    if (nivel === 0) return [[x0, y0], [x1, y1]];
    const mx = (x0 + x1) / 2 + (al() - 0.5) * desvio, my = (y0 + y1) / 2 + (al() - 0.5) * desvio * 0.5;
    return [...quebrar(x0, y0, mx, my, desvio / 2, nivel - 1).slice(0, -1), ...quebrar(mx, my, x1, y1, desvio / 2, nivel - 1)];
  };
  interface Trazo { puntos: [number, number][]; ancho: number; brillo: number }
  const nuevoRayo = (): { trazos: Trazo[]; cx: number; cy: number; nube: number } => {
    // En la zona oscura de arriba, entre el logo y el mapa; a veces cruza de lado dentro de la nube.
    const horizontal = al() < 0.35;
    const x0 = 600 + al() * 560, y0 = 8 + al() * 50;
    const x1 = horizontal ? x0 + (al() < 0.5 ? -1 : 1) * (160 + al() * 180) : x0 + (al() - 0.5) * 220;
    const y1 = horizontal ? y0 + 40 + al() * 60 : 150 + al() * 110;
    const principal = quebrar(x0, y0, Math.min(1270, Math.max(560, x1)), y1, horizontal ? 70 : 110, 7);
    const trazos: Trazo[] = [{ puntos: principal, ancho: 2.4, brillo: 1 }];
    const ramas = 2 + Math.floor(al() * 4);
    for (let i = 0; i < ramas; i++) {
      const [bx, by] = principal[2 + Math.floor(al() * (principal.length - 4))];
      const largo = 40 + al() * 90;
      trazos.push({ puntos: quebrar(bx, by, bx + (al() - 0.5) * largo * 1.4, by + largo * (horizontal ? 0.5 : 0.8), 40, 5), ancho: 1.3, brillo: 0.7 });
    }
    return { trazos, cx: x0, cy: y0 + 40, nube: Math.floor(al() * 390) };
  };
  // Forma de nube para el destello (manchas irregulares, no un círculo); cada relámpago usa otro trozo.
  const nube = document.createElement('canvas');
  nube.width = 780; nube.height = 190;
  {
    const n = ruido(780, 190, 23);
    const c = nube.getContext('2d')!;
    const img = c.createImageData(780, 190);
    for (let k = 0; k < n.length; k++) {
      const t = Math.min(1, Math.max(0, (n[k] - 0.32) / 0.42));
      img.data[k * 4 + 3] = Math.round(255 * (0.12 + 0.88 * t * t * (3 - 2 * t)));
    }
    c.putImageData(img, 0, 0);
  }

  let rayo: ReturnType<typeof nuevoRayo> | null = null;
  let soloDestello = false;
  let desde = 0;
  // Intensidad en el tiempo: destello, baja, segundo destello y se apaga (≈0,9 s; dos destellos como mucho).
  const intensidad = (ms: number) => (ms < 70 ? 1 : ms < 140 ? 0.22 : ms < 230 ? 0.8 : Math.max(0, 0.8 * Math.exp(-(ms - 230) / 190)));
  const pintar = (ahora: number) => {
    const i = intensidad(ahora - desde);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, lienzo.width, lienzo.height);
    if (i <= 0.01 || !rayo) { rayo = null; programar(); return; }
    ctx.setTransform(escala, 0, 0, escala, -z.x * escala, -z.y * escala);
    ctx.globalCompositeOperation = 'lighter';
    // La nube se ilumina desde adentro: un brillo ancho, recortado con forma de nube.
    ctx.save();
    ctx.translate(rayo.cx, rayo.cy);
    ctx.scale(1.7, 1);
    const brillo = ctx.createRadialGradient(0, 0, 0, 0, 0, 210);
    brillo.addColorStop(0, `rgba(220,226,255,${0.8 * i})`);
    brillo.addColorStop(0.4, `rgba(170,180,250,${0.34 * i})`);
    brillo.addColorStop(1, 'rgba(150,160,240,0)');
    ctx.fillStyle = brillo;
    ctx.fillRect(-210, -210, 420, 420);
    ctx.restore();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(nube, rayo.nube, 0, 390, 190, z.x, z.y, z.ancho, z.alto);
    ctx.globalCompositeOperation = 'lighter';
    if (!soloDestello) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const tr of rayo.trazos) {
        ctx.beginPath();
        tr.puntos.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.shadowColor = `rgba(150,170,255,${0.9 * i})`;
        ctx.shadowBlur = 20 * escala;
        ctx.strokeStyle = `rgba(175,190,255,${0.6 * i * tr.brillo})`;
        ctx.lineWidth = tr.ancho * 5;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = `rgba(255,255,255,${0.95 * i * tr.brillo})`;
        ctx.lineWidth = tr.ancho;
        ctx.stroke();
      }
    }
    requestAnimationFrame(pintar);
  };
  const programar = (espera = 5000 + al() * 8000) => setTimeout(() => {
    if (document.hidden) { programar(); return; }
    rayo = nuevoRayo();
    soloDestello = al() < 0.35;
    desde = performance.now();
    requestAnimationFrame(pintar);
  }, espera);
  programar(2500); // el primero, apenas abre la página
  return lienzo;
}

// --- Llovizna y gotas en el piso ---

function texturaLluvia(lado: number, gotas: number, semilla: number): string {
  const lienzo = document.createElement('canvas');
  lienzo.width = lado; lienzo.height = lado;
  const ctx = lienzo.getContext('2d')!;
  const al = azar(semilla);
  ctx.lineCap = 'round';
  for (let i = 0; i < gotas; i++) {
    const x = al() * lado, y = al() * lado, largo = 10 + al() * 18;
    ctx.strokeStyle = `rgba(225,232,255,${(0.35 + al() * 0.45).toFixed(2)})`;
    ctx.lineWidth = 0.8 + al() * 0.6;
    // Se dibuja también corrida un lado hacia arriba: así la textura se repite sin cortes.
    for (const dy of [0, -lado]) {
      ctx.beginPath(); ctx.moveTo(x, y + dy); ctx.lineTo(x - largo * 0.16, y + dy + largo); ctx.stroke();
    }
  }
  return lienzo.toDataURL('image/png');
}
function armarLluvia(escena: HTMLElement) {
  const lluvia = document.createElement('div');
  lluvia.className = 'cc-lluvia';
  for (const [clase, url] of [['cc-lluvia-capa cc-lluvia-lejos', texturaLluvia(160, 26, 3)], ['cc-lluvia-capa cc-lluvia-cerca', texturaLluvia(240, 22, 11)]]) {
    const capa = document.createElement('div');
    capa.className = clase;
    capa.style.backgroundImage = `url("${url}")`;
    lluvia.append(capa);
  }
  escena.append(lluvia);
  // Ondas de gotas en el piso: cada una cae en otro lugar al terminar.
  const al = azar(Date.now() & 0xffff);
  const lugar = (gota: HTMLElement) => {
    gota.style.left = pct(20 + al() * (ANCHO - 40), ANCHO);
    gota.style.top = pct(700 + al() * 175, ALTO);
  };
  for (let i = 0; i < 14; i++) {
    const gota = document.createElement('i');
    gota.className = 'cc-gota';
    lugar(gota);
    gota.style.animationDelay = `${(al() * 1.5).toFixed(2)}s`;
    gota.addEventListener('animationiteration', () => lugar(gota));
    escena.append(gota);
  }
}

// Al final: así ya están definidas todas las funciones y constantes que usa la escena.
const escena = document.querySelector<HTMLElement>('.cc-escena');
if (escena) armarEscena(escena);
