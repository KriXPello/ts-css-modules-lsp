const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { analyzeStyles } = require('../dist/styles.js');
const { workspace } = require('./helpers.cjs');

const options = (classnameTransform = 'asIs', loadPaths = []) => ({ classnameTransform, loadPaths });
const loc = (filePath, start, end) => ({ filePath, range: { start, end } });

test('CSS exports local classes and exact selector ranges, excluding global classes', async (t) => {
  const root = await workspace(t, {
    'main.module.css': '.local, :global(.outside) { color: red }\n:local(.inside) {}',
  });
  const file = path.join(root, 'main.module.css');
  const result = await analyzeStyles(file, options());
  assert.deepEqual(new Set(result.exports.keys()), new Set(['local', 'inside']));
  assert.deepEqual(result.exports.get('local'), [
    loc(file, { line: 0, character: 0 }, { line: 0, character: 6 }),
  ]);
  assert.deepEqual(result.exports.get('inside'), [
    loc(file, { line: 1, character: 7 }, { line: 1, character: 14 }),
  ]);
  assert.deepEqual([...result.dependencies], [file]);
});

test('CSS escaped selector ranges retain raw spelling with CRLF and Unicode', async (t) => {
  const source = '.caf\\e9 {}\r\n.π {}\r\n';
  const root = await workspace(t, { 'main.module.css': source });
  const file = path.join(root, 'main.module.css');
  const result = await analyzeStyles(file, options());
  assert.deepEqual([...result.exports.keys()].sort(), ['café', 'π']);
  assert.deepEqual(result.exports.get('café'), [
    loc(file, { line: 0, character: 0 }, { line: 0, character: 8 }),
  ]);
  assert.deepEqual(result.exports.get('π'), [
    loc(file, { line: 1, character: 0 }, { line: 1, character: 2 }),
  ]);
});

test('SCSS nesting retains exact ranges and deduplicates generated parent selectors', async (t) => {
  const text = '.parent {\n  .child { color: red; }\n  .other { color: blue; }\n}';
  const root = await workspace(t, { 'main.module.scss': text });
  const file = path.join(root, 'main.module.scss');
  const result = await analyzeStyles(file, options());
  assert.deepEqual(new Set(result.exports.keys()), new Set(['parent', 'child', 'other']));
  assert.deepEqual(result.exports.get('parent'), [
    loc(file, { line: 0, character: 0 }, { line: 0, character: 7 }),
  ]);
  assert.deepEqual(result.exports.get('child'), [
    loc(file, { line: 1, character: 2 }, { line: 1, character: 8 }),
  ]);
  assert.deepEqual(result.exports.get('other'), [
    loc(file, { line: 2, character: 2 }, { line: 2, character: 8 }),
  ]);
});

test('SCSS parent-selector suffixes export generated names with point locations', async (t) => {
  const root = await workspace(t, { 'main.module.scss': '.panel { &-item { color: red; } }' });
  const file = path.join(root, 'main.module.scss');
  const result = await analyzeStyles(file, options());
  assert.deepEqual([...result.exports.keys()], ['panel-item']);
  const [location] = result.exports.get('panel-item');
  assert.equal(location.filePath, file);
  assert.deepEqual(location.range.start, location.range.end);
});

test('SCSS mixins map class definitions to the original dependency', async (t) => {
  const root = await workspace(t, {
    'main.module.scss': "@use 'mixins';\n@include mixins.paint;",
    '_mixins.scss': '@mixin paint {\n  .from-mixin { color: red; }\n}',
  });
  const file = path.join(root, 'main.module.scss');
  const dependency = path.join(root, '_mixins.scss');
  const result = await analyzeStyles(file, options());
  assert.deepEqual(result.exports.get('from-mixin'), [
    loc(dependency, { line: 1, character: 2 }, { line: 1, character: 13 }),
  ]);
  assert.deepEqual(result.dependencies, new Set([file, dependency]));
});

test('SCSS global blocks and CSS global prefixes do not produce local exports', async (t) => {
  const root = await workspace(t, {
    'main.module.scss': ':global { .outside { color: red; } }\n.local { color: blue; }',
    'main.module.css': ':global .outside {}\n:global .other :local .inside {}',
  });
  const scss = await analyzeStyles(path.join(root, 'main.module.scss'), options());
  assert.deepEqual([...scss.exports.keys()], ['local']);
  const css = await analyzeStyles(path.join(root, 'main.module.css'), options());
  assert.deepEqual([...css.exports.keys()], ['inside']);
});

test('classname transforms distinguish camel case and dashes', async (t) => {
  const root = await workspace(t, { 'main.module.css': '.foo_bar-baz {}' });
  const file = path.join(root, 'main.module.css');
  const expected = {
    asIs: ['foo_bar-baz'], camelCase: ['foo_bar-baz', 'fooBarBaz'], camelCaseOnly: ['fooBarBaz'],
    dashes: ['foo_bar-baz', 'foo_barBaz'], dashesOnly: ['foo_barBaz'],
  };
  for (const [mode, names] of Object.entries(expected)) {
    const result = await analyzeStyles(file, options(mode));
    assert.deepEqual([...result.exports.keys()], names, mode);
  }
});

test('indented Sass resolves a mixin class through its source map', async (t) => {
  const root = await workspace(t, {
    'main.module.sass': "@use 'mixins'\n+mixins.paint\n",
    '_mixins.sass': '=paint\n  .from-mixin\n    color: red\n',
  });
  const file = path.join(root, 'main.module.sass');
  const dependency = path.join(root, '_mixins.sass');
  const result = await analyzeStyles(file, options());
  assert.deepEqual([...result.exports.keys()], ['from-mixin']);
  assert.equal(result.exports.get('from-mixin')[0].filePath, dependency);
  assert.deepEqual(result.exports.get('from-mixin'), [
    loc(dependency, { line: 1, character: 2 }, { line: 1, character: 2 }),
  ]);
  assert.ok(result.dependencies.has(file));
  assert.ok(result.dependencies.has(dependency));
});

test('loadPaths resolve Sass modules outside the importing directory', async (t) => {
  const root = await workspace(t, {
    'styles/main.module.scss': "@use 'tokens';\n.card { color: tokens.$color; }",
    'shared/_tokens.scss': '$color: red;',
  });
  const file = path.join(root, 'styles/main.module.scss');
  const dependency = path.join(root, 'shared/_tokens.scss');
  const result = await analyzeStyles(file, options('asIs', [path.join(root, 'shared')]));
  assert.deepEqual([...result.exports.keys()], ['card']);
  assert.ok(result.dependencies.has(dependency));
});

test('malformed Sass rejects rather than producing an incomplete index', async (t) => {
  const root = await workspace(t, { 'broken.module.scss': '.broken { color: ;' });
  await assert.rejects(analyzeStyles(path.join(root, 'broken.module.scss'), options()), /Expected/);
});
