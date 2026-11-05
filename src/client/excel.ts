import { porId } from './dom';
import { COLUMNAS_EXCEL, MAX_ARCHIVO } from '../shared/excel';
import type { FilaExcel, ValorExcel } from '../shared/excel';

class ProcesadorExcel {
  worker = new Worker('/js/excel-worker.js', { type: 'module' });
  secuencia = 0;
  pendientes = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  constructor() {
    this.worker.addEventListener('message', event => {
      const pendiente = this.pendientes.get(event.data.id); if (!pendiente) return;
      this.pendientes.delete(event.data.id);
      if (event.data.error) pendiente.reject(new Error(event.data.error)); else pendiente.resolve(event.data.resultado);
    });
    this.worker.addEventListener('error', () => this.cerrar(new Error('No se pudo procesar el archivo. Recarga la página o prueba un archivo más pequeño.')));
  }
  pedir<T>(accion: string, datos?: unknown): Promise<T> {
    const id = ++this.secuencia;
    return new Promise((resolve, reject) => {
      this.pendientes.set(id, { resolve: value => resolve(value as T), reject });
      this.worker.postMessage({ id, accion, datos }, datos instanceof ArrayBuffer ? [datos] : []);
    });
  }
  cerrar(error = new Error('Operación cancelada.')) {
    this.worker.terminate(); this.pendientes.forEach(p => p.reject(error)); this.pendientes.clear();
  }
}

