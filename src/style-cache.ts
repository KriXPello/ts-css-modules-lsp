import { stat } from 'node:fs/promises';
import type { StyleAnalysis, StyleOptions } from './style-types';
import { analyzeStyles } from './styles';

interface FileState {
  modified: number;
  size: number;
}

interface CacheEntry {
  analysis: StyleAnalysis;
  files: Map<string, FileState>;
  stable: boolean;
}

async function fileState(filePath: string): Promise<FileState> {
  const info = await stat(filePath);
  return { modified: info.mtimeMs, size: info.size };
}

export class StyleCache {
  private readonly entries = new Map<string, Promise<CacheEntry>>();

  constructor(private readonly options: StyleOptions) {}

  async get(filePath: string): Promise<StyleAnalysis> {
    while (true) {
      const existing = this.entries.get(filePath);
      if (!existing) break;
      let analysis: StyleAnalysis | undefined;
      try {
        const entry = await existing;
        if (entry.stable) {
          const checks = await Promise.all(
            [...entry.files].map(async ([dependency, previous]) => {
              const current = await fileState(dependency);
              return current.modified === previous.modified && current.size === previous.size;
            }),
          );
          if (checks.every(Boolean)) {
            analysis = entry.analysis;
          }
        }
      } catch {
        // Missing dependencies or failed compilations must not poison the cache.
      }

      // Another request may have replaced or evicted this entry while we awaited it.
      if (this.entries.get(filePath) !== existing) continue;
      if (analysis) {
        this.entries.delete(filePath);
        this.entries.set(filePath, existing);
        return analysis;
      }
      this.entries.delete(filePath);
      break;
    }

    const entry = this.compile(filePath);
    this.entries.set(filePath, entry);
    while (this.entries.size > 32) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }

    try {
      return (await entry).analysis;
    } catch (error) {
      if (this.entries.get(filePath) === entry) this.entries.delete(filePath);
      throw error;
    }
  }

  private async compile(filePath: string): Promise<CacheEntry> {
    const started = Date.now();
    const analysis = await analyzeStyles(filePath, this.options);
    const files = new Map(
      await Promise.all(
        [...analysis.dependencies].map(async (dependency) =>
          [dependency, await fileState(dependency)] as const,
        ),
      ),
    );
    // A save during compilation needs a fresh index on the next request.
    const stable = [...files.values()].every((state) => state.modified < started);
    return { analysis, files, stable };
  }
}
