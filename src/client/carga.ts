let pendientes = 0;
let mostrarTimer: ReturnType<typeof setTimeout> | undefined;
let ocultarTimer: ReturnType<typeof setTimeout> | undefined;
let mostradoEn = 0;

/** Mantiene un único aviso visible cuando coinciden varias consultas. */
export function iniciarCarga(): () => void {
  const indicador = document.getElementById('loadingIndicator');
  if (!indicador) return () => {};
  pendientes++;
  clearTimeout(ocultarTimer);
  if (indicador.hidden && !mostrarTimer) {
    mostrarTimer = setTimeout(() => {
      mostrarTimer = undefined;
      if (pendientes > 0) { indicador.hidden = false; mostradoEn = Date.now(); }
    }, 150);
  }
  let terminado = false;
  return () => {
    if (terminado) return;
    terminado = true; pendientes = Math.max(0, pendientes - 1);
    if (pendientes) return;
    clearTimeout(mostrarTimer); mostrarTimer = undefined;
    if (!indicador.hidden) ocultarTimer = setTimeout(() => { if (!pendientes) indicador.hidden = true; }, Math.max(0, 350 - (Date.now() - mostradoEn)));
  };
}
