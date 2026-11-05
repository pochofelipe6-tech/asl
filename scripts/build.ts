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
  await esbuild.build(opciones);
}
