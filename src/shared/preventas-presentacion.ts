// Una presentación explícita permite calcular la conversión sin copiar otro SKU.
export function conversionPresentacion(descripcion: unknown) {
  const texto = String(descripcion ?? '').toUpperCase().replace(/,/g, '.');
  const volumenes = [...texto.matchAll(/(\d+(?:\.\d+)?)\s*(ML|CC|LITROS?|L)(?=\b|X\s*\d)/g)];
  const paquetes = [...texto.matchAll(/[X×]\s*(\d+)\s*(?:UND?|UNIDADES?|PACK)?\b/g)];
  if (volumenes.length !== 1 || paquetes.length !== 1) return;
  const factor = Number(paquetes[0][1]);
  const hl = Number(volumenes[0][1]) / (/^(ML|CC)$/.test(volumenes[0][2]) ? 100000 : 100);
  if (factor > 0 && factor <= 1000 && hl > 0 && hl <= 10) return { factor, hl };
}

// Mantiene el alcance de Cervezas/Maltas del seguimiento, sin sumar otros negocios.
export function categoriaPresentacion(descripcion: unknown): string | undefined {
  const texto = String(descripcion ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (/\b(?:PONY\s*MALTA|MALTA\s*LEONA)\b/.test(texto)) return 'Maltas';
  if (/^(?:CERVEZA\b|AGUILA\b|POKER\b|COSTENA\b|COSTENITA\b|CORONA\b|BUDWEISER\b|STELLA\s*ARTOIS\b|BBC\b|CLUB\s*COLOMBIA\b|REDD'?S\b|COLA\s*[&Y]\s*POLA\b)/.test(texto)) return 'Cervezas';
}
