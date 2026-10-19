const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readConfig } = require('../dist/config.js');
const { workspace } = require('./helpers.cjs');

test('config defaults without a file', async () => {
  assert.deepEqual(await readConfig(), {
    loadPaths: [], classnameTransform: 'asIs', aliases: {}, basePath: process.cwd(),
  });
});

test('config resolves relative paths against config directory and preserves absolute paths', async (t) => {
  const root = await workspace(t, { 'config.json': JSON.stringify({
    loadPaths: ['styles', path.resolve('absolute-styles')],
    aliases: { '@theme': ['themes/default', path.resolve('absolute-theme')] },
    vtslsPath: 'node_modules/vtsls/index.js',
  }) });
  assert.deepEqual(await readConfig(path.join(root, 'config.json')), {
    loadPaths: [path.join(root, 'styles'), path.resolve('absolute-styles')],
    classnameTransform: 'asIs',
    aliases: { '@theme': [path.join(root, 'themes/default'), path.resolve('absolute-theme')] },
    basePath: root,
    vtslsPath: path.join(root, 'node_modules/vtsls/index.js'),
  });
});

test('accepts each supported classname transform', async (t) => {
  for (const classnameTransform of ['asIs', 'camelCase', 'camelCaseOnly', 'dashes', 'dashesOnly']) {
    const root = await workspace(t, { 'config.json': JSON.stringify({ classnameTransform }) });
    assert.equal((await readConfig(path.join(root, 'config.json'))).classnameTransform, classnameTransform);
  }
});

test('rejects malformed, unknown, and invalid configuration values', async (t) => {
  const cases = [
    ['null.json', 'null', /Configuration must be a JSON object/],
    ['scalar.json', '42', /Configuration must be a JSON object/],
    ['array.json', '[]', /Configuration must be a JSON object/],
    ['unknown.json', JSON.stringify({ other: true }), /Unknown configuration option/],
    ['loadpaths.json', JSON.stringify({ loadPaths: 'styles' }), /loadPaths must be an array of strings/],
    ['loadpath-entry.json', JSON.stringify({ loadPaths: ['styles', 1] }), /loadPaths must be an array of strings/],
    ['aliases.json', JSON.stringify({ aliases: [] }), /aliases must be an object/],
    ['targets.json', JSON.stringify({ aliases: { '@': [1] } }), /aliases\.@ must be an array of strings/],
    ['transform.json', JSON.stringify({ classnameTransform: 'invalid' }), /Invalid classnameTransform/],
    ['transform-type.json', JSON.stringify({ classnameTransform: 1 }), /Invalid classnameTransform/],
    ['vtsls.json', JSON.stringify({ vtslsPath: '  ' }), /vtslsPath must be a non-empty path/],
    ['vtsls-type.json', JSON.stringify({ vtslsPath: 42 }), /vtslsPath must be a non-empty path/],
    ['malformed.json', '{', /JSON/],
  ];
  const files = Object.fromEntries(cases.map(([name, contents]) => [name, contents]));
  const root = await workspace(t, files);
  for (const [name, , error] of cases) {
    await assert.rejects(readConfig(path.join(root, name)), error, name);
  }
  await assert.rejects(readConfig(path.join(root, 'missing.json')), /ENOENT/);
});

test('preserves an absolute vtslsPath', async (t) => {
  const absoluteEntry = path.resolve('tools/vtsls.js');
  const root = await workspace(t, {
    'config.json': JSON.stringify({ vtslsPath: absoluteEntry }),
  });
  assert.equal((await readConfig(path.join(root, 'config.json'))).vtslsPath, absoluteEntry);
});
