import scss from 'postcss-scss';
import selectorParser from 'postcss-selector-parser';
import type { Range } from 'vscode-languageserver-protocol';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

interface Anchor {
  name: string;
  blockStart: number;
  blockEnd: number;
  range: Range;
}

export class SourceIndex {
  private readonly document: TextDocument;
  private readonly anchors: Anchor[] = [];

  constructor(filePath: string, text: string) {
    this.document = TextDocument.create(URI.file(filePath).toString(), 'scss', 0, text);
    // Indented Sass still gets source-map point locations, without SCSS AST refinement.
    if (filePath.endsWith('.sass')) return;
    const root = scss.parse(text);
    root.walkRules((rule) => {
      const start = rule.source?.start;
      const end = rule.source?.end;
      if (!start || !end) return;
      const blockStart = this.document.offsetAt({ line: start.line - 1, character: start.column - 1 });
      const blockEnd = this.document.offsetAt({ line: end.line - 1, character: end.column });
      try {
        const selectors = selectorParser().astSync(rule.selector);
        selectors.walkClasses((node) => {
          const point = node.source?.start;
          if (!point) return;
          let column = point.column;
          if (point.line === 1) column += start.column - 1;
          const position = { line: start.line + point.line - 2, character: column - 1 };
          const offset = this.document.offsetAt(position);
          // raw text preserves CSS escapes that differ from node.value.length.
          const length = node.toString().length;
          this.anchors.push({
            name: node.value,
            blockStart,
            blockEnd,
            range: { start: position, end: this.document.positionAt(offset + length) },
          });
        });
      } catch {
        // Sass interpolation need not be valid CSS selector syntax before compilation.
      }
    });
  }

  locate(name: string, line: number, column: number): Range {
    const point = this.document.positionAt(
      this.document.offsetAt({ line: line - 1, character: column - 1 }),
    );
    const offset = this.document.offsetAt(point);
    const candidates = this.anchors.filter((anchor) =>
      anchor.name === name && anchor.blockStart <= offset && offset <= anchor.blockEnd,
    );
    candidates.sort((left, right) =>
      (left.blockEnd - left.blockStart) - (right.blockEnd - right.blockStart),
    );
    if (candidates.length) return candidates[0].range;
    return { start: point, end: point };
  }
}
