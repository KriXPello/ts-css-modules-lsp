# ts-css-modules-lsp

A language server that adds **Go to Definition for CSS Modules** to TypeScript and JavaScript. Jump from `styles.card` to its definition in CSS, SCSS, or indented Sass. Other language features are provided by [vtsls](https://github.com/yioneko/vtsls).

No TypeScript plugins or project configuration changes are required. The server works with editors that support LSP over stdio.

## Setup

Requires **Node.js 22+** and npm. Until the first npm release, use [Build from source](#build-from-source).

Configure your editor to run this command for TypeScript, TSX, JavaScript, and JSX:

```sh
npx --yes ts-css-modules-lsp --stdio
```

`npx` downloads the package on first use. `--yes` skips the installation prompt so the editor can start it without interaction.

Use it **instead of your existing TypeScript language server**. vtsls is included; no separate installation is needed.

### Example: Zed

Override `vtsls` in Zed's **user settings**. Set `binary.path` to the **absolute path to `npx`**, replacing the Unix-style example path below with your own:

```json
{
  "lsp": {
    "vtsls": {
      "binary": {
        "path": "/usr/bin/npx",
        "arguments": ["--yes", "ts-css-modules-lsp", "--stdio"]
      }
    }
  }
}
```

Keep the key as `vtsls` to preserve your existing settings, then restart the language server. Your CSS/SCSS language server can remain enabled.

To find the path, run `command -v npx` on macOS/Linux or `where.exe npx` on Windows. On Windows, use the absolute path to `npx.cmd` from the output.

## Usage

```tsx
import styles from './styles.module.scss';

const element = <div className={styles.card} />;
```

Go to Definition on `card` in `styles.card` opens `.card` in `styles.module.scss`.

Supports default imports of `*.module.css`, `*.module.scss`, and `*.module.sass`, including literal keys (`styles['card-title']`), optional chaining, and definitions in imported Sass files.

Only **Go to Definition** is extended. Completion, diagnostics, and rename stay with vtsls. No `.d.ts` files are generated.

## Configuration

**Configuration is optional**. To customize resolution, create a JSON file for this server and pass its absolute path with `--config`. These settings do not belong in `tsconfig.json` or your editor's settings:

```sh
npx --yes ts-css-modules-lsp --stdio --config /absolute/path/to/config.json
```

Example `config.json`, stored in your frontend project's root directory:

```json
{
  "classnameTransform": "camelCase",
  "loadPaths": ["./src/styles"],
  "aliases": {
    "@/*": ["./src/*"]
  }
}
```

| Option | Default | Purpose |
| --- | --- | --- |
| `classnameTransform` | `"asIs"` | Match names such as `styles.cardTitle` to stylesheet classes such as `.card-title`. |
| `loadPaths` | `[]` | Additional directories for Sass imports. |
| `aliases` | `{}` | Map TS/JS import paths to stylesheet files. In the example above, `@/Button.module.scss` resolves to `src/Button.module.scss`. |
| `vtslsPath` | Bundled vtsls | Path to a custom vtsls Node.js entry point. Overridden by `--vtsls`. |

Paths in the configuration are relative to the JSON file's directory. In Zed, append `--config` and the file path to `binary.arguments`. Restart the server after changing the configuration.

### Class name transforms

| Value | Available names |
| --- | --- |
| `asIs` | Original names only. |
| `camelCase` | Original names and camelCase variants. |
| `camelCaseOnly` | camelCase names only. |
| `dashes` | Original names and variants with hyphens converted to camel case. |
| `dashesOnly` | `.card-title` is available as `cardTitle`, but not as `card-title`. |

For example, `camelCase` resolves both `styles['card-title']` and `styles.cardTitle` to `.card-title`. Choose the mode that matches your build configuration.

### Import paths

Relative stylesheet imports resolve from the importing TS/JS file. For imports such as `@/Button.module.scss`, the server checks `aliases` in its `--config` JSON file first, then looks for the nearest `tsconfig.json` or `jsconfig.json` above the importing file. It reads `compilerOptions.baseUrl` and `compilerOptions.paths`, including settings inherited through `extends`.

If that TypeScript/JavaScript configuration uses `references` to point to other project configurations, such as `tsconfig.app.json`, the server also checks those for the importing file's aliases.

`aliases` in the server configuration applies only to imports from TS/JS. To add search directories for imports inside Sass, set `loadPaths` in the same JSON file.

### Custom vtsls

To use your own vtsls installation, add `vtslsPath` to the server's JSON configuration file loaded with `--config`:

```json
{
  "vtslsPath": "/absolute/path/to/node_modules/@vtsls/language-server/bin/vtsls.js"
}
```

Alternatively, add `--vtsls` to the server's launch command. It overrides `vtslsPath` from that JSON file:

```sh
npx --yes ts-css-modules-lsp --stdio --vtsls /absolute/path/to/node_modules/@vtsls/language-server/bin/vtsls.js
```

Point to the **JS entry file**, not an npm `.cmd` or shell wrapper. In Zed, append `--vtsls` and the entry file's absolute path to `binary.arguments` in the example above.

## Limitations and troubleshooting

- **Save stylesheets before navigating.** They are read from disk.
- Computed keys, named imports, re-exports, and aliases such as `const other = styles` are not supported by the CSS Modules handler.
- Generated Sass classes may lead to an approximate source location.
- Bundler settings, project PostCSS plugins, Sass `additionalData`, and custom importers are not loaded automatically.
- Aliases in a referenced configuration (such as `tsconfig.app.json`) are used only when its `files`/`include`/`exclude` settings list the importing TS/JS file. If this misses your file, add the mapping to `aliases` in the server's `--config` JSON file.

If navigation opens a `.d.ts` file instead, check the saved stylesheet, import path, and `classnameTransform`. When resolution fails, the request falls back to vtsls. Check your editor's language server log for compilation errors.

## Build from source

From a checkout of this repository:

```sh
npm ci
npm run build
```

To use this build in your editor, configure its LSP client to run:

```sh
node /absolute/path/to/ts-css-modules-lsp/dist/cli.js --stdio
```

## Built on and inspired by

- [vtsls](https://github.com/yioneko/vtsls) — TypeScript language server backend.
- [cssmodules-language-server](https://github.com/antonk52/cssmodules-language-server) — CSS Modules navigation inspiration.
- [typescript-plugin-css-modules](https://github.com/mrmckeb/typescript-plugin-css-modules) — Sass and source-map approach.
