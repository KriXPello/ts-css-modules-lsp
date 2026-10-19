const { mkdtemp, mkdir, writeFile, rm, realpath } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { URI } = require('vscode-uri');

async function workspace(t, files = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ts-css-modules-lsp-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Sass canonicalizes imported paths, including Windows 8.3 aliases in TEMP.
  const root = await realpath(directory);
  for (const [name, text] of Object.entries(files)) {
    const filePath = path.join(root, name);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, text);
  }
  return root;
}

function markedDocument(filePath, text, version = 1) {
  const marker = '/*cursor*/';
  const offset = text.indexOf(marker);
  if (offset < 0 || text.indexOf(marker, offset + marker.length) >= 0) {
    throw new Error('Expected exactly one /*cursor*/ marker');
  }
  const source = text.slice(0, offset) + text.slice(offset + marker.length);
  const document = TextDocument.create(URI.file(filePath).toString(), 'typescriptreact', version, source);
  return { document, position: document.positionAt(offset) };
}

function rangeOf(document, text) {
  const offset = document.getText().indexOf(text);
  if (offset < 0) throw new Error(`Text not found: ${text}`);
  return { start: document.positionAt(offset), end: document.positionAt(offset + text.length) };
}

module.exports = { workspace, markedDocument, rangeOf };
