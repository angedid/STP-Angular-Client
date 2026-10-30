#!/usr/bin/env node
/**
 * Starts the local demo in one command: the test provider
 * (`tools/mock-oauth-server/server.mjs`) and the Angular dev server with the
 * `demo` configuration (`src/environments/environment.demo.ts`).
 *
 *   npm run demo
 *
 * Both processes share this terminal and stop together (Ctrl+C). Environment
 * variables of the provider (ACCESS_TOKEN_TTL, FAIL_LOGOUT, ...) are passed
 * through. Equivalent to running `npm run mock:auth` and `npm run start:demo`
 * in two terminals.
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;

const children = [
  spawn(node, [join(root, 'tools', 'mock-oauth-server', 'server.mjs')], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  }),
  spawn(
    node,
    [join(root, 'node_modules', '@angular', 'cli', 'bin', 'ng.js'), 'serve', '--configuration', 'demo'],
    { cwd: root, stdio: 'inherit', env: process.env },
  ),
];

let stopping = false;
function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 200).unref();
}

for (const child of children) {
  child.on('exit', (code) => stopAll(code ?? 0));
  child.on('error', (error) => {
    console.error(`[local-demo] ${error.message}`);
    stopAll(1);
  });
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stopAll(0));
}
