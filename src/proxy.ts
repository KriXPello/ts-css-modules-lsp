import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type Logger,
} from 'vscode-jsonrpc/node';
import type {
  DefinitionParams,
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  DidOpenTextDocumentParams,
  InitializeParams,
  InitializeResult,
} from 'vscode-languageserver-protocol';
import type { Config } from './config';
import { Definitions } from './definitions';

const logger: Logger = {
  error: (message) => console.error(`[ts-css-modules-lsp] ${message}`),
  warn: (message) => console.error(`[ts-css-modules-lsp] ${message}`),
  info: () => {},
  log: () => {},
};

export function startProxy(config: Config): void {
  const vtslsPath = config.vtslsPath ?? require.resolve('@vtsls/language-server/bin/vtsls.js');
  try {
    if (!statSync(vtslsPath).isFile()) throw new Error('Not a file');
  } catch (error) {
    throw new Error(`Cannot use vtsls entry point "${vtslsPath}": ${String(error)}`);
  }
  const child = spawn(process.execPath, [vtslsPath, '--stdio'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stderr.pipe(process.stderr);

  const editor = createMessageConnection(
    new StreamMessageReader(process.stdin),
    new StreamMessageWriter(process.stdout),
    logger,
  );
  const backend = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin),
    logger,
  );
  const definitions = new Definitions(config);
  let stopping = false;
  let shutdownRequested = false;
  let definitionLinks = false;

  function stop(): void {
    if (stopping) return;
    stopping = true;
    editor.dispose();

    const deadline = setTimeout(() => {
      child.kill();
      process.exit(0);
    }, 2000);
    deadline.unref();

    async function stopBackend(): Promise<void> {
      try {
        if (!shutdownRequested) await backend.sendRequest('shutdown');
        await backend.sendNotification('exit');
      } catch {
        child.kill();
      }
    }
    void stopBackend();
  }

  editor.onRequest(async (method, params, token) => {
    if (method === 'initialize') {
      const initialize = params as InitializeParams;
      definitionLinks = initialize.capabilities.textDocument?.definition?.linkSupport === true;
      const result = await backend.sendRequest<InitializeResult>('initialize', {
        ...initialize,
        capabilities: {
          ...initialize.capabilities,
          general: {
            ...initialize.capabilities.general,
            positionEncodings: ['utf-16'],
          },
        },
      }, token);
      return {
        ...result,
        capabilities: {
          ...result.capabilities,
          definitionProvider: true,
          positionEncoding: 'utf-16',
        },
        serverInfo: { name: 'ts-css-modules-lsp' },
      } satisfies InitializeResult;
    }

    if (method === 'shutdown') shutdownRequested = true;

    if (method === 'textDocument/definition') {
      try {
        const result = await definitions.find(params as DefinitionParams, token);
        if (result) {
          if (definitionLinks) return result;
          return result.map((link) => ({ uri: link.targetUri, range: link.targetSelectionRange }));
        }
      } catch (error) {
        logger.warn(`SCSS definition failed; using vtsls: ${String(error)}`);
      }
    }
    return backend.sendRequest(method, params, token);
  });

  editor.onNotification((method, params) => {
    if (method === 'exit') {
      stop();
      return;
    }
    try {
      switch (method) {
        case 'textDocument/didOpen':
          definitions.open(params as DidOpenTextDocumentParams);
          break;
        case 'textDocument/didChange':
          definitions.change(params as DidChangeTextDocumentParams);
          break;
        case 'textDocument/didClose':
          definitions.close(params as DidCloseTextDocumentParams);
          break;
      }
    } catch (error) {
      logger.warn(`Cannot update document: ${String(error)}`);
    }
    void backend.sendNotification(method, params).catch((error: unknown) => logger.error(String(error)));
  });

  backend.onRequest((method, params, token) => editor.sendRequest(method, params, token));
  backend.onNotification((method, params) => {
    void editor.sendNotification(method, params).catch((error: unknown) => logger.error(String(error)));
  });

  // vscode-jsonrpc consumes $/progress before the catch-all notification handler.
  editor.onUnhandledProgress((params) => {
    void backend.sendNotification('$/progress', params).catch((error: unknown) => logger.error(String(error)));
  });
  backend.onUnhandledProgress((params) => {
    void editor.sendNotification('$/progress', params).catch((error: unknown) => logger.error(String(error)));
  });

  editor.onClose(stop);
  editor.onError(([error]) => logger.error(String(error)));
  backend.onError(([error]) => logger.error(String(error)));
  child.on('error', (error) => {
    logger.error(`Cannot start vtsls: ${String(error)}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    backend.dispose();
    if (stopping) process.exit(0);
    logger.error(`vtsls exited unexpectedly (code=${code}, signal=${signal})`);
    process.exit(1);
  });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.stdin.on('end', stop);

  backend.listen();
  editor.listen();
}
