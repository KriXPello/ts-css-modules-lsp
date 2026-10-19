import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createMatchPath } from 'tsconfig-paths';
import type { Config } from './config';

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

interface ProjectConfig {
  configPath: string;
  options: ts.CompilerOptions;
}

function canonicalPath(filePath: string): string {
  const absolutePath = path.resolve(filePath);
  if (ts.sys.useCaseSensitiveFileNames) return absolutePath;
  return absolutePath.toLowerCase();
}

function selectProjectConfig(configPath: string, importer: string): ProjectConfig | undefined {
  const visited = new Set<string>();
  const importerPath = canonicalPath(importer);
  let nearest: ProjectConfig | undefined;

  function visit(currentPath: string): ProjectConfig | undefined {
    const key = canonicalPath(currentPath);
    if (visited.has(key)) return undefined;
    visited.add(key);

    const parsed = ts.getParsedCommandLineOfConfigFile(currentPath, {}, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: () => {},
    });
    if (!parsed) return undefined;

    const current = { configPath: currentPath, options: parsed.options };
    if (!nearest) nearest = current;
    if (parsed.fileNames.some((fileName) => canonicalPath(fileName) === importerPath)) {
      return current;
    }

    for (const reference of parsed.projectReferences ?? []) {
      const owner = visit(ts.resolveProjectReferencePath(reference));
      if (owner) return owner;
    }
    return undefined;
  }

  // Keep the nearest config as fallback, never an unrelated referenced project's aliases.
  return visit(configPath) ?? nearest;
}

export function resolveStyleModule(
  moduleName: string,
  importer: string,
  config: Config,
): string | undefined {
  const directory = path.dirname(importer);
  if (moduleName.startsWith('.') || path.isAbsolute(moduleName)) {
    const candidate = path.resolve(directory, moduleName);
    if (isFile(candidate)) return candidate;
    return undefined;
  }

  const externalMatch = createMatchPath(config.basePath, config.aliases, ['main'], false);
  const external = externalMatch(moduleName, undefined, isFile, ['.scss', '.sass', '.css']);
  if (external && isFile(external)) return path.resolve(external);

  let configPath: string | undefined;
  for (let current = directory; ; current = path.dirname(current)) {
    const typescriptConfig = path.join(current, 'tsconfig.json');
    const javascriptConfig = path.join(current, 'jsconfig.json');
    if (ts.sys.fileExists(typescriptConfig)) {
      configPath = typescriptConfig;
      break;
    }
    if (ts.sys.fileExists(javascriptConfig)) {
      configPath = javascriptConfig;
      break;
    }
    if (path.dirname(current) === current) break;
  }
  if (!configPath) return undefined;

  const project = selectProjectConfig(configPath, importer);
  if (!project) return undefined;

  const options = project.options;
  let basePath = path.dirname(project.configPath);
  if (typeof options.pathsBasePath === 'string') basePath = options.pathsBasePath;
  if (options.baseUrl) basePath = options.baseUrl;

  const match = createMatchPath(basePath, options.paths ?? {}, ['main'], !!options.baseUrl);
  const candidate = match(moduleName, undefined, isFile, ['.scss', '.sass', '.css']);
  if (candidate && isFile(candidate)) return path.resolve(candidate);
  return undefined;
}
