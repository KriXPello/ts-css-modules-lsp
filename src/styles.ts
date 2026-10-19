import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import camelCase from 'lodash.camelcase';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { extractICSS } from 'icss-utils';
import localByDefault from 'postcss-modules-local-by-default';
import extractImports from 'postcss-modules-extract-imports';
import modulesScope from 'postcss-modules-scope';
import * as sass from 'sass';
import { SourceMapConsumer } from 'source-map-js';
import { SourceIndex } from './source-index';
import type { StyleAnalysis, StyleOptions, SourceLocation } from './style-types';

interface Candidate {
  name: string;
  filePath: string;
  line: number;
  start: number;
  end: number;
}

function transformedNames(name: string, mode: StyleOptions['classnameTransform']): string[] {
  const dashes = name.replace(/-+(\w)/g, (_match, letter: string) => letter.toUpperCase());
  const camel = camelCase(name);
  switch (mode) {
    case 'asIs': return [name];
    case 'camelCase': return [...new Set([name, camel])];
    case 'camelCaseOnly': return [camel];
    case 'dashes': return [...new Set([name, dashes])];
    case 'dashesOnly': return [dashes];
  }
}

function isLocalClass(node: selectorParser.ClassName): boolean {
  const ancestors: selectorParser.Node[] = [];
  let current: selectorParser.Node | undefined = node;
  while (current) {
    ancestors.unshift(current);
    current = current.parent as selectorParser.Node | undefined;
  }
  let mode: 'local' | 'global' = 'local';
  for (const item of ancestors) {
    const parent = item.parent;
    if (!parent) continue;
    if (parent.type === 'pseudo') {
      if (parent.value === ':global') mode = 'global';
      if (parent.value === ':local') mode = 'local';
    }
    if (parent.type === 'selector') {
      for (const sibling of parent.nodes) {
        if (sibling === item) break;
        if (sibling.type !== 'pseudo' || sibling.nodes?.length) continue;
        if (sibling.value === ':global') mode = 'global';
        if (sibling.value === ':local') mode = 'local';
      }
    }
  }
  return mode === 'local';
}

export async function analyzeStyles(filePath: string, options: StyleOptions): Promise<StyleAnalysis> {
  const absolutePath = path.resolve(filePath);
  const source = await readFile(absolutePath, 'utf8');
  const isCss = absolutePath.endsWith('.module.css');
  const rootUrl = pathToFileURL(absolutePath);
  const dependencies = new Set<string>([absolutePath]);
  let css = source;
  let sourceMap: string | undefined;

  if (!isCss) {
    const loadPaths = [...options.loadPaths, path.dirname(absolutePath)];
    for (let directory = path.dirname(absolutePath); ; directory = path.dirname(directory)) {
      loadPaths.push(path.join(directory, 'node_modules'));
      if (path.dirname(directory) === directory) break;
    }
    let syntax: 'scss' | 'indented' = 'scss';
    if (absolutePath.endsWith('.module.sass')) syntax = 'indented';
    const result = await sass.compileStringAsync(source, {
      url: rootUrl,
      sourceMap: true,
      loadPaths,
      syntax,
    });
    css = result.css;
    sourceMap = result.sourceMap ? JSON.stringify(result.sourceMap) : undefined;
    for (const url of result.loadedUrls) {
      if (url.protocol === 'file:') dependencies.add(path.resolve(fileURLToPath(url)));
    }
  }

  const consumer = sourceMap ? new SourceMapConsumer(JSON.parse(sourceMap)) : undefined;
  const originalSources = new Map<string, SourceIndex>();
  originalSources.set(absolutePath, new SourceIndex(absolutePath, source));
  if (consumer) {
    for (const sourceName of consumer.sources) {
      const sourcePath = sourceName.startsWith('file:') ? path.resolve(fileURLToPath(sourceName)) : path.resolve(path.dirname(absolutePath), sourceName);
      if (sourcePath === absolutePath) continue;
      try {
        originalSources.set(sourcePath, new SourceIndex(sourcePath, await readFile(sourcePath, 'utf8')));
      } catch {
        // A mapped source without readable text cannot provide a trustworthy location.
      }
    }
  }
  const candidates: Candidate[] = [];
  const generatedRoot = postcss.parse(css, { from: absolutePath });
  generatedRoot.walkRules((rule) => {
    const ruleStart = rule.source?.start;
    if (!ruleStart) return;
    selectorParser((selectors) => {
      selectors.walkClasses((node) => {
        if (!isLocalClass(node)) return;
        const nodeStart = node.source?.start;
        if (!nodeStart) return;
        const generatedLine = ruleStart.line + nodeStart.line - 1;
        let generatedColumn = nodeStart.column;
        if (nodeStart.line === 1) generatedColumn += ruleStart.column - 1;
        let targetPath = absolutePath;
        let targetLine = generatedLine;
        let targetColumn = generatedColumn;

        if (consumer) {
          const mapped = consumer.originalPositionFor({ line: generatedLine, column: generatedColumn - 1 });
          if (!mapped.source || !mapped.line || mapped.column === null) return;
          if (mapped.source.startsWith('file:')) {
            targetPath = path.resolve(fileURLToPath(mapped.source));
          } else {
            targetPath = path.resolve(path.dirname(absolutePath), mapped.source);
          }
          targetLine = mapped.line;
          targetColumn = mapped.column + 1;
        }

        const original = originalSources.get(targetPath);
        if (!original) return;
        const range = original.locate(node.value, targetLine, targetColumn);
        candidates.push({
          name: node.value,
          filePath: targetPath,
          line: range.start.line + 1,
          start: range.start.character,
          end: range.end.character,
        });
      });
    }).processSync(rule.selector);
  });

  const processor = postcss([localByDefault(), extractImports(), modulesScope({ generateScopedName: (name) => name })]);
  const processed = await processor.process(css, { from: absolutePath, map: false });
  const moduleExports = extractICSS(processed.root).icssExports;
  const analysis: StyleAnalysis = { exports: new Map(), dependencies };

  for (const [exportName] of Object.entries(moduleExports)) {
    if (!candidates.some((candidate) => candidate.name === exportName)) continue;
    const locations: SourceLocation[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.name !== exportName) continue;
      const key = `${candidate.filePath}:${candidate.line}:${candidate.start}:${candidate.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      locations.push({
        filePath: candidate.filePath,
        range: {
          start: { line: candidate.line - 1, character: candidate.start },
          end: { line: candidate.line - 1, character: candidate.end },
        },
      });
    }
    for (const transformed of transformedNames(exportName, options.classnameTransform)) {
      if (locations.length) analysis.exports.set(transformed, [...(analysis.exports.get(transformed) ?? []), ...locations]);
    }
  }
  return analysis;
}
