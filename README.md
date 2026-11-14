# @codecogs/fxeditor-froala

[fxEditor](https://fxeditor.codecogs.com), CodeCogs' LaTeX equation editor, as a plugin for
[Froala Editor](https://froala.com) 3 and 4. Authors build an equation in a maths view or as
LaTeX, and it goes into the document as MathML or as an image.

Full documentation, a live example and a design tool:
**[fxplugins.codecogs.com/docs/froala.html](https://fxplugins.codecogs.com/docs/froala.html)**

Like the TinyMCE plugin, this is a single drop-in script - no build step, no bundler. Froala
loads it at runtime the same way it loads any other plugin.

## Install

```bash
npm install @codecogs/fxeditor-froala
```

Or without npm, load both files from `https://fxplugins.codecogs.com/froala/`, or download them
from the documentation page and serve them yourself.

## Use

Load the plugin's script and stylesheet after Froala's own, then add `eqneditor` to the toolbar
and give it your licence key:

```html
<link rel="stylesheet" href="node_modules/@codecogs/fxeditor-froala/eqneditor.css">
<script src="node_modules/@codecogs/fxeditor-froala/eqneditor.js"></script>
<script>
  new FroalaEditor('#editor', {
    toolbarButtons: ['bold', 'italic', '|', 'eqneditor'],
    eqneditorServer: 'fxtex.codecogs.com',
    eqneditorLicence: 'fx_pk_your-key-here',   // from the licence manager
    eqneditorDesign: { colour: '#0f7a4d' }     // optional
  });
</script>
```

Press the **fx** button to insert an equation, or click an existing one to edit it again (a
single click, not a double one - see below).

## Options

All optional, passed alongside Froala's own options:

| Option | Default | Meaning |
|---|---|---|
| `eqneditorServer` | `'fxtex.codecogs.com'` | Where the equation editor is loaded from - or your own fxTeX Server. A bare host means https. |
| `eqneditorLicence` | `''` | Your fxEditor licence key. Without one, equations show why they cannot render. |
| `eqneditorDesign` | `{}` | How the editor looks - toolbar, colour, sizes, the predictor. Build one with the design tool on the [documentation page](https://fxplugins.codecogs.com/docs/froala.html#customise). |
| `eqneditorRenderUrl` | `'https://latex.codecogs.com'` | The service that draws equations inserted as images. |
| `eqneditorScriptUrl` | derived from `eqneditorServer` | Full URL of the equation editor's script, when the default path does not suit. |
| `eqneditorCssUrl` | derived from `eqneditorServer` | Full URL of the equation editor's stylesheet. |
| `eqneditorMathmlCssUrl` | derived from `eqneditorServer` | The MathML stylesheet loaded into the editing view. |

### MathML needs a stylesheet on the page that displays it

Browsers' own MathML does not cover everything the converter produces, so a page that displays
MathML equations needs this line - the same file fxTeX ships:

```html
<link rel="stylesheet" href="https://fxtex.codecogs.com/fxtex.css">
```

The plugin loads it into the editing view for you; it cannot add it to the page that finally
displays the content, because that page is yours, not the editor's.

Unlike TinyMCE and CKEditor, Froala's own sanitiser allows every tag and attribute by default
(`htmlAllowedTags`/`htmlAllowedAttrs` both default to `['*']`), so nothing has to be configured
to let `<math>` through - just serve the stylesheet above wherever the content is published.
If a site has narrowed those options itself, keep `math` and the MathML element names on
whatever allow-list replaces the default.

## What gets written into the page

An equation goes in as MathML or as an image - the dialog's *Insert* menu, whose starting choice
is `design.insertAs` (`'mathml'` or `'svg'`). Either can be reopened by clicking it (a single
click, not a double one - see "Why a single click" below), because each carries the LaTeX it was
written from (in the image's `alt`, or the `<math>` element's `title`).

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
