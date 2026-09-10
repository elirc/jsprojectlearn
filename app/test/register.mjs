/**
 * Enables the JSX loader for `node --test`.
 * Used via `node --import ./app/test/register.mjs --test`.
 */
import { register } from 'node:module';

register('./jsx-hooks.mjs', import.meta.url);
