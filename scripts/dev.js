'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const backendDirectory = path.join(root, 'core-backend');
const frontendDirectory = path.join(root, 'core-frontend');
const services = [
  {
    name: 'Giftly API',
    cwd: backendDirectory,
    script: path.join(backendDirectory, 'node_modules', 'nodemon', 'bin', 'nodemon.js'),
    args: ['server.js'],
    env: { PORT: '5001', CORS_ORIGIN: 'http://localhost:5000' },
  },
  {
    name: 'Giftly web',
    cwd: frontendDirectory,
    script: path.join(frontendDirectory, 'node_modules', 'vite', 'bin', 'vite.js'),
    args: [],
    env: { VITE_API_BASE_URL: 'http://localhost:5001/api' },
  },
];

const children = [];
let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill();
  }
  setTimeout(() => process.exit(exitCode), 1000).unref();
}

for (const service of services) {
  const child = spawn(process.execPath, [service.script, ...service.args], {
    cwd: service.cwd,
    env: { ...process.env, ...service.env },
    stdio: 'inherit',
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(`[${service.name}] ${error.message}`);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`[${service.name}] stopped (${signal || code}).`);
      stop(code || 1);
    }
  });
}

process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));
