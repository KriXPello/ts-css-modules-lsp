import type { CancellationToken } from 'vscode-jsonrpc';
import type {
  DefinitionParams,
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  DidOpenTextDocumentParams,
  LocationLink,
} from 'vscode-languageserver-protocol';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import type { Config } from './config';
import { resolveStyleModule } from './resolve-module';
import { StyleCache } from './style-cache';
import { getModuleReference } from './ts-reference';

export class Definitions {
  private readonly documents = new Map<string, TextDocument>();
  private readonly styles: StyleCache;

  constructor(private readonly config: Config) {
    this.styles = new StyleCache(config);
  }

  open(params: DidOpenTextDocumentParams): void {
    const doc = params.textDocument;
    if (!/\.[cm]?[jt]sx?$/i.test(URI.parse(doc.uri).path)) return;
    this.documents.set(doc.uri, TextDocument.create(doc.uri, doc.languageId, doc.version, doc.text));
  }

  change(params: DidChangeTextDocumentParams): void {
    const previous = this.documents.get(params.textDocument.uri);
    if (!previous) return;
    this.documents.set(
      previous.uri,
      TextDocument.update(previous, params.contentChanges, params.textDocument.version),
    );
  }

  close(params: DidCloseTextDocumentParams): void {
    this.documents.delete(params.textDocument.uri);
  }

  async find(params: DefinitionParams, token: CancellationToken): Promise<LocationLink[] | null> {
    const document = this.documents.get(params.textDocument.uri);
    if (!document || token.isCancellationRequested) return null;
    const reference = getModuleReference(document, params.position);
    if (!reference) return null;

    const filePath = resolveStyleModule(reference.moduleName, URI.parse(document.uri).fsPath, this.config);
    if (!filePath || token.isCancellationRequested) return null;
    const analysis = await this.styles.get(filePath);
    if (token.isCancellationRequested) return null;
    const locations = analysis.exports.get(reference.exportName);
    if (!locations?.length) return null;

    return locations.map((location) => ({
      originSelectionRange: reference.originRange,
      targetUri: URI.file(location.filePath).toString(),
      targetRange: location.range,
      targetSelectionRange: location.range,
    }));
  }
}
