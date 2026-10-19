const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SourceIndex } = require('../dist/source-index.js');

test('SCSS lookup selects the smallest enclosing nested rule and exact class range', () => {
  const file = path.resolve('nested.module.scss');
  const index = new SourceIndex(file, '.same {\n  .same {}\n}\n');
  assert.deepEqual(index.locate('same', 2, 10), {
    start: { line: 1, character: 2 }, end: { line: 1, character: 7 },
  });
});

test('SCSS lookup preserves escaped selector spelling', () => {
  const file = path.resolve('escaped.module.scss');
  const index = new SourceIndex(file, '.caf\\e9 {}\r\n');
  assert.deepEqual(index.locate('café', 1, 5), {
    start: { line: 0, character: 0 }, end: { line: 0, character: 8 },
  });
});

test('indented Sass and unmatched source-map points use point fallback', () => {
  const file = path.resolve('fallback.module.sass');
  const index = new SourceIndex(file, '.known\n  color: red\n');
  assert.deepEqual(index.locate('known', 1, 3), {
    start: { line: 0, character: 2 }, end: { line: 0, character: 2 },
  });
  const scss = new SourceIndex(path.resolve('missing.module.scss'), '.known {}\n');
  assert.deepEqual(scss.locate('missing', 1, 3), {
    start: { line: 0, character: 2 }, end: { line: 0, character: 2 },
  });
});
