# @codecogs/eqneditor-froala

The [CodeCogs Equation Editor](https://editor.codecogs.com) plugin for
[Froala Editor](https://froala.com) 3 and 4.

Like the TinyMCE 6 plugin, this is a single drop-in script - no build step, no bundler. Froala
loads it at runtime the same way it loads any other plugin.

## Install

```
npm install @codecogs/eqneditor-froala
```

Or without npm, download `eqneditor.js` and `eqneditor.css` and serve them alongside your own
copy of Froala.

## Quick start

```html
<link rel="stylesheet" href="node_modules/@codecogs/eqneditor-froala/eqneditor.css">
<script src="node_modules/@codecogs/eqneditor-froala/eqneditor.js"></script>

<script>
new FroalaEditor('#editor', {
    toolbarButtons: ['bold', 'italic', '|', 'eqneditor']
});
</script>
```

Press the **fx** button to insert an equation, or click an existing one to edit it again (unlike the other adapters, a single click, not a double one - see below).

## Options

All optional, passed alongside Froala's own options:

| Option | Default | Meaning |
|---|---|---|
| `eqneditorShowLatex` | `true` | Whether the LaTeX markup pane starts visible beneath the maths view. |
| `eqneditorServer` | `'editor.codecogs.com'` | Host the Equation Editor's own code is loaded from. Change this if you run your own copy. |
| `eqneditorRenderUrl` | `'https://latex.codecogs.com'` | The rendering service that turns an equation into an image. |
| `eqneditorInsertAs` | `'url'` | How a saved equation is written into the document: `'url'` (an `<img>`), `'latex'` (`$...$`/`$$...$$`, needs [fxTeX](https://editor.codecogs.com/docs/0-fxtex.php), KaTeX or MathJax on the published page), or `'mathml'` (final markup, needs the stylesheet below). |
| `eqneditorLatexDisplay` | `true` | With `eqneditorInsertAs: 'latex'`, whether to use `$$` (display) or `$` (inline) delimiters. |
| `eqneditorScriptUrl` | derived from `eqneditorServer` | Full URL of the Equation Editor bundle, when the default path does not suit. |
| `eqneditorCssUrl` | derived from `eqneditorServer` | Full URL of the Equation Editor stylesheet. |
| `eqneditorMathmlCssUrl` | derived from `eqneditorServer` | The stylesheet loaded into the editing view for `eqneditorInsertAs: 'mathml'`. |

```js
new FroalaEditor('#editor', {
    toolbarButtons: ['bold', 'italic', '|', 'eqneditor'],
    eqneditorInsertAs: 'mathml'
});
```

### MathML needs a stylesheet on the page that displays it

Browsers' own MathML does not cover everything the converter produces, so a page that displays
`eqneditorInsertAs: 'mathml'` output needs this line - the same file fxTeX ships:

```html
<link rel="stylesheet" href="https://editor.codecogs.com/fxtex.css">
```

The plugin loads it into the editing view for you; it cannot add it to the page that finally
displays the content, because that page is yours, not the editor's.

Unlike TinyMCE and CKEditor, Froala's own sanitiser allows every tag and attribute by default
(`htmlAllowedTags`/`htmlAllowedAttrs` both default to `['*']`), so nothing has to be configured
to let `<math>` through - just serve the stylesheet above wherever the content is published.
If a site has narrowed those options itself, keep `math` and the MathML element names on
whatever allow-list replaces the default.

## What gets written into the page

An equation can be saved into your content in three forms - see the `eqneditorInsertAs` row
above. Equations written as `url` or `mathml` can be reopened by clicking them (a single click, not a double one - see "Why a single click" below), because
each carries the LaTeX it was written from (in the image's `alt`, or the `<math>` element's
`title`). Equations written as `latex` are plain text and are edited as text.

## Why a single click, not a double one

Froala shows its own resize/align popup directly over an image on the first click of any click
on it - so a genuine double-click never reaches the image at all: the second click always lands
on that popup, not the image underneath. A single click is the only interaction actually
available, so this plugin uses that instead, hiding Froala's own popup immediately and opening
the equation dialog in its place. This only affects images matching CodeCogs' own rendering
URL - an ordinary uploaded image still gets Froala's normal resize/align popup, untouched.

## Why this plugin draws its own dialog

Froala's built-in popup system is sized for small toolbar dropdowns, not a full editing
surface, so this plugin opens a small modal of its own (`eqneditor.css` is only that frame -
the equation editor inside it is styled by the stylesheet loaded from `eqneditorCssUrl`). This
is the one respect in which it differs from the CKEditor 5 and TinyMCE plugins, which use their
host editors' own dialog APIs.
