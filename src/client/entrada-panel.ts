import { animate, createDrawable, createMotionPath, createTimeline, scrambleText, splitText, stagger, utils } from 'animejs';

// Animación de entrada del panel: cada bloque entra en cascada (menú, barra, portada,
// indicadores, accesos y la fila inferior) y después se animan sus detalles: el título
// letra a letra, los números contando, las barras creciendo, las rutas del mapa
// dibujándose, la dona llenándose…

const $ = <T extends Element = HTMLElement>(sel: string) => Array.from(document.querySelectorAll<T>(sel));
const formato = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

const reducido = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Cuenta desde `desde` hasta `hasta` escribiendo el número en el elemento
export function contar(el: Element, hasta: number, duracion = 1600, desde = 0) {
  if (reducido()) {
    el.textContent = formato.format(hasta);
    return;
  }
  const n = { v: desde };
  return animate(n, {
    v: hasta,
    duration: duracion,
    ease: 'outExpo',
    onUpdate: () => { el.textContent = formato.format(n.v); },
  });
}

// Llena la dona hasta `valor` % (el círculo tiene pathLength="100")
export function animarDona(circulo: SVGCircleElement, valor: number, duracion = 1600) {
  const actual = parseFloat(circulo.getAttribute('stroke-dasharray') ?? '0') || 0;
  if (reducido()) {
    circulo.setAttribute('stroke-dasharray', `${valor} 100`);
    return;
  }
  const n = { v: actual };
  return animate(n, {
    v: valor,
    duration: duracion,
    ease: 'inOutCubic',
    onUpdate: () => circulo.setAttribute('stroke-dasharray', `${n.v.toFixed(2)} 100`),
  });
}

