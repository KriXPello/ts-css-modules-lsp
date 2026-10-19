#!/usr/bin/env node
import path from 'node:path';
import { readConfig } from './config';
import { startProxy } from './proxy';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let configPath: string | undefined;
  let vtslsPath: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    switch (argument) {
      case '--stdio':
        break;
      case '--config':
        configPath = args[++index];
        if (!configPath || configPath.startsWith('--')) {
          throw new Error('--config requires a JSON file path');
        }
        break;
      case '--vtsls':
        vtslsPath = args[++index];
        if (!vtslsPath?.trim() || vtslsPath.startsWith('--')) {
          throw new Error('--vtsls requires a path to a vtsls Node.js entry point');
        }
        break;
      case '--help':
      case '-h':
        console.log([
          'Usage: ts-css-modules-lsp [--stdio] [--config <file.json>] [--vtsls <entry.js>]',
          '',
          'A vtsls proxy with CSS Modules source definitions.',
          '',
          '--vtsls <entry.js>  Use a custom vtsls Node.js entry point instead of the bundled version.',
          '                   Overrides vtslsPath in the configuration file.',
        ].join('\n'));
        return;
      case '--version':
      case '-v':
        console.log((require('../package.json') as { version: string }).version);
        return;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }
  const config = await readConfig(configPath);
  if (vtslsPath) config.vtslsPath = path.resolve(vtslsPath);
  startProxy(config);
}

void main().catch((error: unknown) => {
  console.error(`[ts-css-modules-lsp] ${String(error)}`);
  process.exitCode = 1;
});
