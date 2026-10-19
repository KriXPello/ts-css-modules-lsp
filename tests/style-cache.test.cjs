const assert = require('node:assert/strict');
const { unlink, utimes, writeFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { StyleCache } = require('../dist/style-cache.js');
const { workspace } = require('./helpers.cjs');

const oldDate = new Date('2000-01-01T00:00:00Z');
const options = { loadPaths: [], classnameTransform: 'asIs' };

function analysis(filePath, name) {
  return { exports: new Map([[name, []]]), dependencies: new Set([filePath]) };
}

test('reuses cached analysis and deduplicates concurrent compilation', async (t) => {
  const root = await workspace(t, { 'main.scss': 'x{}' });
  const main = path.join(root, 'main.scss');
  await utimes(main, oldDate, oldDate);
  const gate = Promise.withResolvers();
  let calls = 0;
  const cache = new StyleCache(options, async (filePath, receivedOptions) => {
    assert.equal(filePath, main);
    assert.equal(receivedOptions, options);
    calls++;
    return gate.promise;
  });

  const first = cache.get(main);
  const second = cache.get(main);
  assert.equal(calls, 1);
  const result = analysis(main, 'first');
  gate.resolve(result);
  assert.equal(await first, result);
  assert.equal(await second, result);
  assert.equal(await cache.get(main), result);
  assert.equal(calls, 1);
});

test('invalidates when dependency mtime or size changes', async (t) => {
  const root = await workspace(t, { 'main.scss': 'one' });
  const main = path.join(root, 'main.scss');
  await utimes(main, oldDate, oldDate);
  let calls = 0;
  const cache = new StyleCache(options, async () => analysis(main, `run${++calls}`));

  assert.equal((await cache.get(main)).exports.has('run1'), true);
  await writeFile(main, 'two');
  await utimes(main, new Date('2001-01-01'), new Date('2001-01-01'));
  assert.equal((await cache.get(main)).exports.has('run2'), true);

  await writeFile(main, 'a much longer value');
  await utimes(main, new Date('2001-01-01'), new Date('2001-01-01'));
  assert.equal((await cache.get(main)).exports.has('run3'), true);
  assert.equal(calls, 3);
});

test('recompiles after a dependency is deleted', async (t) => {
  const root = await workspace(t, { 'main.scss': 'x{}' });
  const main = path.join(root, 'main.scss');
  await utimes(main, oldDate, oldDate);
  let calls = 0;
  const cache = new StyleCache(options, async () => analysis(main, `run${++calls}`));
  await cache.get(main);
  await unlink(main);
  await assert.rejects(cache.get(main), { code: 'ENOENT' });
  assert.equal(calls, 2);
});

test('a failed compilation does not poison later requests', async (t) => {
  const root = await workspace(t, { 'main.scss': 'x{}' });
  const main = path.join(root, 'main.scss');
  await utimes(main, oldDate, oldDate);
  let calls = 0;
  const cache = new StyleCache(options, async () => {
    if (++calls === 1) throw new Error('compile failed');
    return analysis(main, 'recovered');
  });
  await assert.rejects(cache.get(main), /compile failed/);
  assert.equal((await cache.get(main)).exports.has('recovered'), true);
  assert.equal(calls, 2);
});

test('a save during compilation makes the result unstable', async (t) => {
  const root = await workspace(t, { 'main.scss': 'x{}' });
  const main = path.join(root, 'main.scss');
  await utimes(main, oldDate, oldDate);
  const gate = Promise.withResolvers();
  let calls = 0;
  const cache = new StyleCache(options, async () => {
    calls++;
    if (calls === 1) {
      await gate.promise;
    }
    return analysis(main, `run${calls}`);
  });

  const pending = cache.get(main);
  assert.equal(calls, 1);
  const future = new Date(Date.now() + 60_000);
  await utimes(main, future, future);
  gate.resolve();
  await pending;
  assert.equal((await cache.get(main)).exports.has('run2'), true);
  assert.equal(calls, 2);
});

for (const outcome of ['success', 'failure']) {
  test(`an evicted pending ${outcome} cannot replace a newer cached result`, async (t) => {
    const files = { 'main.scss': 'main' };
    for (let i = 0; i < 32; i++) files[`filler${i}.scss`] = `filler${i}`;
    const root = await workspace(t, files);
    const names = Object.keys(files);
    await Promise.all(names.map((name) => utimes(path.join(root, name), oldDate, oldDate)));
    const main = path.join(root, 'main.scss');
    const oldGate = Promise.withResolvers();
    let mainCalls = 0;
    const cache = new StyleCache(options, async (filePath) => {
      if (filePath !== main) return analysis(filePath, path.basename(filePath));
      mainCalls++;
      if (mainCalls === 1) return oldGate.promise;
      return analysis(main, 'new');
    });

    const oldRequest = cache.get(main);
    const waitingReader = cache.get(main);
    for (let i = 0; i < 32; i++) await cache.get(path.join(root, `filler${i}.scss`));
    const newResult = await cache.get(main);
    assert.equal(newResult.exports.has('new'), true);
    if (outcome === 'success') {
      const oldResult = analysis(main, 'old');
      oldGate.resolve(oldResult);
      assert.equal(await oldRequest, oldResult);
    } else {
      const oldRejection = assert.rejects(oldRequest, /old compile failed/);
      oldGate.reject(new Error('old compile failed'));
      await oldRejection;
    }
    assert.equal(await waitingReader, newResult);
    assert.equal(await cache.get(main), newResult);
    assert.equal(mainCalls, 2);
  });
}

test('the default compiler invalidates analysis when an imported Sass file changes', async (t) => {
  const root = await workspace(t, {
    'theme.module.scss': "@use 'colors';",
    '_colors.scss': '.old { color: red; }',
  });
  const main = path.join(root, 'theme.module.scss');
  const dependency = path.join(root, '_colors.scss');
  await Promise.all([main, dependency].map((file) => utimes(file, oldDate, oldDate)));
  const cache = new StyleCache(options);
  const first = await cache.get(main);
  assert.deepEqual([...first.exports.keys()], ['old']);
  assert.equal(await cache.get(main), first);

  await writeFile(dependency, '.new { color: blue; }');
  const changedDate = new Date('2001-01-01T00:00:00Z');
  await utimes(dependency, changedDate, changedDate);
  const second = await cache.get(main);
  assert.deepEqual([...second.exports.keys()], ['new']);
  assert.equal(await cache.get(main), second);
});
