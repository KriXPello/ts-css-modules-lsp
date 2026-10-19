const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { CancellationToken, CancellationTokenSource } = require('vscode-jsonrpc');
const { URI } = require('vscode-uri');
const { Definitions } = require('../dist/definitions.js');
const { readConfig } = require('../dist/config.js');
const { workspace, markedDocument, rangeOf } = require('./helpers.cjs');

function open(definitions, filePath, source, version = 1) {
  const { document, position } = markedDocument(filePath, source, version);
  definitions.open({
    textDocument: {
      uri: document.uri, languageId: document.languageId, version, text: document.getText(),
    },
  });
  return { document, params: { textDocument: { uri: document.uri }, position } };
}

for (const [extension, source, endCharacter] of [
  ['css', '.card { color: red; }', 5],
  ['scss', '.card { color: red; }', 5],
  ['sass', '.card\n  color: red\n', 0],
]) {
  test(`finds a class in ${extension} with an exact LocationLink`, async (t) => {
    const root = await workspace(t, { [`theme.module.${extension}`]: source });
    const definitions = new Definitions(await readConfig());
    const { document, params } = open(definitions, path.join(root, 'component.tsx'),
      `import styles from './theme.module.${extension}';\nstyles.ca/*cursor*/rd;`);
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: endCharacter } };
    assert.deepEqual(await definitions.find(params, CancellationToken.None), [{
      originSelectionRange: rangeOf(document, 'card'),
      targetUri: URI.file(path.join(root, `theme.module.${extension}`)).toString(),
      targetRange: range,
      targetSelectionRange: range,
    }]);
  });
}

test('opens the file from an import binding without compiling invalid Sass', async (t) => {
  const root = await workspace(t, { 'theme.module.scss': '.card { color: $undefined; }' });
  const definitions = new Definitions(await readConfig());
  const { document, params } = open(definitions, path.join(root, 'component.tsx'),
    "import st/*cursor*/yles from './theme.module.scss';");
  const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  assert.deepEqual(await definitions.find(params, CancellationToken.None), [{
    originSelectionRange: rangeOf(document, 'styles'),
    targetUri: URI.file(path.join(root, 'theme.module.scss')).toString(),
    targetRange: range,
    targetSelectionRange: range,
  }]);
});

test('applies aliases and classname transforms through the full definition pipeline', async (t) => {
  const root = await workspace(t, { 'styles/theme.module.css': '.card-title { color: red; }' });
  const definitions = new Definitions({
    ...await readConfig(), basePath: root, aliases: { '@/*': ['styles/*'] }, classnameTransform: 'dashesOnly',
  });
  const { params } = open(definitions, path.join(root, 'component.tsx'),
    "import styles from '@/theme.module.css'; styles.card/*cursor*/Title;");
  const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 11 } };
  const result = await definitions.find(params, CancellationToken.None);
  assert.equal(result.length, 1);
  assert.equal(result[0].targetUri, URI.file(path.join(root, 'styles/theme.module.css')).toString());
  assert.deepEqual(result[0].targetSelectionRange, range);
});

test('returns all definitions of the same class', async (t) => {
  const root = await workspace(t, { 'theme.module.css': '.card {}\n@media (min-width: 1px) {\n  .card {}\n}' });
  const definitions = new Definitions(await readConfig());
  const { params } = open(definitions, path.join(root, 'component.tsx'),
    "import styles from './theme.module.css'; styles.ca/*cursor*/rd;");
  const result = await definitions.find(params, CancellationToken.None);
  assert.deepEqual(result.map((link) => link.targetSelectionRange), [
    { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
    { start: { line: 2, character: 2 }, end: { line: 2, character: 7 } },
  ]);
});

test('returns null for unsupported references, missing files and missing exports', async (t) => {
  const root = await workspace(t, { 'theme.module.css': '.card {}' });
  const definitions = new Definitions(await readConfig());
  for (const source of [
    "import styles from './missing.module.css'; styles.ca/*cursor*/rd;",
    "import st/*cursor*/yles from './missing.module.css';",
    "import styles from './theme.module.css'; styles.mis/*cursor*/sing;",
    'const styles = { card: true }; styles.ca/*cursor*/rd;',
  ]) {
    const { params } = open(definitions, path.join(root, 'component.tsx'), source);
    assert.equal(await definitions.find(params, CancellationToken.None), null);
  }
});

test('propagates compilation errors so the proxy can fall back to vtsls', async (t) => {
  const root = await workspace(t, { 'theme.module.scss': '.card { color: $undefined; }' });
  const definitions = new Definitions(await readConfig());
  const { params } = open(definitions, path.join(root, 'component.tsx'),
    "import styles from './theme.module.scss'; styles.ca/*cursor*/rd;");
  await assert.rejects(definitions.find(params, CancellationToken.None), /Undefined variable/);
});

test('uses unsaved incremental and full document changes, and forgets closed documents', async (t) => {
  const root = await workspace(t, { 'theme.module.css': '.card {}\n.title {}' });
  const definitions = new Definitions(await readConfig());
  const { document, params } = open(definitions, path.join(root, 'component.tsx'),
    "import styles from './theme.module.css';\nstyles./*cursor*/card;");
  const first = await definitions.find(params, CancellationToken.None);
  assert.equal(first[0].targetSelectionRange.start.line, 0);

  definitions.change({
    textDocument: { uri: document.uri, version: 2 },
    contentChanges: [{ range: rangeOf(document, 'card'), text: 'title' }],
  });
  const changed = await definitions.find(params, CancellationToken.None);
  assert.equal(changed[0].targetSelectionRange.start.line, 1);

  definitions.change({
    textDocument: { uri: document.uri, version: 3 },
    contentChanges: [{ text: document.getText() }],
  });
  const replaced = await definitions.find(params, CancellationToken.None);
  assert.deepEqual(replaced, first);

  definitions.close({ textDocument: { uri: document.uri } });
  definitions.change({
    textDocument: { uri: document.uri, version: 4 }, contentChanges: [{ text: document.getText() }],
  });
  assert.equal(await definitions.find(params, CancellationToken.None), null);
});

test('ignores documents that were not opened or have unsupported extensions', async (t) => {
  const root = await workspace(t, { 'theme.module.css': '.card {}' });
  const definitions = new Definitions(await readConfig());
  const { document, position } = markedDocument(path.join(root, 'component.tsx'),
    "import styles from './theme.module.css'; styles.ca/*cursor*/rd;");
  assert.equal(await definitions.find({ textDocument: { uri: document.uri }, position }, CancellationToken.None), null);
  const { params } = open(definitions, path.join(root, 'component.vue'),
    "import styles from './theme.module.css'; styles.ca/*cursor*/rd;");
  assert.equal(await definitions.find(params, CancellationToken.None), null);
});

test('does not return definitions for cancelled requests, including cancellation during analysis', async (t) => {
  const root = await workspace(t, { 'theme.module.scss': '.card { color: red; }' });
  const definitions = new Definitions(await readConfig());
  const { params } = open(definitions, path.join(root, 'component.tsx'),
    "import styles from './theme.module.scss'; styles.ca/*cursor*/rd;");
  assert.equal(await definitions.find(params, CancellationToken.Cancelled), null);
  const cancellation = new CancellationTokenSource();
  t.after(() => cancellation.dispose());
  const pending = definitions.find(params, cancellation.token);
  cancellation.cancel();
  assert.equal(await pending, null);
});
