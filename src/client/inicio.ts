// Inicio "Comando Central": los módulos que aún se construyen avisan qué les falta al tocarlos.
// Tema, usuario y cierre de sesión los maneja modulos.ts, cargado en la misma página.
import { porId } from './dom';

const mensaje = porId('ccMensaje');
let ocultar = 0;

for (const boton of document.querySelectorAll<HTMLButtonElement>('.cc-boton.pronto')) {
  boton.addEventListener('click', () => {
    const falta = boton.dataset.falta;
    mensaje.textContent = `${boton.dataset.modulo ?? 'Este módulo'} está en construcción. ${falta ? `Falta ${falta}.` : 'Muy pronto estará disponible.'}`;
    mensaje.classList.add('visible');
    clearTimeout(ocultar);
    ocultar = window.setTimeout(() => mensaje.classList.remove('visible'), 6000);
  });
}
