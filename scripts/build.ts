// Compila el código del navegador (src/client) con anime.js incluido en public/js/.
//   node scripts/build.ts        → una vez (lo usa `npm start`)
//   node scripts/build.ts --dev  → recompila al guardar y arranca el servidor con --watch
import { spawn } from 'node:child_process';
import * as esbuild from 'esbuild';

const opciones: esbuild.BuildOptions = {
  entryPoints: ['src/client/login.ts', 'src/client/panel.ts'],
  outdir: 'public/js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  logLevel: 'info',
};

if (process.argv.includes('--dev')) {
  const ctx = await esbuild.context(opciones);
  await ctx.watch();

  const servidor = spawn(
    process.execPath,
    ['--watch', '--env-file-if-exists=.env.local', 'server.ts'],
    { stdio: 'inherit' },
  );
  servidor.on('exit', async code => {
    await ctx.dispose();
    process.exit(code ?? 0);
  });
} else {
  const comprobacion = spawn(process.execPath, ['node_modules/typescript/bin/tsc', '-p', '.'], { stdio: 'inherit' });
  const codigo = await new Promise<number>(resolve => {
    comprobacion.on('exit', code => resolve(code ?? 1));
    comprobacion.on('error', () => resolve(1));
  });
  if (codigo !== 0) process.exit(codigo);

  // Entrada JavaScript para Vercel; se mantiene en la raiz para conservar
  // las rutas a public/, views/ y datos/ basadas en import.meta.dirname.
  await esbuild.build({
    entryPoints: ['server.ts'],
    outfile: 'app.js',
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner: { js: '// Generado desde server.ts por npm run build. No editar directamente.' },
  });
  await esbuild.build(opciones);
}
