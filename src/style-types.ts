import type { Range } from 'vscode-languageserver-protocol';

export type ClassnameTransform =
  | 'asIs'
  | 'camelCase'
  | 'camelCaseOnly'
  | 'dashes'
  | 'dashesOnly';

export interface StyleOptions {
  loadPaths: string[];
  classnameTransform: ClassnameTransform;
}

export interface SourceLocation {
  filePath: string;
  range: Range;
}

export interface StyleAnalysis {
  exports: Map<string, SourceLocation[]>;
  dependencies: Set<string>;
}
