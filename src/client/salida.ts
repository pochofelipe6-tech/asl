import { createTimeline, stagger } from 'animejs';

// Animación de salida del formulario tras iniciar sesión: el contenido sube y se
// desvanece en cascada y después la tarjeta se encoge y se aleja hacia abajo.
// Se resuelve cuando termina, para navegar al panel justo entonces.
export async function salidaFormulario(card: HTMLElement): Promise<void> {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // En orden de lectura: logo, título, subtítulo, campos, botón y ayuda
  const contenido = card.querySelectorAll<HTMLElement>(':scope > :not(form), form > *');

  const salida = createTimeline({ defaults: { ease: 'inQuad' } })
    .add(contenido, { opacity: 0, y: -18, duration: 300, delay: stagger(45) })
    .add(card, { opacity: 0, scale: 0.92, y: 36, duration: 450, ease: 'inBack(1.4)' }, '-=160');

  await salida.then();
}
