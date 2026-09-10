/**
 * A Node module-customization hook that compiles .tsx through esbuild.
 *
 * Node strips TypeScript types from .ts on its own, but it does not transform
 * JSX — so component files cannot be imported by `node --test` without this.
 * esbuild is already present as a Vite dependency, so this adds nothing new to
 * install.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

export async function load(url, context, nextLoad) {
  if (url.endsWith('.tsx')) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    const { code } = await transform(source, {
      loader: 'tsx',
      format: 'esm',
      target: 'es2022',
      jsx: 'automatic',
      sourcefile: url,
    });
    return { format: 'module', source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
