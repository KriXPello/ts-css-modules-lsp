import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ClassnameTransform, StyleOptions } from './style-types';

export interface Config extends StyleOptions {
  aliases: Record<string, string[]>;
  basePath: string;
  vtslsPath?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value;
}

export async function readConfig(configPath?: string): Promise<Config> {
  const config: Config = {
    loadPaths: [],
    classnameTransform: 'asIs',
    aliases: {},
    basePath: process.cwd(),
  };
  if (!configPath) return config;

  const absolutePath = path.resolve(configPath);
  const value: unknown = JSON.parse(await readFile(absolutePath, 'utf8'));
  if (!isRecord(value)) throw new Error('Configuration must be a JSON object');
  config.basePath = path.dirname(absolutePath);

  for (const key of Object.keys(value)) {
    if (!['loadPaths', 'classnameTransform', 'aliases', 'vtslsPath'].includes(key)) {
      throw new Error(`Unknown configuration option: ${key}`);
    }
  }

  if (value.loadPaths !== undefined) {
    config.loadPaths = stringArray(value.loadPaths, 'loadPaths').map((item) =>
      path.resolve(config.basePath, item),
    );
  }

  if (value.classnameTransform !== undefined) {
    const transforms: ClassnameTransform[] = [
      'asIs', 'camelCase', 'camelCaseOnly', 'dashes', 'dashesOnly',
    ];
    if (!transforms.includes(value.classnameTransform as ClassnameTransform)) {
      throw new Error(`Invalid classnameTransform: ${String(value.classnameTransform)}`);
    }
    config.classnameTransform = value.classnameTransform as ClassnameTransform;
  }

  if (value.aliases !== undefined) {
    if (!isRecord(value.aliases)) throw new Error('aliases must be an object');
    for (const [name, targets] of Object.entries(value.aliases)) {
      config.aliases[name] = stringArray(targets, `aliases.${name}`).map((target) =>
        path.resolve(config.basePath, target),
      );
    }
  }

  if (value.vtslsPath !== undefined) {
    if (typeof value.vtslsPath !== 'string' || !value.vtslsPath.trim()) {
      throw new Error('vtslsPath must be a non-empty path to a vtsls Node.js entry point');
    }
    config.vtslsPath = path.resolve(config.basePath, value.vtslsPath);
  }
  return config;
}
