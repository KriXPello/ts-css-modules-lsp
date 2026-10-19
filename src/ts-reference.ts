import ts from 'typescript';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { Position, Range } from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';

export interface ModuleReference {
  moduleName: string;
  exportName: string;
  originRange: Range;
}

interface CachedProgram {
  key: string;
  sourceFile: ts.SourceFile;
  program: ts.Program;
  checker: ts.TypeChecker;
}

const programCache = new Map<string, CachedProgram>();
const maxCachedPrograms = 8;

export function getModuleReference(document: TextDocument, position: Position): ModuleReference | null {
  let filePath: string;
  try {
    const uri = URI.parse(document.uri);
    if (uri.scheme !== 'file') return null;
    filePath = ts.sys.resolvePath(uri.fsPath);
  } catch {
    return null;
  }

  const extension = filePath.toLowerCase();
  if (!/\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(extension)) return null;

  let scriptKind = ts.ScriptKind.TS;
  if (extension.endsWith('.tsx')) {
    scriptKind = ts.ScriptKind.TSX;
  } else if (extension.endsWith('.jsx')) {
    scriptKind = ts.ScriptKind.JSX;
  } else if (extension.endsWith('.js') || extension.endsWith('.mjs') || extension.endsWith('.cjs')) {
    scriptKind = ts.ScriptKind.JS;
  }
  const key = `${document.uri}\0${document.version}\0${document.getText()}`;
  let cached = programCache.get(document.uri);
  if (!cached || cached.key !== key) {
    const sourceText = document.getText();
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
    const options: ts.CompilerOptions = {
      noLib: true,
      noResolve: true,
      noEmit: true,
      allowJs: true,
      checkJs: false,
    };
    const host: ts.CompilerHost = {
      getSourceFile: (name) => {
        if (ts.sys.resolvePath(name) === filePath) return sourceFile;
        return undefined;
      },
      getDefaultLibFileName: () => '',
      writeFile: () => undefined,
      getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
      getDirectories: (path) => ts.sys.getDirectories(path),
      fileExists: (name) => ts.sys.resolvePath(name) === filePath,
      readFile: (name) => {
        if (ts.sys.resolvePath(name) === filePath) return sourceText;
        return undefined;
      },
      getCanonicalFileName: (name) => name,
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
      getNewLine: () => ts.sys.newLine,
    };
    const program = ts.createProgram([filePath], options, host);
    cached = { key, sourceFile, program, checker: program.getTypeChecker() };
    programCache.delete(document.uri);
    programCache.set(document.uri, cached);
    while (programCache.size > maxCachedPrograms) {
      const oldest = programCache.keys().next().value;
      if (oldest === undefined) break;
      programCache.delete(oldest);
    }
  } else {
    programCache.delete(document.uri);
    programCache.set(document.uri, cached);
  }

  const sourceFile = cached.sourceFile;
  const checker = cached.checker;
  const offset = document.offsetAt(position);
  let target: ts.Node | undefined;
  const findTarget = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.PropertyAccessExpression) {
      const access = node as ts.PropertyAccessExpression;
      if (offset >= access.name.getStart(sourceFile) && offset <= access.name.end) target = access;
    } else if (node.kind === ts.SyntaxKind.ElementAccessExpression) {
      const access = node as ts.ElementAccessExpression;
      const argument = access.argumentExpression;
      if (argument && ts.isStringLiteralLike(argument)
        && offset >= argument.getStart(sourceFile) && offset <= argument.end) target = access;
    }
    if (!target) ts.forEachChild(node, findTarget);
  };
  findTarget(sourceFile);
  if (!target) return null;

  const receiver = (target as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression;
  const receiverSymbol = checker.getSymbolAtLocation(receiver);
  if (!receiverSymbol) return null;
  const declaration = receiverSymbol.declarations?.find((item) =>
    ts.isImportClause(item) && !!item.name && !item.isTypeOnly
      && ts.isImportDeclaration(item.parent) && ts.isStringLiteral(item.parent.moduleSpecifier)
      && /\.module\.(?:scss|sass|css)$/i.test(item.parent.moduleSpecifier.text),
  );
  if (!declaration || !ts.isImportClause(declaration) || !declaration.name) return null;

  const importDeclaration = declaration.parent as ts.ImportDeclaration;
  let originNode: ts.Node;
  let exportName: string;
  if (ts.isPropertyAccessExpression(target)) {
    originNode = target.name;
    exportName = target.name.text;
  } else {
    const argument = (target as ts.ElementAccessExpression).argumentExpression;
    if (!argument || !ts.isStringLiteralLike(argument)) return null;
    originNode = argument;
    exportName = argument.text;
  }
  if (!ts.isStringLiteral(importDeclaration.moduleSpecifier)) return null;
  const originStart = originNode.getStart(sourceFile);
  const originEnd = originNode.end;
  return {
    moduleName: importDeclaration.moduleSpecifier.text,
    exportName,
    originRange: {
      start: document.positionAt(originStart),
      end: document.positionAt(originEnd),
    },
  };
}