export function prepararExcel() {
  const subir = porId<HTMLButtonElement>('uploadExcel');
  const descargar = porId<HTMLButtonElement>('downloadExcel');
  const plantilla = porId<HTMLButtonElement>('downloadTemplate');
  const estado = porId('excelStatus');
  const dialogo = porId<HTMLDialogElement>('excelDialog');
  const archivo = porId<HTMLInputElement>('excelFile');
  const confirmar = porId<HTMLButtonElement>('excelConfirm');
  const cancelar = porId<HTMLButtonElement>('excelCancel');
  const cerrar = porId<HTMLButtonElement>('excelClose');
  const mensaje = porId('excelMessage');
  const resumen = porId('excelSummary');
  const progreso = porId<HTMLProgressElement>('excelProgress');
  const cancelarDescarga = porId<HTMLButtonElement>('cancelExcelDownload');
  let procesador: ProcesadorExcel | undefined, controlador: AbortController | undefined;
  let filas = 0, importacion: string | undefined, ocupado = false, finalizando = false, completa = false;
  let generacion = 0;
  const numero = (n: number) => n.toLocaleString('es-CO');
  const bloquear = (valor: boolean) => { ocupado = valor; subir.disabled = descargar.disabled = plantilla.disabled = valor; };
  const avisar = (texto: string, error = false) => { mensaje.textContent = texto; mensaje.classList.toggle('excel-error', error); };

  async function api<T>(url: string, options: RequestInit = {}, reintentos = 0): Promise<T> {
    for (let intento = 0; ; intento++) {
      try {
        const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
        if (response.status === 204) return undefined as T;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status >= 500 && intento < reintentos) continue;
          throw new Error(data.error || (response.status === 401 ? 'Tu sesión venció. Vuelve a iniciar sesión.' : 'No se pudo completar la operación.'));
        }
        return data as T;
      } catch (error) {
        if (error instanceof TypeError && intento < reintentos && !options.signal?.aborted) continue;
        throw error;
      }
    }
  }
  function guardar(buffer: ArrayBuffer, nombre: string) {
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const enlace = document.createElement('a'); enlace.href = url; enlace.download = nombre; enlace.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  const ocultar = () => { dialogo.close(); procesador?.cerrar(); procesador = undefined; };
  async function cancelarCarga() {
    if (finalizando) return;
    if (completa) { location.href = '/panel'; return; }
    generacion++; controlador?.abort(); procesador?.cerrar();
    if (importacion) {
      cancelar.disabled = true;
      try { await api(`/api/excel/importaciones/${importacion}`, { method: 'DELETE' }, 1); }
      catch { estado.textContent = 'Se detuvo el envío. La carga sin finalizar no cambia el informe y caducará automáticamente.'; }
      finally { cancelar.disabled = false; }
    }
    importacion = undefined; bloquear(false); ocultar();
  }
  cancelar.addEventListener('click', () => void cancelarCarga()); cerrar.addEventListener('click', () => void cancelarCarga());
  dialogo.addEventListener('cancel', event => { event.preventDefault(); void cancelarCarga(); });
  window.addEventListener('beforeunload', event => { if (ocupado) { event.preventDefault(); event.returnValue = ''; } });

  subir.addEventListener('click', () => {
    filas = 0; importacion = undefined; completa = false; finalizando = false;
    archivo.value = ''; archivo.disabled = false; confirmar.disabled = true; confirmar.hidden = false;
    cancelar.textContent = 'Cancelar'; resumen.hidden = true; progreso.hidden = true;
    avisar('Selecciona el Excel con la hoja Data.'); dialogo.showModal();
  });
  archivo.addEventListener('change', async () => {
    const seleccionado = archivo.files?.[0]; if (!seleccionado) return;
    const turno = ++generacion; confirmar.disabled = true; resumen.hidden = true; procesador?.cerrar();
    if (!/\.(xlsx|xlsb)$/i.test(seleccionado.name) || seleccionado.size > MAX_ARCHIVO) { avisar('Usa un archivo .xlsx o .xlsb de hasta 100 MB.', true); return; }
    bloquear(true); avisar('Revisando columnas, fechas y valores del archivo…');
    try {
      procesador = new ProcesadorExcel();
      const datos = await procesador.pedir<{ filas: number; desde: string; hasta: string; muestra: ValorExcel[][] }>('leer', await seleccionado.arrayBuffer());
      if (turno !== generacion) return;
      filas = datos.filas; resumen.replaceChildren();
      const titulo = document.createElement('strong'); titulo.textContent = seleccionado.name;
      const detalle = document.createElement('p'); detalle.textContent = `${numero(filas)} filas · Fechas de envío: ${datos.desde} a ${datos.hasta}`;
      const tabla = document.createElement('table'); const cabecera = tabla.createTHead().insertRow();
      for (const nombre of ['CD', 'Material', 'Hectolitros']) { const th = document.createElement('th'); th.textContent = nombre; cabecera.append(th); }
      const cuerpo = tabla.createTBody(); for (const fila of datos.muestra) { const tr = cuerpo.insertRow(); for (const valor of fila) tr.insertCell().textContent = String(valor ?? ''); }
      resumen.append(titulo, detalle, tabla); resumen.hidden = false;
      avisar('Archivo válido. Al importar, este archivo completo será el informe visible. Los lotes anteriores se conservarán.');
      confirmar.textContent = `Importar ${numero(filas)} filas`; confirmar.disabled = false;
    } catch (error) { if (turno === generacion) avisar(error instanceof Error ? error.message : 'No se pudo leer el Excel.', true); }
    finally { if (turno === generacion) bloquear(false); }
  });
  confirmar.addEventListener('click', async () => {
    if (!filas || !procesador || !archivo.files?.[0] || ocupado) return;
    const turno = ++generacion; controlador = new AbortController(); bloquear(true); archivo.disabled = true; confirmar.disabled = true;
    progreso.hidden = false; progreso.max = filas; progreso.value = 0;
    try {
      const inicio = await api<{ id: string }>('/api/excel/importaciones', { method: 'POST', body: JSON.stringify({ archivo: archivo.files[0].name, filas, columnas: COLUMNAS_EXCEL }), signal: controlador.signal });
      importacion = inicio.id;
      for (let offset = 0; offset < filas;) {
        const bloque = await procesador.pedir<FilaExcel[]>('bloque', offset);
        if (!bloque.length) throw new Error('No se pudo preparar el siguiente bloque del Excel.');
        avisar(`Subiendo ${numero(offset)} de ${numero(filas)} filas…`);
        const respuesta = await api<{ recibidas: number }>(`/api/excel/importaciones/${importacion}/filas`, { method: 'PUT', body: JSON.stringify({ offset, filas: bloque }), signal: controlador.signal }, 2);
        if (respuesta.recibidas !== offset + bloque.length) throw new Error('El progreso de la carga no coincide. Vuelve a intentarlo.');
        offset = respuesta.recibidas; progreso.value = offset;
      }
      finalizando = true; cancelar.disabled = cerrar.disabled = true; avisar('Verificando y guardando el informe…');
      await api(`/api/excel/importaciones/${importacion}/finalizar`, { method: 'POST', body: '{}' }, 2);
      completa = true; avisar(`Se importaron ${numero(filas)} filas correctamente.`); estado.textContent = 'Excel importado correctamente.';
      confirmar.hidden = true; cancelar.textContent = 'Ver informe'; procesador.cerrar();
    } catch (error) {
      if (turno !== generacion) return;
      avisar(error instanceof Error ? error.message : 'No se pudo importar el Excel.', true);
      let respuestaIncierta = false;
      if (finalizando && importacion) {
        try {
          const revision = await api<{ estado: string }>(`/api/excel/importaciones/${importacion}`, {}, 1);
          if (revision.estado === 'completa') {
            completa = true; confirmar.hidden = true; cancelar.textContent = 'Ver informe';
            avisar(`Se importaron ${numero(filas)} filas correctamente.`); procesador.cerrar(); return;
          }
        } catch { respuestaIncierta = true; }
      }
      if (importacion && !respuestaIncierta) {
        try { await api(`/api/excel/importaciones/${importacion}`, { method: 'DELETE' }, 1); importacion = undefined; } catch { /* La carga temporal vence automáticamente. */ }
      }
      if (respuestaIncierta) {
        confirmar.hidden = true; cancelar.textContent = 'Revisar informe'; completa = true;
        avisar('No se pudo confirmar la respuesta final. Revisa el informe antes de volver a subir el archivo.', true);
      } else { confirmar.disabled = false; archivo.disabled = false; }
    } finally { if (turno === generacion) { finalizando = false; cancelar.disabled = cerrar.disabled = false; bloquear(false); } }
  });

  plantilla.addEventListener('click', async () => {
    bloquear(true); estado.textContent = 'Preparando plantilla…'; const worker = new ProcesadorExcel();
    try { guardar(await worker.pedir<ArrayBuffer>('plantilla'), 'Plantilla_Data_IF.xlsx'); estado.textContent = 'Plantilla descargada. Completa la hoja Data.'; }
    catch (error) { estado.textContent = (error as Error).message; }
    finally { worker.cerrar(); bloquear(false); }
  });
  cancelarDescarga.addEventListener('click', () => controlador?.abort());
  const dialogoDescarga = porId<HTMLDialogElement>('excelDownloadDialog');
  const formularioDescarga = porId<HTMLFormElement>('excelDownloadForm');
  const desde = porId<HTMLInputElement>('excelDownloadFrom');
  const hasta = porId<HTMLInputElement>('excelDownloadTo');
  const historico = porId<HTMLInputElement>('excelDownloadHistory');
  const actualizarFechas = () => {
    desde.disabled = hasta.disabled = historico.checked;
    porId('excelDownloadDates').hidden = historico.checked;
    hasta.min = desde.value || '1900-01-01';
    hasta.setCustomValidity(!historico.checked && desde.value && hasta.value && desde.value > hasta.value ? 'La fecha final debe ser igual o posterior a la inicial.' : '');
  };
  formularioDescarga.addEventListener('input', actualizarFechas);
  porId('excelDownloadClose').addEventListener('click', () => dialogoDescarga.close());
  descargar.addEventListener('click', () => { actualizarFechas(); dialogoDescarga.showModal(); });
  formularioDescarga.addEventListener('submit', async event => {
    event.preventDefault();
    actualizarFechas();
    if (!formularioDescarga.reportValidity() || ocupado) return;
    const rango = !historico.checked;
    const fechas = rango ? '&' + new URLSearchParams({ desde: desde.value, hasta: hasta.value }) : '';
    const sufijo = rango ? `_${desde.value}_${hasta.value}` : '_historico';
    dialogoDescarga.close();
    bloquear(true); controlador = new AbortController(); cancelarDescarga.hidden = false;
    const worker = new ProcesadorExcel(); const signal = controlador.signal;
    const detener = () => worker.cerrar(); signal.addEventListener('abort', detener);
    estado.textContent = rango ? 'Preparando descarga del rango seleccionado…' : 'Preparando descarga del histórico completo…';
    try {
      const meta = await api<{ id: string; archivo: string; filas: number }>('/api/excel/archivo', { signal });
      await worker.pedir('exportar-inicio'); let despues: number | null = 1, total = 0;
      let esperadas = meta.filas;
      while (despues !== null) {
        const pagina: { filas: FilaExcel[]; siguiente: number | null; total?: number } = await api(`/api/excel/datos?lote=${encodeURIComponent(meta.id)}&despues=${despues}${fechas}`, { signal }, 2);
        if (rango && despues === 1) {
          if (pagina.total === undefined) throw new Error('No se pudo verificar el rango de fechas.');
          esperadas = pagina.total;
          if (!esperadas) throw new Error('No hay registros en el rango de fechas seleccionado.');
        }
        if (pagina.siguiente !== null && pagina.siguiente <= despues) throw new Error('No se pudo continuar la descarga.');
        await worker.pedir('exportar-filas', pagina.filas.map(f => f.valores)); total += pagina.filas.length; despues = pagina.siguiente;
        estado.textContent = `Descargando ${numero(total)} de ${numero(esperadas)} filas…`;
      }
      if (total !== esperadas) throw new Error('No se descargaron todas las filas. Inténtalo de nuevo.');
      estado.textContent = 'Generando el archivo Excel…';
      const buffer = await worker.pedir<ArrayBuffer>('exportar-fin');
      guardar(buffer, meta.archivo.replace(/\.[^.]+$/, '') + sufijo + '.xlsx'); estado.textContent = `Excel descargado: ${numero(total)} filas.`;
    } catch (error) { estado.textContent = signal.aborted ? 'Descarga cancelada.' : error instanceof Error ? error.message : 'No se pudo descargar el Excel.'; }
    finally { signal.removeEventListener('abort', detener); worker.cerrar(); cancelarDescarga.hidden = true; bloquear(false); }
  });
}
