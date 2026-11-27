import type { Request } from 'express';
import type pg from 'pg';
import { rutasCargas } from './cargas.ts';
import { rutasMontacargas } from './montacargas.ts';
import { validarColumnas } from '../shared/t1.ts';
import type { ColumnasAtct, ColumnasEspera } from '../shared/t1.ts';
import { validarColumnasWip } from '../shared/wip.ts';
import type { ColumnasWip } from '../shared/wip.ts';
import { validarColumnasFms } from '../shared/ofe.ts';
import type { ColumnasFms } from '../shared/ofe.ts';
import { ESQUEMA_BAJAS, validarColumnasBajas } from '../shared/bajas.ts';
import type { ColumnasBajas } from '../shared/bajas.ts';

// Rutas de datos de los módulos de Comando Central. Todas guardan en public.t1_cargas (ver src/server/cargas.ts).
interface UsuarioSesion { sub: string; nombre: string }
type Sesion = (req: Request) => UsuarioSesion | null;

// Cada tipo dice cómo están armadas sus columnas (ver Columnas* en src/shared): así las cargas se juntan día por día.

/** Seguimiento T1: ATCT.xlsx y ESPERA.xlsx. */
export const rutasT1 = (pool: pg.Pool | null, sesion: Sesion) => rutasCargas(pool, sesion, 'Seguimiento T1', {
  atct: {
    validar: d => validarColumnas(d, 'atct'), dias: (d: ColumnasAtct) => d.fecha,
    esquema: { filas: ['fecha', 'registro', 'ingreso', 'salida', 'dias', 'minutos'], indices: { placa: 'placas', ubicacion: 'ubicaciones', zona: 'zonas' } },
  },
  espera: {
    validar: d => validarColumnas(d, 'espera'), dias: (d: ColumnasEspera) => d.enturnamiento.map(s => Math.floor(s / 86_400)),
    esquema: { filas: ['programada', 'enturnamiento', 'inicio', 'fin', 'espera', 'atencion', 'ftct'], indices: { placa: 'placas', ubi: 'ubis' } },
  },
});

/** Seguimiento WIP: Data WIP.xlsx. */
export const rutasWip = (pool: pg.Pool | null, sesion: Sesion) => rutasCargas(pool, sesion, 'Seguimiento WIP', {
  wip: { validar: validarColumnasWip, dias: (d: ColumnasWip) => d.fecha, esquema: { filas: ['fecha', 'total'], grupos: ['estados'], indices: { cd: 'cds' } } },
});

/** OFE: Data FMS.xlsx y la lista de montacargas que se edita desde la página (/api/ofe/montacargas). */
export const rutasOfe = (pool: pg.Pool | null, sesion: Sesion) => {
  const router = rutasCargas(pool, sesion, 'OFE', {
    fms: { validar: validarColumnasFms, dias: (d: ColumnasFms) => d.fecha, esquema: { filas: ['ralenti', 'carga', 'movimiento', 'fecha', 'turno'], indices: { forklift: 'forklifts' } } },
  });
  router.use('/montacargas', rutasMontacargas(pool, sesion));
  return router;
};

/** Bajas: un Excel de SAP por mes; cada archivo llena las fechas contables que trae. */
export const rutasBajas = (pool: pg.Pool | null, sesion: Sesion) => rutasCargas(pool, sesion, 'Bajas', {
  bajas: { validar: validarColumnasBajas, dias: (d: ColumnasBajas) => d.fecha, esquema: ESQUEMA_BAJAS },
});