export function entradaPanel(): Promise<void> {
  const raiz = document.documentElement;

  // El vehículo recorre la ruta azul sin parar (también con movimiento reducido no: se queda quieto)
  const vehiculo = document.querySelector('#vehiculo');
  const rutaAzul = document.querySelector('#rutaAzul');

  if (reducido()) {
    raiz.classList.remove('entrada');
    if (vehiculo) utils.set(vehiculo, { opacity: 0 });
    return Promise.resolve();
  }

  // ---------- Estado inicial (antes de quitar la clase que lo oculta todo) ----------
  const titulo = splitText('#heroT1', { chars: { wrap: 'clip' } });
  const subtitulo = splitText('#heroT2', { words: true });
  const rutas = createDrawable('.ruta');
  const valores = $('[data-valor]');
  const objetivo = valores.map(el => Number(el.dataset.valor));
  const dona = document.querySelector<SVGCircleElement>('#donaValor');
  const donaNumero = document.querySelector('#donaNumero');
  const resumen = $('.resumen dd');
  const resumenValores = resumen.map(dd => Number(dd.textContent));

  utils.set('[data-entrada]', { opacity: 0 });
  utils.set('.hero-fondo', { opacity: 0 });
  utils.set('.hero-fondo img', { scale: 1.18 });
  utils.set(['#heroEtiqueta', '#heroSub'], { opacity: 0 });
  utils.set(titulo.chars, { y: '110%' });
  utils.set(subtitulo.words, { opacity: 0, y: 30 });
  utils.set('.kpi-barras i', { scaleY: 0 });
  utils.set(['.kpi-delta', '.mapa-fondo', '.etiquetas text', '.mapa-leyenda li', '.mapa-info', '.actividad', '#vehiculo'], { opacity: 0 });
  utils.set('.marcador', { scale: 0 });
  utils.set(rutas, { draw: '0 0' });
  utils.set('.estado', { opacity: 0, scale: 0.6 });
  valores.forEach(el => { el.textContent = '0'; });
  resumen.forEach(dd => { dd.textContent = '0'; });
  if (dona) dona.setAttribute('stroke-dasharray', '0 100');
  if (donaNumero) donaNumero.textContent = '0';

  raiz.classList.remove('entrada');

  // ---------- Coreografía ----------
  const tl = createTimeline({ defaults: { ease: 'outExpo', duration: 900 } });

  // Menú lateral: la marca gira y cae en su sitio; los apartados entran en cascada
  tl.add('.marca', { opacity: [0, 1], x: [-30, 0], duration: 700 }, 0)
    .add('.marca-logo', { rotate: [-200, 0], scale: [0, 1], ease: 'outBack(1.8)', duration: 1000 }, 0)
    .add('.lateral [data-entrada]:not(.marca)', { opacity: [0, 1], x: [-40, 0], delay: stagger(55) }, 120)
    // Barra superior
    .add('.barra', { opacity: [0, 1], y: [-30, 0], duration: 800 }, 150)
    // Portada: la foto se acerca y se aclara; el título sube letra a letra
    .add('.hero-fondo', { opacity: [0, 1], duration: 1400, ease: 'outQuad' }, 0)
    .add('.hero-fondo img', { scale: [1.18, 1], duration: 2600, ease: 'outQuart' }, 0)
    .add('#heroEtiqueta', { opacity: [0, 1], duration: 300 }, 250)
    .add('#heroEtiqueta', { innerHTML: scrambleText({ chars: 'A-Z', cursor: '_' }), duration: 900 }, 250)
    .add(titulo.chars, { y: ['110%', '0%'], delay: stagger(32), duration: 1000 }, 320)
    .add(subtitulo.words, { opacity: [0, 1], y: [30, 0], filter: ['blur(10px)', 'blur(0px)'], delay: stagger(90), duration: 1000 }, 620)
    .add('#heroSub', { opacity: [0, 1], y: [14, 0], duration: 900 }, 900)
    .add('.hero-datos [data-entrada]', { opacity: [0, 1], x: [60, 0], delay: stagger(130), ease: 'outBack(1.4)', duration: 1000 }, 600)

    // Indicadores: caen girando hacia el frente, el icono rebota, las barras crecen
    .add('.kpi', { opacity: [0, 1], y: [60, 0], rotateX: [35, 0], scale: [0.9, 1], delay: stagger(100), duration: 1100 }, 750)
    .add('.kpi-icono', { scale: [0, 1], rotate: [-120, 0], ease: 'outBack(2)', delay: stagger(100), duration: 900 }, 900)
    .add('.kpi-barras i', { scaleY: [0, 1], ease: 'outElastic(1, .6)', delay: stagger(45), duration: 1200 }, 1050)
    .add('.kpi-delta', { opacity: [0, 1], y: [10, 0], delay: stagger(100) }, 1400)
    .add('.kpi', { '--brillo': ['-120%', '120%'], ease: 'inOutQuad', delay: stagger(120), duration: 900 }, 1300)

    // Accesos rápidos
    .add('.seccion-cabecera', { opacity: [0, 1], x: [-30, 0] }, 1150)
    .add('.acceso', { opacity: [0, 1], y: [40, 0], scale: [0.94, 1], delay: stagger(90), ease: 'outBack(1.3)', duration: 900 }, 1200)
    .add('.acceso-icono', { rotate: [-25, 0], scale: [0.4, 1], ease: 'outBack(2.2)', delay: stagger(90), duration: 800 }, 1300)
    .add('.acceso-flecha', { x: [-14, 0], delay: stagger(90), duration: 700 }, 1450)

    // Fila inferior: las tarjetas suben; luego cada una despliega su contenido
    .add('.fila .tarjeta', { opacity: [0, 1], y: [70, 0], delay: stagger(120), duration: 1100 }, 1400)
    .add('.mapa-fondo', { opacity: [0, 1], scale: [1.12, 1], duration: 1600, ease: 'outQuart' }, 1500)
    .add(rutas, { draw: ['0 0', '0 1'], delay: stagger(160), duration: 1300, ease: 'inOutQuad' }, 1700)
    // En SVG, `y` movería el atributo de posición del <text>: se desplaza con translateY
    .add('.etiquetas text', { opacity: [0, 1], translateY: [8, 0], delay: stagger(120), duration: 700 }, 1800)
    .add('.marcador', { scale: [0, 1], ease: 'outBack(3)', delay: stagger(110), duration: 700 }, 2100)
    .add('.mapa-leyenda li', { opacity: [0, 1], x: [20, 0], delay: stagger(90), duration: 600 }, 1900)
    .add('.mapa-info', { opacity: [0, 1], y: [24, 0], ease: 'outBack(1.5)', duration: 800 }, 2500)
    .add('.actividad', { opacity: [0, 1], x: [50, 0], delay: stagger(90), duration: 900 }, 1600)
    .add('.estado', { opacity: [0, 1], scale: [0.6, 1], ease: 'outBack(2.4)', delay: stagger(90), duration: 600 }, 1950);

  // Números contando y dona llenándose, sincronizados con la llegada de su tarjeta
  setTimeout(() => valores.forEach((el, i) => contar(el, objetivo[i], 1800)), 950);
  setTimeout(() => {
    if (dona) animarDona(dona, 92, 1700);
    if (donaNumero) contar(donaNumero, 92, 1700);
    resumen.forEach((dd, i) => contar(dd, resumenValores[i], 1500));
  }, 1750);

  // El vehículo empieza a recorrer la ruta azul cuando ya está dibujada
  if (vehiculo && rutaAzul) {
    setTimeout(() => {
      utils.set(vehiculo, { opacity: 1 });
      animate(vehiculo, { ...createMotionPath(rutaAzul), duration: 7000, ease: 'inOutSine', loop: true, alternate: true });
    }, 2800);
  }

  return tl.then().then(() => undefined);
}
