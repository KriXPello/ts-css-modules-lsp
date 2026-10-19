const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveStyleModule } = require('../dist/resolve-module.js');
const { workspace } = require('./helpers.cjs');

const config = (basePath, aliases = {}) => ({ basePath, aliases, loadPaths: [], classnameTransform: 'asIs' });
const json = (value) => JSON.stringify(value);

test('resolves relative and absolute style modules with supported suffixes', async (t) => {
  const root = await workspace(t, {
    'src/main.tsx': '', 'src/partial.module.scss': '', 'absolute.module.css': '',
    'src/theme.module.sass': '',
  });
  const importer = path.join(root, 'src/main.tsx');
  assert.equal(resolveStyleModule('./partial.module.scss', importer, config(root)), path.join(root, 'src/partial.module.scss'));
  assert.equal(resolveStyleModule(path.join(root, 'absolute.module.css'), importer, config(root)), path.join(root, 'absolute.module.css'));
  assert.equal(
    resolveStyleModule('./theme.module.sass', importer, config(root)),
    path.join(root, 'src/theme.module.sass'),
  );
  assert.equal(resolveStyleModule('./', importer, config(root)), undefined);
  assert.equal(resolveStyleModule('./missing.module.scss', importer, config(root)), undefined);
});

test('configured aliases take precedence over matching tsconfig aliases', async (t) => {
  const root = await workspace(t, {
    'src/main.tsx': '', 'tsconfig.json': json({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['ts/*'] } } }),
    'config/theme.module.scss': '', 'ts/theme.module.scss': '',
  });
  assert.equal(
    resolveStyleModule('@/theme.module.scss', path.join(root, 'src/main.tsx'), config(root, { '@/*': ['config/*'] })),
    path.join(root, 'config/theme.module.scss'),
  );
});

test('resolves inherited tsconfig paths with baseUrl', async (t) => {
  const root = await workspace(t, {
    'src/main.tsx': '',
    'base.json': json({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['styles/*'] } } }),
    'tsconfig.json': json({ extends: './base.json' }),
    'styles/theme.module.scss': '',
  });
  const importer = path.join(root, 'src/main.tsx');
  const expected = path.join(root, 'styles/theme.module.scss');
  assert.equal(resolveStyleModule('@/theme.module.scss', importer, config(root)), expected);
});

test('resolves inherited paths without baseUrl relative to the extending config', async (t) => {
  const root = await workspace(t, {
    'project/src/main.tsx': '',
    'project/config/base.json': json({ compilerOptions: { paths: { '@/*': ['styles/*'] } } }),
    'project/tsconfig.json': json({ extends: './config/base.json' }),
    'project/config/styles/theme.module.scss': '',
  });
  const importer = path.join(root, 'project/src/main.tsx');
  const expected = path.join(root, 'project/config/styles/theme.module.scss');
  assert.equal(resolveStyleModule('@/theme.module.scss', importer, config(root)), expected);
});

test('resolves tsconfig paths without baseUrl relative to the paths base', async (t) => {
  const root = await workspace(t, {
    'src/main.tsx': '', 'tsconfig.json': json({ compilerOptions: { paths: { '@/*': ['styles/*'] } } }),
    'styles/theme.module.scss': '',
  });
  assert.equal(resolveStyleModule('@/theme.module.scss', path.join(root, 'src/main.tsx'), config(root)), path.join(root, 'styles/theme.module.scss'));
});

test('uses baseUrl-only module resolution', async (t) => {
  const root = await workspace(t, {
    'src/main.tsx': '', 'tsconfig.json': json({ compilerOptions: { baseUrl: '.' } }),
    'styles/theme.module.scss': '',
  });
  assert.equal(resolveStyleModule('styles/theme.module.scss', path.join(root, 'src/main.tsx'), config(root)), path.join(root, 'styles/theme.module.scss'));
});

test('prefers tsconfig over jsconfig in the same directory', async (t) => {
  const root = await workspace(t, {
    'src/main.tsx': '',
    'tsconfig.json': json({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['ts/*'] } } }),
    'jsconfig.json': json({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['js/*'] } } }),
    'ts/theme.module.scss': '', 'js/theme.module.scss': '',
  });
  assert.equal(resolveStyleModule('@/theme.module.scss', path.join(root, 'src/main.tsx'), config(root)), path.join(root, 'ts/theme.module.scss'));
});

test('uses jsconfig paths for a JavaScript importer when no tsconfig exists', async (t) => {
  const root = await workspace(t, {
    'src/main.jsx': '',
    'jsconfig.json': json({ compilerOptions: { baseUrl: '.', paths: { '~/*': ['js-styles/*'] } } }),
    'js-styles/theme.module.scss': '',
  });
  const importer = path.join(root, 'src/main.jsx');
  const expected = path.join(root, 'js-styles/theme.module.scss');
  assert.equal(resolveStyleModule('~/theme.module.scss', importer, config(root)), expected);
});

test('project references choose the importing project, not an earlier sibling', async (t) => {
  const root = await workspace(t, {
    'tsconfig.json': json({ files: [], references: [{ path: './tools/tsconfig.tools.json' }, { path: './src/tsconfig.app.json' }] }),
    'tools/tsconfig.tools.json': json({ compilerOptions: { baseUrl: '..', paths: { '@/*': ['tools-styles/*'] } }, files: ['helper.ts'] }),
    'src/tsconfig.app.json': json({ compilerOptions: { baseUrl: '..', paths: { '@/*': ['app-styles/*'] } }, files: ['main.tsx'] }),
    'src/main.tsx': '', 'tools/helper.ts': '',
    'tools-styles/theme.module.scss': '', 'app-styles/theme.module.scss': '',
  });
  assert.equal(resolveStyleModule('@/theme.module.scss', path.join(root, 'src/main.tsx'), config(root)), path.join(root, 'app-styles/theme.module.scss'));
  assert.equal(resolveStyleModule('@/theme.module.scss', path.join(root, 'outsider.tsx'), config(root)), undefined);
});

test('cyclic root project references terminate for unresolved aliases', async (t) => {
  const root = await workspace(t, {
    'tsconfig.json': json({ files: [], references: [{ path: './a/tsconfig.json' }] }),
    'a/tsconfig.json': json({ files: [], references: [{ path: '../b/tsconfig.json' }] }),
    'b/tsconfig.json': json({ files: [], references: [{ path: '../a/tsconfig.json' }] }),
    'src/main.tsx': '',
  });
  const importer = path.join(root, 'src/main.tsx');
  assert.equal(resolveStyleModule('@/missing.module.scss', importer, config(root)), undefined);
});
