const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { getModuleReference } = require('../dist/ts-reference.js');
const { markedDocument, rangeOf } = require('./helpers.cjs');

const filePath = path.resolve('tests/virtual/component.tsx');

for (const extension of ['css', 'scss', 'sass']) {
  test(`import binding opens a .module.${extension} file`, () => {
    const { document, position } = markedDocument(filePath,
      `import st/*cursor*/yles from './card.module.${extension}';`);
    assert.deepEqual(getModuleReference(document, position), {
      kind: 'module',
      moduleName: `./card.module.${extension}`,
      originRange: rangeOf(document, 'styles'),
    });
  });
}

for (const [expression, origin, exportName] of [
  ['styles.ca/*cursor*/rd', 'card', 'card'],
  ["styles['card-/*cursor*/title']", "'card-title'", 'card-title'],
  ['styles["ca/*cursor*/rd"]', '"card"', 'card'],
  ['styles[`ca/*cursor*/rd`]', '`card`', 'card'],
  ['styles?.ca/*cursor*/rd', 'card', 'card'],
]) {
  test(`recognizes ${expression}`, () => {
    const { document, position } = markedDocument(filePath,
      `import styles from '@/theme.module.scss';\n${expression};`);
    assert.deepEqual(getModuleReference(document, position), {
      kind: 'export', moduleName: '@/theme.module.scss', exportName,
      originRange: rangeOf(document, origin),
    });
  });
}

for (const extension of ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs']) {
  test(`supports .${extension} documents and renamed default imports`, () => {
    const { document, position } = markedDocument(path.resolve(`tests/virtual/component.${extension}`),
      "import classes from './theme.module.css';\nconst value = classes.ca/*cursor*/rd;");
    const reference = getModuleReference(document, position);
    assert.equal(reference?.kind, 'export');
    assert.equal(reference.exportName, 'card');
    assert.deepEqual(reference.originRange, rangeOf(document, 'card'));
  });
}

test('recognizes references inside JSX attributes', () => {
  const { document, position } = markedDocument(filePath,
    "import styles from './theme.module.scss';\nconst view = <div className={styles.ca/*cursor*/rd} />;");
  assert.equal(getModuleReference(document, position).exportName, 'card');
});

for (const [name, source] of [
  ['ordinary object', 'const styles = { card: true }; styles.ca/*cursor*/rd;'],
  ['non-module stylesheet', "import styles from './card.scss'; styles.ca/*cursor*/rd;"],
  ['type-only import', "import type styles from './card.module.scss'; styles.ca/*cursor*/rd;"],
  ['type-only import binding', "import type st/*cursor*/yles from './card.module.scss';"],
  ['namespace import', "import * as styles from './card.module.scss'; styles.ca/*cursor*/rd;"],
  ['named import', "import { styles } from './card.module.scss'; styles.ca/*cursor*/rd;"],
  ['shadowed import', "import styles from './card.module.scss';\nfunction render(styles) { return styles.ca/*cursor*/rd; }"],
  ['computed expression', "import styles from './card.module.scss'; styles[/*cursor*/key];"],
  ['interpolated expression', "import styles from './card.module.scss'; styles[`card-${/*cursor*/key}`];"],
  ['receiver outside import', "import styles from './card.module.scss'; st/*cursor*/yles.card;"],
  ['module specifier', "import styles from './ca/*cursor*/rd.module.scss';"],
]) {
  test(`does not intercept ${name}`, () => {
    const { document, position } = markedDocument(filePath, source);
    assert.equal(getModuleReference(document, position), null);
  });
}

test('ignores non-file URIs and unsupported document extensions', () => {
  const { document, position } = markedDocument(filePath,
    "import styles from './card.module.scss'; styles.ca/*cursor*/rd;");
  for (const uri of ['untitled:component.tsx', 'https://example.com/component.tsx', `${document.uri}.vue`]) {
    const other = TextDocument.create(uri, document.languageId, 1, document.getText());
    assert.equal(getModuleReference(other, position), null);
  }
});

test('uses UTF-16 positions with CRLF and Unicode before the reference', () => {
  const { document, position } = markedDocument(filePath,
    "import styles from './card.module.scss';\r\nconst emoji = '😀'; styles.ca/*cursor*/rd;");
  assert.deepEqual(getModuleReference(document, position).originRange, {
    start: { line: 1, character: 27 }, end: { line: 1, character: 31 },
  });
});

test('refreshes the cached program when document version or text changes', () => {
  for (const [version, name] of [[1, 'first'], [2, 'second'], [2, 'third']]) {
    const { document, position } = markedDocument(filePath,
      `import styles from './card.module.scss'; styles./*cursor*/${name};`, version);
    assert.equal(getModuleReference(document, position).exportName, name);
  }
});

test('can revisit a document after program cache eviction', () => {
  const first = markedDocument(filePath, "import styles from './card.module.scss'; styles.ca/*cursor*/rd;");
  getModuleReference(first.document, first.position);
  for (let index = 0; index < 10; index++) {
    const other = markedDocument(path.resolve(`tests/virtual/other-${index}.tsx`),
      "import styles from './card.module.scss'; styles.ca/*cursor*/rd;");
    assert.equal(getModuleReference(other.document, other.position).exportName, 'card');
  }
  assert.equal(getModuleReference(first.document, first.position).exportName, 'card');
});
