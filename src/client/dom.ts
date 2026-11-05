// Busca un elemento por id; si falta, el HTML y el script no coinciden y conviene saberlo ya
export function porId<T extends Element = HTMLElement>(id: string): T {
  const el: Element | null = document.getElementById(id); // también sirve para elementos SVG
  if (!el) throw new Error(`Falta el elemento #${id} en la página`);
  return el as T;
}
