/*
 * CodeCogs Equation Editor plugin for Froala Editor.
 *
 * Requirements: Froala Editor 3 or 4.
 *
 * Load this file after froala_editor.min.js, then add 'eqneditor' to your toolbarButtons:
 *
 *   new FroalaEditor('#editor', {
 *       toolbarButtons: ['bold', 'italic', '|', 'eqneditor'],
 *
 *       // Optional:
 *       eqneditorServer: 'https://fxtex.codecogs.com',  // where the editor's own code is served from
 *       eqneditorRenderUrl: 'https://fxtex.codecogs.com'   // where equations are rendered
 *   });
 *
 * The dialog is maths-view only: no LaTeX markup and no rendered-equation preview are visible
 * until the author asks for them (the LaTeX and Inline toggles, bottom-left of the footer).
 * Insert writes MathML directly by default - a dropdown next to those toggles switches to an
 * <img> against the SVG rendering service instead.
 *
 * Froala's own htmlAllowedTags/htmlAllowedAttrs default to finite HTML5 allowlists that
 * include neither <math>'s elements nor referrerpolicy - this plugin extends editor.opts with
 * both itself (see _init()), so nothing needs configuring on the host page's side.
 */

( function () {
    'use strict';

    if ( typeof FroalaEditor === 'undefined' ) {
        console.warn( 'eqneditor: FroalaEditor is not defined - load froala_editor.min.js first.' );
        return;
    }

    // Presentation MathML, plus the three non-"m" elements the converter can emit. Froala's
    // own htmlAllowedTags/htmlAllowedAttrs default to finite HTML5 allowlists - not "allow
    // everything", despite what this file used to assume (confirmed by inspecting them
    // directly in the vendored froala_editor.pkgd.min.js after an "Insert as MathML" silently
    // came out as the title attribute's plain text instead of the equation: <math> and its
    // children are not on either list, and nor is referrerpolicy, so both need adding - see
    // _init() below, which is the only place editor.opts exists to extend them from.
    var MATHML_ELEMENTS = [
        'math', 'semantics', 'annotation', 'annotation-xml',
        'mrow', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mspace', 'mglyph',
        'mfrac', 'msqrt', 'mroot', 'mstyle', 'merror', 'mpadded', 'mphantom', 'menclose',
        'msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover',
        'mmultiscripts', 'mprescripts', 'none',
        'mtable', 'mtr', 'mtd', 'mlabeledtr', 'maction'
    ];

    // The SVG fxTeX Pro draws chemical structures (chemfig) and pictures (the picture environment)
    // with, inside the MathML, and the attributes it uses. Named one by one, unlike MathML: SVG has
    // event attributes (onload and the rest) that a content filter must not let through.
    // MathML's own attributes, which Froala's list does not have either: without them, \mathrm and
    // the rest lost their mathvariant, and stretchy brackets, spacing and tables their settings.
    var MATHML_ATTRIBUTES = [ 'mathvariant', 'mathsize', 'mathcolor', 'mathbackground', 'displaystyle', 'scriptlevel',
        'stretchy', 'fence', 'separator', 'lspace', 'rspace', 'accent', 'accentunder', 'movablelimits', 'largeop',
        'symmetric', 'minsize', 'maxsize', 'linethickness', 'depth', 'voffset', 'notation', 'encoding',
        'columnalign', 'rowalign', 'columnspacing', 'rowspacing', 'columnlines', 'rowlines', 'frame',
        'framespacing', 'columnspan', 'rowspan', 'open', 'close', 'separators', 'actiontype', 'selection' ];

    var SVG_ELEMENTS = [ 'svg', 'g', 'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse',
        'text', 'tspan', 'defs', 'use', 'title', 'desc' ];
    var SVG_ATTRIBUTES = [ 'xmlns', 'xmlns:xlink', 'version', 'viewBox', 'preserveAspectRatio', 'width', 'height',
        'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'dx', 'dy', 'd', 'points', 'transform',
        'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
        'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity',
        'font-family', 'font-size', 'font-style', 'font-weight', 'text-anchor', 'dominant-baseline',
        'href', 'xlink:href', 'id', 'class', 'style', 'role', 'aria-label', 'aria-hidden', 'focusable', 'overflow',
        'viewbox', 'preserveaspectratio' ];

    var DEFAULT_EDITOR_HOST = 'https://fxtex.codecogs.com';
    var DEFAULT_RENDER_URL = 'https://fxtex.codecogs.com';

    // Same fx wordmark used by the CKEditor 5 and TinyMCE plugins, as the two <path> elements
    // Froala's own built-in 'svgMultiplePath' icon template wants (it substitutes [VIEWBOX]
    // and [PATHS] into '<svg viewBox="[VIEWBOX]" ...>[PATHS]</svg>' - see MODULES.icon in
    // froala_editor.pkgd.min.js). A single wrapping <svg> string, which is what DefineIcon's
    // own example-looking SVG_KEY option actually suggests, does NOT work: SVG_KEY is a
    // lookup key into Froala's *own* built-in icon set (FroalaEditor.SVG), not a slot for
    // arbitrary markup, so a custom icon has to supply PATHS/VIEWBOX directly instead.
    var LOGO_ICON_VIEWBOX = '0 0 18 20';
    var LOGO_ICON_PATHS =
        '<path d="M4,9.5H2L2.3,7h2.1l0.3-1.8C4.7,4.6,4.9,4.1,5,3.6c0.2-0.5,0.4-0.9,0.7-1.3c0.3-0.4,0.8-0.7,1.3-0.9' +
        'C7.7,1.1,8.4,1,9.2,1c0.3,0,0.6,0,0.9,0c0.3,0,0.6,0.1,0.9,0.1l-0.5,2.7c-0.2-0.1-0.3-0.1-0.5-0.2' +
        'c-0.1,0-0.3-0.1-0.5-0.1C9,3.7,8.6,3.8,8.4,4C8.1,4.2,7.9,4.7,7.8,5.4L7.6,7h2.3L9.5,9.5H7.2l-1.1,7.7H3L4,9.5z"/>' +
        '<path d="M11.1,15.3l-2.3-3.2h2.5l1.2,1.8l1.2-1.8H16l-2.2,3.2l2.6,3.6h-2.5l-1.5-2.3L10.8,19H8.4L11.1,15.3z"/>';

    // Kept as a plain wrapped SVG string too, for the dialog header logo/link, which is
    // ordinary innerHTML rather than something routed through Froala's icon template system.
    var LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="20" viewBox="' +
        LOGO_ICON_VIEWBOX + '">' + LOGO_ICON_PATHS + '</svg>';

    FroalaEditor.DefineIcon( 'eqneditor', {
        template: 'svgMultiplePath',
        VIEWBOX: LOGO_ICON_VIEWBOX,
        PATHS: LOGO_ICON_PATHS
    } );

    // One shared download per URL, however many editor instances a page has - same approach
    // as the TinyMCE and CKEditor 5 plugins.
    var scriptPromises = {};

    function loadScriptOnce( url ) {
        if ( scriptPromises[ url ] ) return scriptPromises[ url ];

        scriptPromises[ url ] = new Promise( function ( resolve, reject ) {
            if ( typeof window.EqEditor !== 'undefined' ) {
                resolve();
                return;
            }

            var existing = document.querySelector( 'script[src="' + url + '"]' );
            var script = existing || document.createElement( 'script' );

            script.addEventListener( 'load', function () { resolve(); } );
            script.addEventListener( 'error', function () {
                reject( new Error( 'CodeCogs Equation Editor: could not load ' + url ) );
            } );

            if ( !existing ) {
                script.src = url;
                document.head.appendChild( script );
            }
        } );

        return scriptPromises[ url ];
    }

    // EqEditor.init() switches the converter every TextArea/MathView/Toolbar construction takes
    // on to fxTeX Pro - skip it and they keep the placeholder converter for their whole
    // lifetime, even once fxeditor.api.min.js itself has loaded. Called once per page; an
    // empty licence is the normal, expected state until a real one is configured.
    // fxTeX Pro's optional packages are off unless named here: without them \ce, \chemfig,
    // \dv and the picture environment were unknown commands, shown as their letters.
    var initPromise = null;

    function ensureInit( licence ) {
        if ( initPromise ) return initPromise;
        initPromise = ( typeof EqEditor.init === 'function' )
            ? EqEditor.init( { licence: licence || '', packages: [ 'mhchem', 'chemfig', 'physics', 'picture' ] } ).catch( function ( err ) {
                window.console && console.warn( 'fxTeX Pro: ' + ( err && err.message || err ) );
            } )
            : Promise.resolve();
        return initPromise;
    }

    function loadCssOnce( url ) {
        if ( document.querySelector( 'link[href="' + url + '"]' ) ) return;
        var link = document.createElement( 'link' );
        link.rel = 'stylesheet';
        link.href = url;
        document.head.appendChild( link );
    }

    // fxtex.css styles inserted MathML. fxTeX Pro (which EqEditor.init() loads when the dialog
    // first opens) puts the same rules on the page itself as <style id="fxtex-style">, unless
    // an element with that id is already there - so this adds the file under that id, and only
    // when nothing has claimed it yet: the page never carries two copies. Froala's content is
    // part of the page, and MathML already in it needs styling before the dialog has ever been
    // opened, which is why the file is still loaded here at all. With `iframe: true` the
    // content is a separate document fxTeX Pro never reaches, and the file goes there instead.
    function loadFxtexStyleOnce( url, doc ) {
        if ( doc.getElementById( 'fxtex-style' ) || doc.querySelector( 'link[href="' + url + '"]' ) ) return;
        var link = doc.createElement( 'link' );
        link.id = 'fxtex-style';
        link.rel = 'stylesheet';
        link.href = url;
        ( doc.head || doc.documentElement ).appendChild( link );
    }

    function decodeEquation( encoded ) {
        var latex = encoded;
        try {
            latex = decodeURIComponent( encoded );
        } catch ( e ) {
            // Not valid percent-encoding; still worth showing as it stands.
        }
        return latex.replace( /&space;/g, ' ' ).replace( /&plus;/g, '+' ).replace( /&hash;/g, '#' );
    }

    // "Insert as LaTeX": the equation as text fxTeX Pro typesets where the page is shown - $...$
    // inline, $$...$$ on its own line - the delimiters fxTeX Pro looks for by default.
    function texOf( latex, inline ) {
        return inline ? '$' + latex + '$' : '$$' + latex + '$$';
    }

    // The $...$ or $$...$$ in `text` that `offset` is in or at the edge of, read as fxTeX Pro reads
    // it: $$ opens a display equation and a single $ an inline one, each closed by the same, and
    // \$ is a dollar sign, not a delimiter. Returns { start, end, latex, display }, or null.
    function texAround( text, offset ) {
        var i = 0;
        while ( i < text.length ) {
            var c = text.charAt( i );
            if ( c === '\\' ) { i += 2; continue; }
            if ( c !== '$' ) { i++; continue; }
            var display = text.charAt( i + 1 ) === '$', size = display ? 2 : 1, j = i + size;
            while ( j < text.length && !( text.charAt( j ) === '$' && ( !display || text.charAt( j + 1 ) === '$' ) ) ) {
                j += text.charAt( j ) === '\\' ? 2 : 1;
            }
            if ( j >= text.length ) return null;
            var end = j + size;
            if ( offset >= i && offset <= end ) {
                var latex = text.slice( i + size, j ).trim();
                return latex ? { start: i, end: end, latex: latex, display: display } : null;
            }
            i = end;
        }
        return null;
    }

    // The LaTeX equation at a point in the page's text (a text node and an offset in it, as a
    // selection gives), as texAround() describes, or null where there is none. Read across the
    // run of text nodes the point is in, as an editor often leaves one line's text in several.
    // Returns { tex: true, latex, display, text, start, end }, start and end being { node, offset }.
    function texAt( node, offset ) {
        if ( !node || node.nodeType !== 3 ) return null;
        var first = node, runs = [], text = '', at = 0;
        while ( first.previousSibling && first.previousSibling.nodeType === 3 ) first = first.previousSibling;
        for ( var n = first; n && n.nodeType === 3; n = n.nextSibling ) {
            if ( n === node ) at = text.length + offset;
            runs.push( { node: n, from: text.length } );
            text += n.data;
        }
        var found = texAround( text, at );
        if ( !found ) return null;
        // The node and offset `i` characters into the run - where a start or an end falls on the
        // join between two nodes, in the one the equation is in.
        var point = function ( i, isEnd ) {
            for ( var k = runs.length - 1; k > 0; k-- ) {
                if ( isEnd ? runs[ k ].from < i : runs[ k ].from <= i ) break;
            }
            return { node: runs[ k ].node, offset: i - runs[ k ].from };
        };
        return { tex: true, latex: found.latex, display: found.display, text: text.slice( found.start, found.end ),
            start: point( found.start, false ), end: point( found.end, true ) };
    }

    // A DOM range over the LaTeX equation `tex` (from texAt()) if it is still in `body`,
    // unchanged, where it was found - else null.
    function texRange( tex, body ) {
        if ( !tex || !body.contains( tex.start.node ) || !body.contains( tex.end.node ) ) return null;
        var range = body.ownerDocument.createRange();
        try {
            range.setStart( tex.start.node, tex.start.offset );
            range.setEnd( tex.end.node, tex.end.offset );
        } catch ( e ) { return null; }
        return range.toString() === tex.text ? range : null;
    }

    // An image equation's LaTeX, read back from its rendering URL, starts with the \inline the editor
    // put there for an inline equation. Taken off, as the editor adds it again (left on, it showed in
    // the editor and each edit added another), and given back as whether the equation is inline.
    function splitInline( latex ) {
        var found = /^\s*\\inline\b\s*/.exec( latex );
        return { latex: found ? latex.slice( found[ 0 ].length ) : latex, inline: !!found };
    }

    // The Inline switch as the dialog opens: an edited LaTeX equation's own form ($ inline, $$
    // not), otherwise what the author last chose. Set without a change event, so editing one
    // equation does not change the remembered choice; `apply` shows the change in the dialog.
    function startInline( toggle, inline, apply ) {
        if ( !toggle || toggle.disabled ) return;
        if ( typeof inline !== 'boolean' ) {
            var prefs = {};
            try { prefs = JSON.parse( localStorage.getItem( EDITOR_PREFS_KEY ) ) || {}; } catch ( e ) {}
            inline = typeof prefs.inline === 'boolean' ? prefs.inline : toggle.defaultChecked;
        }
        if ( toggle.checked !== inline ) {
            toggle.checked = inline;
            apply( inline );
        }
    }

    // A piece of text as runs of plain text and LaTeX equations, read as texAround() reads them:
    // [{ text }, { text, tex: { latex, display } }, ...] - each run's text exactly as it is in the piece,
    // delimiters and all, so joining the runs gives the piece back unchanged.
    function texPieces( text ) {
        var pieces = [], i = 0, from = 0;
        while ( i < text.length ) {
            var c = text.charAt( i );
            if ( c === '\\' ) { i += 2; continue; }
            if ( c !== '$' ) { i++; continue; }
            var display = text.charAt( i + 1 ) === '$', size = display ? 2 : 1, j = i + size;
            while ( j < text.length && !( text.charAt( j ) === '$' && ( !display || text.charAt( j + 1 ) === '$' ) ) ) {
                j += text.charAt( j ) === '\\' ? 2 : 1;
            }
            if ( j >= text.length ) break;
            var end = j + size, latex = text.slice( i + size, j ).trim();
            if ( latex ) {
                if ( i > from ) pieces.push( { text: text.slice( from, i ) } );
                pieces.push( { text: text.slice( i, end ), tex: { latex: latex, display: display } } );
                from = end;
            }
            i = end;
        }
        if ( from < text.length ) pieces.push( { text: text.slice( from ) } );
        return pieces;
    }

    // The LaTeX equation in `source` (all of it, delimiters and all, as texPieces() gives it), or null.
    function texOfSource( source ) {
        var pieces = texPieces( source || '' );
        return pieces.length === 1 && pieces[ 0 ].tex ? pieces[ 0 ].tex : null;
    }

    // How LaTeX shown as maths sits in the editing area (see texAsMaths in the plugin): a display
    // equation on a line of its own, as fxTeX puts it on the page that shows the content.
    var TEX_SKIP = { CODE: 1, PRE: 1, SCRIPT: 1, STYLE: 1, TEXTAREA: 1, MATH: 1, SVG: 1 };
    var texStylesInjected = false;
    function injectTexStylesOnce() {
        if ( texStylesInjected ) return;
        texStylesInjected = true;
        var style = document.createElement( 'style' );
        style.textContent = '.cc-tex { cursor: default; } .cc-tex-display { display: block; text-align: center; margin: 0.5em 0; }' +
            ' .cc-tex-math + .cc-tex-src { display: none; }';
        document.head.appendChild( style );
    }

    function escapeHtml( s ) {
        return String( s )
            .replace( /&/g, '&amp;' ).replace( /</g, '&lt;' )
            .replace( />/g, '&gt;' ).replace( /"/g, '&quot;' );
    }

    // Gaps in the shared fxeditor.css (loaded separately, asynchronously, from the host
    // configured above) this dialog needs but can't assume it will get: editor.codecogs.com,
    // the old default host and still configurable, serves an older stylesheet that predates the CCEqnEditor/
    // CCMathViewHost/CCLatexInput class names entirely (only a local dev mirror does not have
    // this gap), so the maths/LaTeX mutual-exclusion is written defensively here rather than
    // left to fxeditor.css. !important throughout, injected once rather than relying on load
    // order against fxeditor.css: which stylesheet's rule wins would otherwise depend on which
    // finishes loading last.
    // The API's own injected @font-face for "Latin Modern Math" only carries
    // local("Latin Modern Math") - no url() fallback - so it silently falls back to a generic
    // serif unless that exact font happens to be installed. A later @font-face for the same
    // family replaces the API's src list rather than merging with it, so redeclaring it here
    // with a real url() fixes every equation and symbol on the page, not just this dialog's.
    function injectStyleOverridesOnce( fontUrl ) {
        if ( document.getElementById( 'cc-eqneditor-style-overrides' ) ) return;
        var style = document.createElement( 'style' );
        style.id = 'cc-eqneditor-style-overrides';
        style.textContent =
            '@font-face { font-family: "Latin Modern Math"; font-display: swap; ' +
                'src: local("Latin Modern Math"), url("' + fontUrl.replace( /prototypes\/latinmodern-math\.otf$/, 'fonts/LatinModernMath-Regular.woff2' ) + '") format("woff2"), url("' + fontUrl + '") format("opentype"); }' +
            // Undo host resets (e.g. .cke_reset_all *) inside the toolbar icons and the maths view's MathML.
            '.CCToolbar svg:has(g[font-family]), .CCToolbar svg:has(g[font-family]) * { font: revert-layer !important; }' +
            // Icons drawn as <text>: the svg gets the API's own .cc_panel font (fxTeX Toolbar, 16px) back over host resets, and each <text> its own font-size attribute (revert-layer lets attributes win).
            '.CCToolbar svg:not(:has(g[font-family])) { font: normal normal 16px "fxTeX Toolbar" !important; }' +
            '.CCToolbar svg:not(:has(g[font-family])) * { font: revert-layer !important; }' +
            '.CCToolbar svg, .CCToolbar svg * { width: revert-layer !important; height: revert-layer !important; max-width: revert-layer !important; }' +
            '.CCToolbar svg g[font-family="fxTeX Toolbar"] { color: #000 !important; }' +
            '.CCMathView math, .CCMathView math * { font: revert-layer !important; ' +
                'width: revert-layer !important; height: revert-layer !important; padding: revert-layer !important; ' +
                'margin: revert-layer !important; text-transform: revert-layer !important; text-align: revert-layer !important; ' +
                'box-sizing: revert-layer !important; white-space: revert-layer !important; }' +
            apiMathRules() +
            // The bottom bar: toggles left, Insert-as and the dialog's buttons right, one type size. All !important - host dialog resets otherwise restyle it.
            '.cc-eqn-bar { display: flex !important; flex-wrap: wrap !important; align-items: center !important; gap: 16px !important; flex: 0 0 auto !important; ' +
                'margin: 8px 0 0 !important; padding: 10px 0 0 !important; border: 0 !important; border-top: 1px solid #e2e8f0 !important; ' +
                'background: none !important; font: 13px/1.3 system-ui, -apple-system, "Segoe UI", Arial, sans-serif !important; color: #1c2530 !important; }' +
            '.cc-eqn-bar-right { display: flex !important; align-items: center !important; gap: 8px !important; margin: 0 0 0 auto !important; padding: 0 !important; font: inherit !important; color: inherit !important; }' +
            '.cc-eqn-bar .cc-switch { display: inline-flex !important; align-items: center !important; gap: 6px !important; margin: 0 !important; ' +
                'padding: 0 !important; font: inherit !important; color: #54647c !important; cursor: pointer !important; user-select: none !important; white-space: nowrap !important; }' +
            '.cc-eqn-bar .cc-switch input { position: absolute !important; width: 1px !important; height: 1px !important; margin: -1px !important; ' +
                'padding: 0 !important; border: 0 !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; opacity: 0 !important; }' +
            '.cc-eqn-bar .cc-switch-track { position: relative !important; display: inline-block !important; flex: 0 0 auto !important; width: 28px !important; ' +
                'height: 16px !important; margin: 0 !important; padding: 0 !important; border: 0 !important; border-radius: 8px !important; ' +
                'background: #ccc !important; transition: background .2s !important; }' +
            '.cc-eqn-bar .cc-switch-knob { position: absolute !important; display: block !important; top: 2px !important; left: 2px !important; ' +
                'width: 12px !important; height: 12px !important; margin: 0 !important; border-radius: 50% !important; background: #fff !important; transition: left .2s !important; }' +
            '.cc-eqn-bar .cc-switch input:checked + .cc-switch-track { background: #4caf50 !important; }' +
            '.cc-eqn-bar .cc-switch input:checked + .cc-switch-track .cc-switch-knob { left: 14px !important; }' +
            '.cc-eqn-bar .cc-switch input:focus-visible + .cc-switch-track { outline: 2px solid #003794 !important; outline-offset: 2px !important; }' +
            '.cc-eqn-bar .cc-switch input:disabled ~ * { opacity: .5 !important; cursor: default !important; }' +
            '.cc-eqn-bar .cc-switch-label { font: inherit !important; color: inherit !important; }' +
            '.cc-eqn-bar .cc-switch input:checked ~ .cc-switch-label { color: #003794 !important; font-weight: 600 !important; }' +
            '.cc-eqn-bar .cc-eqn-select { width: auto !important; height: 30px !important; margin: 0 !important; padding: 0 8px !important; ' +
                'border: 1px solid #cbd5e0 !important; border-radius: 4px !important; background: #fff !important; font: inherit !important; color: #1c2530 !important; cursor: pointer !important; }' +
            '.cc-eqn-bar .cc-eqn-btn { display: inline-flex !important; align-items: center !important; height: 30px !important; margin: 0 !important; ' +
                'padding: 0 16px !important; border: 1px solid #cbd5e0 !important; border-radius: 4px !important; background: #fff !important; ' +
                'font: inherit !important; color: #1c2530 !important; cursor: pointer !important; box-shadow: none !important; }' +
            '.cc-eqn-bar .cc-eqn-btn * { font: inherit !important; color: inherit !important; }' +
            '.cc-eqn-bar .cc-eqn-btn.cc-eqn-primary { background: #2c7a4b !important; border-color: #2c7a4b !important; color: #fff !important; }' +
            '.cc-eqneditor-modal-footer.cc-eqn-bar { margin: 0 !important; padding: 10px 14px !important; }' +
            '.CCMathViewHost, .CCLatexInput { min-height: 220px !important; }' +
            '.CCEqnEditor[data-latex="on"] .CCMathViewHost { display: none !important; }' +
            '.CCEqnEditor[data-latex="off"] .CCLatexInput { display: none !important; }' +
            '.CCEqnEditor[data-inline="on"] .CCMathViewHost { justify-content: flex-start !important; }';
        document.head.appendChild( style );
    }

    // Re-asserts the API's own .CCMathView/.fxtex rules, which host resets and revert-layer override.
    // The `design` option (see the README): how the editor looks, set by the site rather than the
    // author. The toolbar's rows and scale go to Toolbar.link() itself; everything else is applied
    // here, once the editor is mounted - CSS scoped to this editor's root, then the starting state of
    // the LaTeX toggle and the "Insert as" menu.
    // The dialog's size when the design does not set one: about 700 by 450 pixels.
    var DEFAULT_WIDTH = 700, DEFAULT_HEIGHT = 450;
    function designWidth( design ) { return Number( design && design.width ) > 0 ? Number( design.width ) : DEFAULT_WIDTH; }
    function designHeight( design ) { return Number( design && design.height ) > 0 ? Number( design.height ) : DEFAULT_HEIGHT; }
    // Gives an inserted image its size in em once the API has read it (Output.imageSize()): set on
    // the image after it goes in, since waiting before inserting it would lose the host's selection.
    // Marked with data-cc-size until then; an API without imageSize() leaves the image as it was.
    var sizingCount = 0;
    function sizeImage( output, apply ) {
        if ( !output || typeof output.imageSize !== 'function' ) return '';
        var mark = 'cc-size-' + ( ++sizingCount ) + '-' + Date.now();
        output.imageSize().then( function ( size ) { apply( mark, size ); } );
        return ' data-cc-size="' + mark + '"';
    }
    // The size an equation on the page was inserted at - read once the API has loaded, which may
    // be after the double-click that asked for it. 1 without one.
    function sizeOf( el ) {
        return el && window.EqEditor && EqEditor.Output && ( EqEditor.Output.scaleOf || EqEditor.Output.equationSizeOf )
            ? ( EqEditor.Output.scaleOf || EqEditor.Output.equationSizeOf ).call( EqEditor.Output, el ) : 1;
    }

    var designCount = 0;
    function applyDesign( root, design, latexToggle, insertSelect ) {
        if ( !root || !design ) return;
        if ( !root.id ) root.id = 'cc-eqn-design-' + ( ++designCount );
        var sel = '#' + root.id, css = '';
        var colour = String( design.colour || '' );
        if ( /^(#[0-9a-f]{3,8}|[a-z]+)$/i.test( colour ) ) {
            css += sel + ' { --cc-accent: ' + colour + ';' +
                ' --cc-accent-soft: color-mix(in srgb, ' + colour + ' 11%, #fff);' +
                ' --cc-accent-soft-ring: color-mix(in srgb, ' + colour + ' 28%, #fff);' +
                ' --cc-accent-mid: color-mix(in srgb, ' + colour + ' 22%, #fff);' +
                ' --cc-accent-mid-ring: color-mix(in srgb, ' + colour + ' 43%, #fff); }';
        }
        if ( Number( design.mathSize ) > 0 ) css += sel + ' .CCMathView { font-size: ' + Number( design.mathSize ) + 'px !important; }';
        if ( Number( design.latexSize ) > 0 ) css += sel + ' .CCLatexInput { font-size: ' + Number( design.latexSize ) + 'px !important; }';
        if ( design.toolbar === false ) css += sel + ' .CCToolbar { display: none !important; }';
        if ( design.history === false ) css += sel + ' .CCEditorBar { display: none !important; }';
        if ( css ) {
            var style = document.createElement( 'style' );
            style.textContent = css;
            root.appendChild( style );
        }
        // The dialog's width and height (`width`, `height`), before any scaling: the box takes the width,
        // and the editing area whatever height makes the whole dialog the height asked for - measured,
        // since everything else in it (toolbar rows, the bottom bar) varies with the design. Hosts that
        // size their dialogs themselves (TinyMCE 4, CKEditor 4) are given both when they open it instead.
        var sizedBox = root.closest( '.tox-dialog, .mce-window, .cke_dialog, .ck-balloon-panel, .cc-eqneditor-modal, .tc-drop-down' ) || root;
        if ( !sizedBox.matches( '.mce-window, .cke_dialog' ) ) {
            sizedBox.style.setProperty( 'width', designWidth( design ) + 'px', 'important' );
            var area = root.querySelector( '.CCMathViewHost' );
            if ( area ) {
                // Measured, then measured again as the dialog settles - the toolbar fits itself to its row
                // after the dialog first lays out, and the fonts arrive - correcting by the difference each time.
                // A box with a height of its own (Froala's and Tiptap's modals) sizes to its contents instead.
                sizedBox.style.setProperty( 'height', 'auto', 'important' );
                var sizing = document.createElement( 'style' );
                root.appendChild( sizing );
                var h = 0;
                var fit = function () {
                    var shown = root.querySelector( '.CCLatexInput' ) && getComputedStyle( area ).display === 'none'
                        ? root.querySelector( '.CCLatexInput' ) : area;
                    // Scale may already be applied (see below), and on-screen sizes include it.
                    var applied = parseFloat( sizedBox.style.zoom ) || parseFloat( ( sizedBox.style.transform.match( /scale\(([\d.]+)\)/ ) || [] )[ 1 ] ) || 1;
                    var now = h || shown.getBoundingClientRect().height / applied;
                    h = Math.max( 120, Math.round( now + designHeight( design ) - sizedBox.getBoundingClientRect().height / applied ) );
                    // Never taller than the whole dialog asked for: a host that caps its dialog (and scrolls the
                    // rest) would otherwise be chased upwards on every pass.
                    h = Math.min( h, designHeight( design ) );
                    sizing.textContent = '#' + root.id + ' { height: auto !important; } #' + root.id + ' .CCMathViewHost, #' + root.id + ' .CCLatexInput { height: ' + h + 'px !important; min-height: ' + h + 'px !important; }';
                };
                fit();
                [ 150, 500, 1200 ].forEach( function ( t ) { setTimeout( fit, t ); } );
            }
        }
        // The whole dialog, box and contents together - see `dialogSize` in the README. Zoomed where
        // the host lays the dialog out (it grows in place); scaled where the host positions it itself
        // (CKEditor, TinyMCE 4, a TiddlyWiki drop-down), so that placement still holds.
        var size = Number( design.dialogSize );
        if ( size > 0 && size !== 1 ) {
            var box = root.closest( '.tox-dialog, .mce-window, .cke_dialog, .ck-balloon-panel, .cc-eqneditor-modal, .tc-drop-down' ) || root;
            var position = getComputedStyle( box ).position;
            if ( position === 'absolute' || position === 'fixed' ) {
                box.style.transform = 'scale(' + size + ')';
                box.style.transformOrigin = box.matches( '.ck-balloon-panel' ) ? 'top center'
                    : box.matches( '.tc-drop-down' ) ? 'top left' : 'center center';
                // A cap on the box's width (CKEditor 5's balloon: 96vw) holds before the scale - divided by it,
                // as for zoom below, or a scaled-down box is squeezed narrower than its own contents.
                box.style.removeProperty( 'max-width' );   // a host that reuses the box (CKEditor 5) would otherwise divide it again
                var cap = getComputedStyle( box ).maxWidth;
                if ( cap !== 'none' ) box.style.setProperty( 'max-width', 'calc(' + cap + ' / ' + size + ')', 'important' );
            } else {
                box.style.zoom = String( size );
                box.style.setProperty( 'max-width', 'calc(96vw / ' + size + ')', 'important' );   // still no wider than the window
            }
        }
        // The design's choice, unless the author has made their own (addEditorControls()).
        if ( insertSelect && design.insertAs && !insertSelect.hasAttribute( 'data-cc-remembered' ) && insertSelect.querySelector( 'option[value="' + design.insertAs + '"]' ) ) {
            insertSelect.value = design.insertAs;
        }
        if ( latexToggle && design.latex && !latexToggle.checked && !latexToggle.disabled ) {
            latexToggle.checked = true;
            latexToggle.dispatchEvent( new Event( 'change', { bubbles: true } ) );
        }
    }

    // Ready to type into, with its cursor showing: the MathView (or the LaTeX pane, when that is the
    // one showing) takes focus as the dialog opens - otherwise focus stays on whatever opened it.
    // The API draws the MathView's caret where the cursor is at that moment and only redraws it on an
    // edit or on focus, but a dialog goes on settling after it opens (fonts arrive, the toolbar fits
    // itself to its row) and moves the equation out from under it. Its focus handler only redraws
    // (the cursor stays where it is), so it is fired again whenever the editing area changes size.
    // The equation as an image URL ('url') or as MathML ('mathml'). fxeditor-api replaced Output.exportAs()
    // with getEquationURL() and setFormat()/setWrapper()/getCode() (its 9630657); exportAs() still serves an
    // API from before that. The format is set each time: the same Output gives both.
    function outputCode( output, kind ) {
        if ( typeof output.exportAs === 'function' ) return output.exportAs( kind );
        if ( kind === 'mathml' ) return output.setFormat( 'mathml' ).setWrapper( 'html' ).getCode();
        return output.setFormat( 'svg' ).getEquationURL();
    }

    // Where "Insert as" starts each time the dialog opens - this one is built once and reused, so it
    // would otherwise keep whatever the last open left: the form of the equation being edited, else the
    // author's last choice (addEditorControls()), else the design's, else the dialog's own default.
    function startInsertAs( select, format, design ) {
        if ( !select ) return;
        var prefs = {};
        try { prefs = JSON.parse( localStorage.getItem( EDITOR_PREFS_KEY ) ) || {}; } catch ( e ) {}
        var choices = [ format, prefs.insertAs, design && design.insertAs ];
        for ( var i = 0; i < choices.length; i++ ) {
            if ( choices[ i ] && select.querySelector( 'option[value="' + choices[ i ] + '"]' ) ) {
                select.value = choices[ i ];
                return;
            }
        }
        for ( var j = 0; j < select.options.length; j++ ) {
            if ( select.options[ j ].defaultSelected ) select.value = select.options[ j ].value;
        }
    }

    // The editor's own controls, as the Google Docs sidebar has them: the toolbar's size (50-120%) at the
    // right of the undo/redo bar; Inline, LaTeX and Predictor switches together - Inline added where a
    // host has none, Predictor beside LaTeX; and LaTeX shown above the maths view rather than in its place
    // (see stackPanes()). The size, Inline, LaTeX, Predictor and the markup's height are remembered here;
    // the predictor starts as design.predictor says until the author has chosen. `parts` carries the
    // editor's textArea, mathView and output, and the latexToggle and inlineToggle checkboxes.
    var EDITOR_PREFS_KEY = 'cc-eqn-editor';
    function addEditorControls( root, design, parts ) {
        if ( !root || !parts ) return;
        design = design || {};
        injectPredictorStylesOnce();
        var prefs = {};
        try { prefs = JSON.parse( localStorage.getItem( EDITOR_PREFS_KEY ) ) || {}; } catch ( e ) {}
        var save = function () {
            try { localStorage.setItem( EDITOR_PREFS_KEY, JSON.stringify( prefs ) ); } catch ( e ) {}
        };
        var latexLabel = parts.latexToggle && parts.latexToggle.closest( 'label' );
        // Another switch drawn exactly as the LaTeX one is - whatever markup and styling this host gives it.
        var makeSwitch = function ( text, title ) {
            var label = latexLabel.cloneNode( true );
            var input = label.querySelector( 'input' );
            input.removeAttribute( 'id' );
            input.className = '';
            for ( var i = input.attributes.length - 1; i >= 0; i-- ) {
                if ( /^data-/.test( input.attributes[ i ].name ) ) input.removeAttribute( input.attributes[ i ].name );
            }
            input.checked = false;
            input.disabled = false;
            label.removeAttribute( 'for' );
            label.title = title;
            var name = label.querySelector( '.cc-switch-label' );
            if ( name ) name.textContent = text;
            return label;
        };

        // The toolbar's size. zoom scales it as it stands, so nothing is rebuilt: it keeps which pane it
        // types into, and any panel that is open.
        var toolbar = root.querySelector( '.CCToolbar' ), bar = root.querySelector( '.CCEditorBar' );
        if ( toolbar && bar && design.toolbar !== false && !bar.querySelector( '.cc-toolbar-size' ) ) {
            var size = document.createElement( 'label' );
            size.className = 'cc-toolbar-size';
            size.title = 'The toolbar’s size';
            size.innerHTML = '<input type="range" min="50" max="120" step="5" aria-label="Toolbar size"><output></output>';
            bar.appendChild( size );
            var range = size.querySelector( 'input' ), shown = size.querySelector( 'output' );
            var setSize = function ( pct ) {
                pct = Math.min( 120, Math.max( 50, Math.round( Number( pct ) / 5 ) * 5 || 100 ) );
                prefs.toolbarSize = pct;
                toolbar.style.zoom = String( pct / 100 );
                range.value = pct;
                shown.textContent = pct + '%';
            };
            setSize( prefs.toolbarSize || 100 );
            range.addEventListener( 'input', function () { setSize( range.value ); } );
            range.addEventListener( 'change', save );
        }

        // Inline: the host's own switch, or one added before LaTeX where it has none.
        var inline = parts.inlineToggle;
        if ( !inline && latexLabel ) {
            var inlineLabel = makeSwitch( 'Inline', 'An inline equation, set to sit in a line of text' );
            latexLabel.parentNode.insertBefore( inlineLabel, latexLabel );
            inline = inlineLabel.querySelector( 'input' );
            inline.addEventListener( 'change', function () {
                root.setAttribute( 'data-inline', inline.checked ? 'on' : 'off' );
                if ( parts.mathView && parts.mathView.setInline ) parts.mathView.setInline( inline.checked );
                if ( parts.output && parts.output.setInline ) parts.output.setInline( inline.checked );
            } );
        }
        if ( inline ) {
            if ( typeof prefs.inline === 'boolean' && inline.checked !== prefs.inline && !inline.disabled ) {
                inline.checked = prefs.inline;
                inline.dispatchEvent( new Event( 'change', { bubbles: true } ) );
            }
            inline.addEventListener( 'change', function () { prefs.inline = inline.checked; save(); } );
        }

        // LaTeX: remembered with the rest (a host that keeps its own record is overruled by this one).
        var latex = parts.latexToggle;
        if ( latex ) {
            if ( typeof prefs.latex === 'boolean' && latex.checked !== prefs.latex && !latex.disabled ) {
                latex.checked = prefs.latex;
                latex.dispatchEvent( new Event( 'change', { bubbles: true } ) );
            }
            latex.addEventListener( 'change', function () { prefs.latex = latex.checked; save(); } );
        }

        // Insert as: the author's last choice, over the design's.
        var insertAs = parts.insertSelect;
        if ( insertAs ) {
            if ( prefs.insertAs && insertAs.querySelector( 'option[value="' + prefs.insertAs + '"]' ) ) {
                insertAs.value = prefs.insertAs;
                insertAs.setAttribute( 'data-cc-remembered', '' );
            }
            insertAs.addEventListener( 'change', function () { prefs.insertAs = insertAs.value; save(); } );
            // The equation's size, beside it - see addSizeSlider().
            addSizeSlider( insertAs, prefs, save, parts.sizeForMathML !== undefined ? parts.sizeForMathML : !!design.sizeControl );
        }

        stackPanes( root, prefs, save );

        // The predictor, switched on and off beside LaTeX.
        if ( latexLabel ) {
            var predictorBox = null;
            var predictor = addPredictor( root, design, parts.textArea, parts.mathView, function () {
                predictorBox.checked = false;
                prefs.predictor = false;
                save();
            } );
            if ( predictor ) {
                var predictorLabel = makeSwitch( 'Predictor', 'Suggested equations, as you write' );
                latexLabel.parentNode.insertBefore( predictorLabel, latexLabel.nextSibling );
                predictorBox = predictorLabel.querySelector( 'input' );
                predictorBox.checked = typeof prefs.predictor === 'boolean' ? prefs.predictor : !!design.predictor;
                predictor.setOn( predictorBox.checked );
                predictorBox.addEventListener( 'change', function () {
                    predictor.setOn( predictorBox.checked );
                    prefs.predictor = predictorBox.checked;
                    save();
                } );
            }
        }
    }

    // The equation's size against a normal one (Output.setScale()), in %: a slider just before Insert as,
    // as the Google sidebar has, with the size on its right. It shows while Insert as is an image (SVG or
    // PNG), which the scale sizes in em (Output.imageSize()), and for MathML too where the design asks for
    // it (design.sizeControl) and the host can scale MathML; never for LaTeX, which has no size of its own.
    // The size is remembered as prefs.size, and an equation being edited starts at its own size.
    var SIZE_MIN = 50, SIZE_MAX = 300, SIZE_STEP = 5;
    function isImageFormat( format ) { return format === 'svg' || format === 'png'; }
    function addSizeSlider( insertAs, prefs, save, forMathML ) {
        if ( !insertAs || !insertAs.parentNode || insertAs.parentNode.querySelector( '.cc-eqn-size' ) ) return;
        var label = document.createElement( 'label' );
        label.className = 'cc-eqn-size';
        label.title = 'The equation\u2019s size, against a normal one';
        label.innerHTML = '<span>Size</span><input type="range" min="' + SIZE_MIN + '" max="' + SIZE_MAX + '" step="' + SIZE_STEP + '">' +
            '<output></output>';
        insertAs.parentNode.insertBefore( label, insertAs );
        var range = label.querySelector( 'input' ), shown = label.querySelector( 'output' );
        var set = function ( pct ) {
            pct = Math.round( ( Number( pct ) || 100 ) / SIZE_STEP ) * SIZE_STEP;
            pct = Math.min( SIZE_MAX, Math.max( SIZE_MIN, pct ) );
            range.value = pct;
            shown.textContent = pct + '%';
            return pct;
        };
        var applies = function () { return isImageFormat( insertAs.value ) || ( forMathML && insertAs.value === 'mathml' ); };
        var follow = function () {
            if ( applies() ) label.style.removeProperty( 'display' );
            else label.style.setProperty( 'display', 'none', 'important' );
        };
        set( prefs.size );
        range.addEventListener( 'input', function () { prefs.size = set( range.value ); } );
        range.addEventListener( 'change', save );
        insertAs.addEventListener( 'change', follow );
        follow();
        // For the host: scale(), the size chosen, as Output.setScale() takes it, or 0 where the slider does
        // not apply; start(scale), as the dialog opens, shows an equation being edited at its own size (not
        // remembered), else the remembered one, and follows Insert as, which the host may have set itself.
        label.ccSize = {
            scale: function () { return applies() ? set( range.value ) / 100 : 0; },
            start: function ( scale ) { set( scale > 0 ? scale * 100 : prefs.size ); follow(); }
        };
    }
    // The Size slider in `root` (see addSizeSlider()), or null.
    function sizeSliderIn( root ) {
        var label = root && root.querySelector( '.cc-eqn-size' );
        return label && label.ccSize || null;
    }
    // The scale an image on the page was inserted at, against its natural size: from its width - a style
    // in em (the image server's 16px to the em) or px, or a width attribute - so it must have loaded.
    // 0 if unknown.
    function imageScaleOf( img ) {
        if ( !img || !img.nodeName || img.nodeName.toLowerCase() !== 'img' || !img.naturalWidth ) return 0;
        var width = /^([\d.]+)(px|em)$/.exec( img.style.width || '' ) || /^([\d.]+)()$/.exec( img.getAttribute( 'width' ) || '' );
        return width ? parseFloat( width[ 1 ] ) * ( width[ 2 ] === 'em' ? 16 : 1 ) / img.naturalWidth : 0;
    }

    // The LaTeX markup above the maths view while LaTeX is on, rather than in its place, with a bar
    // between them that drags (or arrow-keys) the markup taller or shorter - its height remembered as
    // prefs.latexHeight. Follows the editor root's data-latex, which every host's LaTeX switch sets, and
    // overrides the host's own rule hiding the maths view meanwhile (inline and !important, as that is).
    var LATEX_HEIGHT = 90, LATEX_MIN = 40;
    function stackPanes( root, prefs, save ) {
        var host = root.querySelector( '.CCMathViewHost' ), markup = root.querySelector( '.CCLatexInput' );
        if ( !host || !markup || root.querySelector( '.cc-eqn-panes' ) ) return;
        var panes = document.createElement( 'div' );
        panes.className = 'cc-eqn-panes';
        var first = ( markup.compareDocumentPosition( host ) & 4 ) ? markup : host;   // 4: host follows markup
        first.parentNode.insertBefore( panes, first );
        var grip = document.createElement( 'div' );
        grip.className = 'cc-eqn-panes-split';
        grip.tabIndex = 0;
        grip.setAttribute( 'role', 'separator' );
        grip.setAttribute( 'aria-orientation', 'horizontal' );
        grip.setAttribute( 'aria-label', 'Resize the LaTeX markup' );
        grip.title = 'Drag to share the space between the LaTeX and the equation';
        panes.appendChild( markup );
        panes.appendChild( grip );
        panes.appendChild( host );

        var height = Number( prefs.latexHeight ) >= LATEX_MIN ? Number( prefs.latexHeight ) : LATEX_HEIGHT;
        var set = function ( el, prop, value ) { el.style.setProperty( prop, value, 'important' ); };
        // A host that shows one pane at a time gives the editing area's height to whichever is showing:
        // with both showing, that area is shared - the markup's height, then the bar, then the equation
        // whatever is left. A host that shows both anyway sizes them itself; the markup's height is set.
        var apply = function () {
            var both = root.getAttribute( 'data-latex' ) === 'on';
            panes.classList.toggle( 'cc-eqn-both', both );
            [ 'height', 'min-height', 'flex', 'display' ].forEach( function ( p ) {
                markup.style.removeProperty( p );
                host.style.removeProperty( p );
            } );
            if ( !both ) return;
            set( markup, 'min-height', '0' );
            set( markup, 'flex', '0 0 auto' );
            if ( getComputedStyle( host ).display !== 'none' ) {
                set( markup, 'height', height + 'px' );
                return;
            }
            var area = markup.offsetHeight;   // what the host gives the markup alone: the whole area
            if ( !area ) return;              // not laid out yet - the ResizeObserver below comes back
            var bar = grip.offsetHeight + 2;
            var h = Math.min( height, Math.max( LATEX_MIN, area - bar - 60 ) );
            set( markup, 'height', h + 'px' );
            set( host, 'display', 'flex' );
            set( host, 'height', Math.max( 0, area - bar - h ) + 'px' );
            set( host, 'min-height', '0' );
            set( host, 'flex', '0 0 auto' );
        };
        var setHeight = function ( h ) {
            height = Math.round( Math.max( LATEX_MIN, h ) );
            apply();
        };
        apply();
        new MutationObserver( apply ).observe( root, { attributes: true, attributeFilter: [ 'data-latex' ] } );
        // The dialog lays out, or is resized, after this has run (TinyMCE 4's and WordPress's settle their
        // sizes a moment later): share the area it then has. The editor's root, not the panes, is watched -
        // the panes take the heights set here, so would not change to say so - and measured again as the
        // dialog settles, as applyDesign() measures its height.
        var again = function () { if ( panes.classList.contains( 'cc-eqn-both' ) ) apply(); };
        if ( typeof ResizeObserver !== 'undefined' ) new ResizeObserver( again ).observe( root );
        [ 150, 500, 1200 ].forEach( function ( t ) { setTimeout( again, t ); } );

        grip.addEventListener( 'keydown', function ( e ) {
            if ( e.key !== 'ArrowUp' && e.key !== 'ArrowDown' ) return;
            e.preventDefault();
            setHeight( height + ( e.key === 'ArrowDown' ? 20 : -20 ) );
            prefs.latexHeight = height;
            save();
        } );
        grip.addEventListener( 'pointerdown', function ( e ) {
            if ( e.button !== 0 ) return;
            e.preventDefault();
            var scale = panes.getBoundingClientRect().height / ( panes.offsetHeight || 1 ) || 1;
            var startY = e.clientY, startH = height;
            grip.setPointerCapture( e.pointerId );
            grip.classList.add( 'is-dragging' );
            var move = function ( ev ) { setHeight( startH + ( ev.clientY - startY ) / scale ); };
            var up = function () {
                grip.removeEventListener( 'pointermove', move );
                grip.removeEventListener( 'pointerup', up );
                grip.removeEventListener( 'pointercancel', up );
                grip.classList.remove( 'is-dragging' );
                prefs.latexHeight = height;
                save();
            };
            grip.addEventListener( 'pointermove', move );
            grip.addEventListener( 'pointerup', up );
            grip.addEventListener( 'pointercancel', up );
        } );
    }

    // The predictor: whole equations that start the way this one does - the API's PredictorView - in a
    // panel beside the editing area. The maths view and the markup pane share one row with it, so it sits
    // beside whichever is showing - or, when that row is too narrow to share (a narrow dialog), below it.
    // The bar between them drags to resize the panel (arrow keys too); its button, or Enter, switches the
    // predictor off, as the Predictor switch does (`onOff`). Its width beside and its height below are
    // remembered in this browser. Returns { setOn }, or null for an API without a PredictorView.
    var PREDICTOR_WIDTH = 220, PREDICTOR_MIN = 140, PREDICTOR_HEIGHT = 170, PREDICTOR_MIN_HEIGHT = 90;
    var PREDICTOR_STACK_BELOW = 480, PREDICTOR_KEY = 'cc-eqn-predictor';
    function addPredictor( root, design, textArea, mathView, onOff ) {
        if ( !root || typeof EqEditor === 'undefined' || !EqEditor.PredictorView ) return null;
        var host = root.querySelector( '.CCMathViewHost' ), markup = root.querySelector( '.CCLatexInput' );
        var panes = root.querySelector( '.cc-eqn-panes' );   // stackPanes()'s, where it has run
        var first = panes || host || markup;
        if ( !first || root.querySelector( '.cc-eqn-work' ) ) return null;
        injectPredictorStylesOnce();

        var saved = {};
        try { saved = JSON.parse( localStorage.getItem( PREDICTOR_KEY ) ) || {}; } catch ( e ) {}
        var width = Number( saved.width ) >= PREDICTOR_MIN ? Number( saved.width ) : PREDICTOR_WIDTH;
        var height = Number( saved.height ) >= PREDICTOR_MIN_HEIGHT ? Number( saved.height ) : PREDICTOR_HEIGHT;

        var work = document.createElement( 'div' );
        work.className = 'cc-eqn-work cc-eqn-predictor-off';
        first.parentNode.insertBefore( work, first );
        if ( !panes ) {
            panes = document.createElement( 'div' );
            panes.className = 'cc-eqn-panes';
            if ( markup ) panes.appendChild( markup );
            if ( host ) panes.appendChild( host );
        }

        var bar = document.createElement( 'div' );
        bar.className = 'cc-eqn-split';
        bar.tabIndex = 0;
        bar.setAttribute( 'role', 'separator' );
        bar.setAttribute( 'aria-label', 'Resize the suggested equations' );
        var fold = document.createElement( 'button' );
        fold.type = 'button';
        fold.className = 'cc-eqn-split-fold';
        fold.title = 'Hide suggested equations';
        bar.appendChild( fold );

        var side = document.createElement( 'aside' );
        side.className = 'cc-eqn-predictor';
        side.id = root.id + '-predictor';
        side.setAttribute( 'aria-label', 'Suggested equations' );

        work.appendChild( panes );
        work.appendChild( bar );
        work.appendChild( side );

        function stacked() { return work.classList.contains( 'cc-eqn-stacked' ); }
        function remember() {
            try { localStorage.setItem( PREDICTOR_KEY, JSON.stringify( { width: width, height: height } ) ); } catch ( e ) {}
        }
        function setWidth( w ) {
            // Never so wide that the editing area beside it has nothing left.
            var room = work.clientWidth - bar.offsetWidth - 160;
            width = Math.round( Math.max( PREDICTOR_MIN, room > PREDICTOR_MIN ? Math.min( w, room ) : w ) );
            side.style.width = width + 'px';
        }
        function setHeight( h ) {
            height = Math.round( Math.min( 600, Math.max( PREDICTOR_MIN_HEIGHT, h ) ) );
            side.style.height = height + 'px';
        }
        // Beside the editing area, or below it once the row is too narrow for both: measured rather than
        // decided per host, so a dialog made narrow gets the right one. The button points the way the
        // panel goes to hide.
        function layout() {
            var below = work.clientWidth > 0 && work.clientWidth < PREDICTOR_STACK_BELOW;
            work.classList.toggle( 'cc-eqn-stacked', below );
            side.style.width = below ? '' : width + 'px';
            side.style.height = below ? height + 'px' : '';
            fold.textContent = below ? '▾' : '›';
            bar.setAttribute( 'aria-orientation', below ? 'horizontal' : 'vertical' );
        }
        layout();
        if ( typeof ResizeObserver !== 'undefined' ) new ResizeObserver( function () {
            if ( stacked() !== ( work.clientWidth > 0 && work.clientWidth < PREDICTOR_STACK_BELOW ) ) layout();
        } ).observe( work );

        function off() {
            setOn( false );
            if ( onOff ) onOff();
        }
        fold.addEventListener( 'click', off );
        bar.addEventListener( 'keydown', function ( e ) {
            if ( e.target !== bar ) return;
            if ( e.key === 'Enter' || e.key === ' ' ) {
                e.preventDefault(); off();
            } else if ( !stacked() && ( e.key === 'ArrowLeft' || e.key === 'ArrowRight' ) ) {
                e.preventDefault(); setWidth( width + ( e.key === 'ArrowLeft' ? 20 : -20 ) ); remember();
            } else if ( stacked() && ( e.key === 'ArrowUp' || e.key === 'ArrowDown' ) ) {
                e.preventDefault(); setHeight( height + ( e.key === 'ArrowUp' ? 20 : -20 ) ); remember();
            }
        } );
        // Dragged from anywhere on the bar but its button: left and right beside the editing area, up
        // and down below it. Pointer movement is in screen pixels, which a scaled dialog
        // (design.dialogSize) does not share with the panel's own size - hence the ratio.
        bar.addEventListener( 'pointerdown', function ( e ) {
            if ( e.target === fold || e.button !== 0 ) return;
            e.preventDefault();
            var below = stacked();
            var scale = work.getBoundingClientRect().width / ( work.offsetWidth || 1 ) || 1;
            var start = below ? e.clientY : e.clientX;
            var size = below ? height : width;
            bar.setPointerCapture( e.pointerId );
            work.classList.add( 'cc-eqn-dragging' );
            function move( ev ) {
                if ( below ) setHeight( size + ( start - ev.clientY ) / scale );
                else setWidth( size + ( start - ev.clientX ) / scale );
            }
            function up() {
                bar.removeEventListener( 'pointermove', move );
                bar.removeEventListener( 'pointerup', up );
                bar.removeEventListener( 'pointercancel', up );
                work.classList.remove( 'cc-eqn-dragging' );
                remember();
            }
            bar.addEventListener( 'pointermove', move );
            bar.addEventListener( 'pointerup', up );
            bar.addEventListener( 'pointercancel', up );
        } );

        // Built the first time it is switched on, so nothing is asked of the suggestion service while
        // the predictor is off.
        var view = null;
        function setOn( on ) {
            work.classList.toggle( 'cc-eqn-predictor-off', !on );
            if ( !on ) return;
            layout();
            if ( !view ) {
                var show = design && ( design.predictorShow === 'latex' || design.predictorShow === 'both' ) ? design.predictorShow : 'mathml';
                view = EqEditor.PredictorView.link( side.id, { limit: 6, show: show } ).addTextArea( textArea );
                if ( mathView ) view.addMathView( mathView );
            }
        }
        return { setOn: setOn };
    }

    // !important throughout: hosts reset their dialogs' contents (TinyMCE's .tox, CKEditor's
    // .ck-reset_all) more specifically than a plain class rule reaches.
    function injectPredictorStylesOnce() {
        if ( document.getElementById( 'cc-eqn-predictor-css' ) ) return;
        var style = document.createElement( 'style' );
        style.id = 'cc-eqn-predictor-css';
        style.textContent =
            // The toolbar's size, at the right of the undo/redo bar - on one line with it however narrow.
            '.CCEditorBar:has(.cc-toolbar-size), .CCEditorBar:has(.cc-toolbar-size) .CCHistory { flex-wrap: nowrap !important; }' +
            '.cc-toolbar-size { display: inline-flex !important; align-items: center !important; gap: 4px !important; margin: 0 0 0 auto !important; ' +
                'min-width: 0 !important; flex: 0 1 auto !important; font: 11px/1 sans-serif !important; color: #54647c !important; cursor: pointer !important; }' +
            '.cc-toolbar-size input { width: 72px !important; min-width: 36px !important; flex: 0 1 72px !important; margin: 0 !important; padding: 0 !important; ' +
                'accent-color: var(--cc-accent, #003794) !important; }' +
            '.cc-toolbar-size output { min-width: 3em !important; text-align: right !important; }' +
            // The equation's size, beside Insert as (addSizeSlider()).
            '.cc-eqn-size { display: inline-flex !important; align-items: center !important; gap: 6px !important; margin: 0 !important; padding: 0 !important; ' +
                'font: inherit !important; color: #54647c !important; cursor: pointer !important; white-space: nowrap !important; user-select: none !important; }' +
            '.cc-eqn-size span, .cc-eqn-size output { font: inherit !important; color: inherit !important; }' +
            '.cc-eqn-size input { width: 96px !important; min-width: 48px !important; flex: 0 1 96px !important; height: auto !important; margin: 0 !important; ' +
                'padding: 0 !important; border: 0 !important; background: none !important; accent-color: var(--cc-accent, #003794) !important; cursor: pointer !important; }' +
            '.cc-eqn-size output { min-width: 2.8em !important; text-align: right !important; }' +
            // The bar between the LaTeX markup and the maths view, while both show (stackPanes()).
            '.cc-eqn-panes-split { display: none !important; }' +
            '.cc-eqn-both > .cc-eqn-panes-split { display: block !important; flex: 0 0 auto !important; height: 9px !important; margin: 1px 0 !important; ' +
                'position: relative !important; cursor: row-resize !important; touch-action: none !important; outline: none !important; background: transparent !important; }' +
            '.cc-eqn-both > .cc-eqn-panes-split::before { content: "" !important; position: absolute !important; top: 3px !important; left: 42% !important; right: 42% !important; ' +
                'height: 3px !important; border-radius: 2px !important; background: #cbd5e0 !important; }' +
            '.cc-eqn-both > .cc-eqn-panes-split:hover::before, .cc-eqn-both > .cc-eqn-panes-split:focus-visible::before, .cc-eqn-panes-split.is-dragging::before { ' +
                'left: 0 !important; right: 0 !important; background: var(--cc-accent, #003794) !important; }' +
            '.cc-eqn-work { display: flex !important; flex: 1 1 auto !important; min-height: 0 !important; min-width: 0 !important; align-items: stretch !important; }' +
            '.cc-eqn-panes { display: flex !important; flex-direction: column !important; flex: 1 1 auto !important; min-width: 0 !important; min-height: 0 !important; }' +
            '.cc-eqn-predictor-off .cc-eqn-split, .cc-eqn-predictor-off .cc-eqn-predictor { display: none !important; }' +
            '.cc-eqn-split { flex: 0 0 auto !important; width: 9px !important; margin: 0 2px !important; cursor: col-resize !important; ' +
                'display: flex !important; align-items: center !important; justify-content: center !important; position: relative !important; ' +
                'background: transparent !important; touch-action: none !important; user-select: none !important; outline: none !important; }' +
            '.cc-eqn-split::before { content: "" !important; position: absolute !important; top: 0 !important; bottom: 0 !important; left: 4px !important; ' +
                'width: 1px !important; background: #d5dbe3 !important; }' +
            '.cc-eqn-split:hover::before, .cc-eqn-split:focus-visible::before, .cc-eqn-dragging .cc-eqn-split::before { left: 3px !important; width: 3px !important; background: var(--cc-accent, #003794) !important; }' +
            '.cc-eqn-split-fold { flex: 0 0 auto !important; position: relative !important; z-index: 1 !important; width: 16px !important; height: 34px !important; margin: 0 !important; padding: 0 !important; ' +
                'border: 1px solid #cbd5e0 !important; border-radius: 8px !important; background: #fff !important; color: #52606d !important; ' +
                'font: 14px/1 sans-serif !important; cursor: pointer !important; box-shadow: none !important; display: flex !important; align-items: center !important; justify-content: center !important; }' +
            '.cc-eqn-split-fold:hover { color: var(--cc-accent, #003794) !important; border-color: var(--cc-accent, #003794) !important; }' +
            // contain: size - the list's length is no reason for the dialog to grow; the panel takes the
            // editing area's height (stretched, as a flex item) and scrolls within it. layout, as the API
            // has it, keeps its search box anchored to the panel.
            '.cc-eqn-predictor { flex: 0 0 auto !important; min-width: 0 !important; min-height: 0 !important; overflow: auto !important; box-sizing: border-box !important; contain: size layout !important; }' +
            '.cc-eqn-dragging, .cc-eqn-dragging * { cursor: col-resize !important; user-select: none !important; }' +
            // Below the editing area (cc-eqn-stacked): the same parts turned through a right angle.
            '.cc-eqn-stacked { flex-direction: column !important; }' +
            '.cc-eqn-stacked .cc-eqn-split { width: auto !important; height: 9px !important; margin: 2px 0 !important; cursor: row-resize !important; }' +
            '.cc-eqn-stacked .cc-eqn-split::before { top: 4px !important; bottom: auto !important; left: 0 !important; right: 0 !important; width: auto !important; height: 1px !important; }' +
            '.cc-eqn-stacked .cc-eqn-split:hover::before, .cc-eqn-stacked .cc-eqn-split:focus-visible::before, .cc-eqn-stacked.cc-eqn-dragging .cc-eqn-split::before { top: 3px !important; left: 0 !important; width: auto !important; height: 3px !important; }' +
            '.cc-eqn-stacked .cc-eqn-split-fold { width: 34px !important; height: 16px !important; }' +
            '.cc-eqn-stacked .cc-eqn-predictor { width: auto !important; }' +
            '.cc-eqn-stacked.cc-eqn-dragging, .cc-eqn-stacked.cc-eqn-dragging * { cursor: row-resize !important; }' +
            // The suggestions' maths set as the maths view's is: a host's reset (TinyMCE's .tox
            // :not(svg) { font-family: inherit; font-style: inherit }) outranks the API's .fxtex rules,
            // which left it in the dialog's sans-serif with its letters upright (the browser italicises
            // them through text-transform, which the reset takes too). Reverted to the browser's own
            // maths styling, as the maths view is, then the API's .fxtex rules re-asserted for the panel.
            '.cc-eqn-predictor math, .cc-eqn-predictor math * { font: revert-layer !important; text-transform: revert-layer !important; ' +
                'width: revert-layer !important; height: revert-layer !important; padding: revert-layer !important; margin: revert-layer !important; ' +
                'text-align: revert-layer !important; box-sizing: revert-layer !important; white-space: revert-layer !important; }';
        for ( var i = 0; i < document.styleSheets.length; i++ ) {
            var rules;
            try { rules = document.styleSheets[ i ].cssRules; } catch ( e ) { continue; }
            for ( var j = 0; j < rules.length; j++ ) {
                var r = rules[ j ], decls = '';
                var sel = r.selectorText && r.selectorText.replace( /:where\(\.fxEditor\)\s*/g, '' ).trim();
                if ( !sel || !/^\.fxtex\b/.test( sel ) || sel.indexOf( ',' ) > -1 ) continue;
                for ( var k = 0; k < r.style.length; k++ ) {
                    decls += r.style[ k ] + ':' + r.style.getPropertyValue( r.style[ k ] ) + ' !important;';
                }
                if ( decls ) style.textContent += '.cc-eqn-predictor ' + sel + '{' + decls + '}';
            }
        }
        document.head.appendChild( style );
    }

    function focusEditor( root ) {
        if ( !root ) return;
        var pane = root.querySelector( root.getAttribute( 'data-latex' ) === 'on' ? '.CCLatexInput' : '.CCMathView' );
        if ( pane ) pane.focus( { preventScroll: true } );
        var view = root.querySelector( '.CCMathView' ), host = view && view.parentElement;
        if ( host && !host.ccCaretWatch && typeof ResizeObserver !== 'undefined' ) {
            host.ccCaretWatch = new ResizeObserver( function () {
                var mv = host.querySelector( '.CCMathView' );
                if ( mv && document.activeElement === mv ) mv.dispatchEvent( new FocusEvent( 'focus' ) );
            } );
            host.ccCaretWatch.observe( host );
        }
    }

    function apiMathRules() {
        var out = '';
        for ( var i = 0; i < document.styleSheets.length; i++ ) {
            var rules;
            try { rules = document.styleSheets[ i ].cssRules; } catch ( e ) { continue; }
            for ( var j = 0; j < rules.length; j++ ) {
                var r = rules[ j ], decls = '';
                if ( !r.selectorText || !/(^|,)\s*(:where\(\.fxEditor\)\s*)?\.(fxtex|CCMathView)\b/.test( r.selectorText ) ) continue;
                for ( var k = 0; k < r.style.length; k++ ) {
                    decls += r.style[ k ] + ':' + r.style.getPropertyValue( r.style[ k ] ) + ' !important;';
                }
                if ( decls ) {
                    out += r.selectorText.replace( /:where\(\.fxEditor\)\s*/g, '' ).split( ',' ).map( function ( s ) {
                        s = s.trim();
                        return /^\.CCMathView\b/.test( s ) ? s : '.CCMathView ' + s;
                    } ).join( ',' ) + '{' + decls + '}';
                }
            }
        }
        return out;
    }

    var instanceCount = 0;

    // The dialog Froala does not provide one of its own for - see the module doc at the top
    // of this file. Built once per plugin instance (one per editor on the page) and reused
    // across opens, rather than rebuilt each time: unlike TinyMCE and CKEditor 5, nothing here
    // tears the dialog's DOM down on close, so there is state worth keeping between opens.
    function createOverlay( ids, design ) {
        var overlay = document.createElement( 'div' );
        overlay.className = 'cc-eqneditor-overlay';
        overlay.id = ids.overlay;
        overlay.innerHTML =
            '<div class="cc-eqneditor-modal" role="dialog" aria-modal="true" aria-label="Equation Editor">' +
                '<div class="cc-eqneditor-modal-header">' +
                    '<a href="https://editor.codecogs.com" target="_blank" rel="noopener" ' +
                       'class="cc-eqneditor-modal-logo" title="CodeCogs Equation Editor">' + LOGO_SVG + '</a>' +
                    '<span>Equation Editor</span>' +
                    '<button type="button" class="cc-eqneditor-modal-close" aria-label="Cancel">&times;</button>' +
                '</div>' +
                '<div class="cc-eqneditor-modal-body">' +
                    '<div id="' + ids.root + '" class="CCEqnEditor" data-latex="off" data-inline="off">' +
                        '<div class="CCEditorBar"><div id="' + ids.history + '" class="CCHistory"></div></div>' +
                        '<div id="' + ids.toolbar + '"></div>' +
                        '<div id="' + ids.mathview + '" class="CCMathViewHost"></div>' +
                        // Hidden until the LaTeX toggle is on.
                        '<div id="' + ids.latexInput + '" class="CCLatexInput" autocorrect="off" ' +
                             'placeholder="Write LaTeX here..."></div>' +
                        // No rendered-equation preview in the dialog any more - MathView is
                        // the whole editing surface. eqOutput still needs a DOM element to
                        // bind to (it builds the SVG URL for the "Image (SVG)" insert mode),
                        // so the element stays, just not visible.
                        '<img id="' + ids.output + '" class="CCEqnOutput-hidden" alt="">' +
                    '</div>' +
                '</div>' +
                '<div class="cc-eqneditor-modal-footer cc-eqn-bar">' +
                    '<label class="cc-switch" title="Left-align the equation instead of centring it">' +
                        '<input type="checkbox" data-inline-toggle>' +
                        '<span class="cc-switch-track"><span class="cc-switch-knob"></span></span>' +
                        '<span class="cc-switch-label">Inline</span>' +
                    '</label>' +
                    '<label class="cc-switch" title="Show or hide the LaTeX markup">' +
                        '<input type="checkbox" data-latex-toggle>' +
                        '<span class="cc-switch-track"><span class="cc-switch-knob"></span></span>' +
                        '<span class="cc-switch-label">LaTeX</span>' +
                    '</label>' +
                    '<div class="cc-eqn-bar-right cc-eqneditor-modal-actions">' +
                        '<select class="cc-eqn-select" data-insert-mode title="How to insert the equation">' +
                            '<option value="mathml" selected>Insert MathML</option>' +
                            '<option value="svg">Insert SVG</option>' +
                            '<option value="latex">Insert LaTeX</option>' +
                        '</select>' +
                        '<button type="button" class="cc-eqn-btn cc-eqneditor-modal-cancel">Cancel</button>' +
                        '<button type="button" class="cc-eqn-btn cc-eqn-primary cc-eqneditor-modal-ok">OK</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        document.body.appendChild( overlay );
        return overlay;
    }

    FroalaEditor.PLUGINS.eqneditor = function ( editor ) {
        var n = ++instanceCount;
        var ids = {
            overlay: 'cc-eqn-fr-overlay-' + n,
            root: 'cc-eqn-fr-' + n,
            history: 'cc-eqn-fr-history-' + n,
            toolbar: 'cc-eqn-fr-toolbar-' + n,
            mathview: 'cc-eqn-fr-mathview-' + n,
            latexInput: 'cc-eqn-fr-latex-' + n,
            output: 'cc-eqn-fr-output-' + n
        };

        var opts = editor.opts || {};
        var host = opts.eqneditorServer || DEFAULT_EDITOR_HOST;
        // A bare host means https; a full origin (e.g. http://localhost:8010 for local development) is used as it is.
        var origin = /^https?:\/\//.test( host ) ? host.replace( /\/+$/, '' ) : 'https://' + host;
        var renderUrl = opts.eqneditorRenderUrl || DEFAULT_RENDER_URL;
        var licence = opts.eqneditorLicence || '';
        var design = opts.eqneditorDesign || {};
        var scriptUrl = opts.eqneditorScriptUrl || ( origin + '/fxeditor.api.min.js' );
        var cssUrl = opts.eqneditorCssUrl || ( origin + '/fxeditor.css' );
        var mathmlCssUrl = opts.eqneditorMathmlCssUrl || ( origin + '/fxtex.css' );

        var apiReady = loadScriptOnce( scriptUrl );

        // LaTeX in the text - $...$ and $$...$$, as fxTeX reads them on the page that shows the
        // content - shown as the maths it is while it is edited (design.latexAsMaths, on unless set
        // false). What is saved is the LaTeX, exactly as it was.
        //
        // As content is set or inserted, each equation in the text becomes a locked span holding its
        // text (<span class="cc-tex" contenteditable="false"><span class="cc-tex-src">$x$</span></span>,
        // fr-deletable so Backspace takes it whole), and its maths is drawn in beside the text, which
        // is then hidden. As Froala reads the content out (html.get), each span is its text again.
        var texAsMaths = design.latexAsMaths !== false;
        function wrapTex() {
            if ( !texAsMaths ) return;
            var doc = editor.el.ownerDocument;
            var walker = doc.createTreeWalker( editor.el, NodeFilter.SHOW_TEXT, {
                acceptNode: function ( node ) {
                    if ( node.nodeValue.indexOf( '$' ) === -1 ) return NodeFilter.FILTER_REJECT;
                    for ( var p = node.parentNode; p && p !== editor.el; p = p.parentNode ) {
                        if ( TEX_SKIP[ p.nodeName.toUpperCase() ] || ( p.classList && p.classList.contains( 'cc-tex' ) ) ) return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            } );
            var found = [];
            while ( walker.nextNode() ) found.push( walker.currentNode );
            found.forEach( function ( node ) {
                var pieces = texPieces( node.nodeValue );
                if ( !pieces.some( function ( piece ) { return piece.tex; } ) ) return;
                pieces.forEach( function ( piece ) {
                    if ( !piece.tex ) {
                        node.parentNode.insertBefore( doc.createTextNode( piece.text ), node );
                        return;
                    }
                    var span = doc.createElement( 'span' );
                    span.className = 'cc-tex fr-deletable' + ( piece.tex.display ? ' cc-tex-display' : '' );
                    span.setAttribute( 'contenteditable', 'false' );
                    var source = doc.createElement( 'span' );
                    source.className = 'cc-tex-src';
                    source.textContent = piece.text;
                    span.appendChild( source );
                    node.parentNode.insertBefore( span, node );
                } );
                node.parentNode.removeChild( node );
            } );
            drawTex();
        }
        function drawTex() {
            var spans = Array.prototype.filter.call( editor.el.querySelectorAll( 'span.cc-tex' ), function ( span ) {
                return !span.querySelector( '.cc-tex-math' );
            } );
            if ( !spans.length ) return;
            injectTexStylesOnce();
            apiReady.then( function () { return ensureInit( licence ); } ).then( function () {
                spans.forEach( function ( span ) {
                    if ( !editor.el.contains( span ) || span.querySelector( '.cc-tex-math' ) ) return;
                    var src = span.querySelector( '.cc-tex-src' );
                    var tex = texOfSource( src ? src.textContent : '' );
                    var mathml = '';
                    try { mathml = tex ? EqEditor.Output.latexToMathML( tex.latex, false, !tex.display ) : ''; } catch ( e ) { mathml = ''; }
                    // Without fxTeX Pro (no licence), its error: the LaTeX stays as it is.
                    if ( !mathml || mathml.indexOf( '<merror' ) !== -1 ) return;
                    var math = span.ownerDocument.createElement( 'span' );
                    math.className = 'cc-tex-math';
                    math.innerHTML = mathml;
                    span.insertBefore( math, span.firstChild );
                } );
            } );
        }
        // Each span its text again, in what Froala reads out - so in what is saved, and in undo.
        function unwrapTex( html ) {
            if ( typeof html !== 'string' || html.indexOf( 'cc-tex' ) === -1 ) return html;
            var box = document.createElement( 'template' );
            box.innerHTML = html;
            Array.prototype.forEach.call( box.content.querySelectorAll( 'span.cc-tex' ), function ( span ) {
                var src = span.querySelector( '.cc-tex-src' );
                span.parentNode.replaceChild( document.createTextNode( src ? src.textContent : '' ), span );
            } );
            return box.innerHTML;
        }
        loadCssOnce( cssUrl );
        loadFxtexStyleOnce( mathmlCssUrl, ( opts.iframe && editor.iframe_document ) || document );

        var overlay = null;
        var eqOutput = null, eqTextArea = null, eqMathView = null, eqToolbar = null;
        var mounted = false;

        function applyLatexVisible( visible ) {
            var root = document.getElementById( ids.root );
            if ( root ) root.setAttribute( 'data-latex', visible ? 'on' : 'off' );

            // Hiding the markup has to move the toolbar's target back to the maths view, and
            // vice versa, otherwise a button pressed straight afterwards inserts into a hidden
            // pane.
            if ( eqToolbar ) eqToolbar.setActiveTextArea( visible ? eqTextArea : ( eqMathView || eqTextArea ) );
        }

        function applyInline( inline ) {
            var root = document.getElementById( ids.root );
            if ( root ) root.setAttribute( 'data-inline', inline ? 'on' : 'off' );
            if ( eqMathView ) eqMathView.setInline( inline );
            if ( eqOutput ) eqOutput.setInline( inline );
        }

        function mount() {
            if ( mounted ) return;
            mounted = true;

            eqOutput = new EqEditor.Output( ids.output );
            eqOutput.setRenderURL( renderUrl );

            eqTextArea = EqEditor.TextArea.link( ids.latexInput )
                .addOutput( eqOutput )
                .addHistoryMenu( new EqEditor.History( ids.history ) );

            eqToolbar = EqEditor.Toolbar.link( ids.toolbar, design.toolbar || 'default', design.toolbarScale || 1 ).addTextArea( eqTextArea );

            var latexToggle = document.querySelector( '#' + ids.overlay + ' input[data-latex-toggle]' );

            if ( typeof EqEditor.MathView !== 'undefined' ) {
                eqMathView = EqEditor.MathView.link( ids.mathview ).addTextArea( eqTextArea );
                eqToolbar.addMathView( eqMathView );
            } else {
                // Without a maths view the markup is the only thing to edit in - force it
                // visible and lock the toggle so it cannot be switched to an empty pane.
                applyLatexVisible( true );
                latexToggle.checked = true;
                latexToggle.disabled = true;
            }

            latexToggle.addEventListener( 'change', function ( e ) { applyLatexVisible( e.target.checked ); } );

            document.querySelector( '#' + ids.overlay + ' input[data-inline-toggle]' )
                .addEventListener( 'change', function ( e ) { applyInline( e.target.checked ); } );

            addEditorControls( document.getElementById( ids.root ), design, { textArea: eqTextArea, mathView: eqMathView, output: eqOutput,
                latexToggle: latexToggle, inlineToggle: document.querySelector( '#' + ids.overlay + ' input[data-inline-toggle]' ),
                insertSelect: document.querySelector( '#' + ids.overlay + ' [data-insert-mode]' ) } );
            applyDesign( document.getElementById( ids.root ), design, latexToggle,
                document.querySelector( '#' + ids.overlay + ' [data-insert-mode]' ) );
        }

        // referrerpolicy="origin" rather than leaving it to the page's own Referrer-Policy:
        // the rendering service identifies the calling site by referer, and a page with a
        // stricter policy (or none at all, on some browsers' defaults) would otherwise send
        // none at all.
        function buildInsert( latex, mode ) {
            if ( mode === 'latex' ) {
                return escapeHtml( texOf( latex, document.querySelector( '#' + ids.overlay + ' input[data-inline-toggle]' ).checked ) );
            }
            if ( mode === 'svg' ) {
                return '<img class="fxtex" src="' + escapeHtml( outputCode( eqOutput, 'url' ) ) + '" ' +
                    'alt="' + escapeHtml( latex ) + '" referrerpolicy="origin"' + sizeImage( eqOutput, function ( mark, size ) {
                        var img = editor.el && editor.el.querySelector( 'img[data-cc-size="' + mark + '"]' );
                        if ( !img ) return;
                        if ( size ) { img.style.width = size.width; img.style.height = size.height; }
                        img.removeAttribute( 'data-cc-size' );
                    } ) + '>';
            }
            return outputCode( eqOutput, 'mathml' );
        }

        function close() {
            overlay.classList.remove( 'cc-eqneditor-open' );
            if ( eqTextArea ) eqTextArea.close();
            restoreCaret();
        }

        // Where the caret was as the dialog opened. The dialog takes the focus, and the caret with it,
        // so html.insert() put each new equation in a paragraph of its own at the end of the content.
        // Kept with Froala's own markers, which restoreCaret() puts the caret back to and removes.
        var caretSaved = false;
        function saveCaret() {
            if ( editor.selection.inEditor() ) {
                editor.selection.save();
                caretSaved = true;
            }
        }
        function restoreCaret() {
            if ( caretSaved ) {
                caretSaved = false;
                editor.selection.restore();
            }
        }

        // The whole equation an element on the page belongs to: for MathML, the wrapper the
        // converter puts round the <math> (it carries the spoken text), else the <math> itself.
        function equationOf( el ) {
            if ( !el || el.nodeName.toLowerCase() !== 'math' ) return el;
            var wrapper = el.parentNode;
            return wrapper && wrapper.nodeName.toLowerCase() === 'span' && wrapper.classList.contains( 'cc-math' ) ? wrapper : el;
        }

        // Puts the equation in at the caret, or in place of `el`, the equation being edited - all of it.
        // Left to html.insert(), an edited equation went in wherever the caret was and the old one
        // stayed, so the page had both.
        function insertEquation( html, el ) {
            // A LaTeX equation in the text (from texAt()): the $...$ or $$...$$, delimiters and all.
            var range = el && el.tex ? texRange( el, editor.el ) : null;
            if ( range ) {
                var holder = range.startContainer.ownerDocument.createElement( 'div' );
                holder.innerHTML = html;
                var parts = range.startContainer.ownerDocument.createDocumentFragment();
                while ( holder.firstChild ) parts.appendChild( holder.firstChild );
                range.deleteContents();
                range.insertNode( parts );
                lockEquations();
                wrapTex();
                editor.events.trigger( 'contentChanged' );
                return;
            }
            var target = el && el.tex ? null : equationOf( el );
            if ( !target || !editor.el.contains( target ) ) {
                restoreCaret();
                editor.html.insert( html );
                return;
            }
            var box = target.ownerDocument.createElement( 'div' );
            box.innerHTML = html;
            while ( box.firstChild ) target.parentNode.insertBefore( box.firstChild, target );
            target.parentNode.removeChild( target );
            lockEquations();
            wrapTex();
            editor.events.trigger( 'contentChanged' );
        }

        // Each MathML equation is one object while it is in the editor. The browser cannot edit
        // inside a <math> sensibly: Backspace after one ate into it a character at a time, leaving
        // a broken equation, and it could never be deleted whole. Marked contenteditable="false",
        // with Froala's fr-deletable (how its own emoticons are kept whole but deletable), it
        // goes in one keystroke. The marks are taken off while Froala reads the content out, so
        // saved content never carries them.
        function equationsIn() {
            var maths = editor.el.querySelectorAll( 'math' ), list = [];
            for ( var i = 0; i < maths.length; i++ ) list.push( equationOf( maths[ i ] ) );
            return list;
        }
        function lockEquations() {
            equationsIn().forEach( function ( el ) {
                el.setAttribute( 'contenteditable', 'false' );
                el.classList.add( 'fr-deletable' );
            } );
        }
        function unlockEquations() {
            equationsIn().forEach( function ( el ) {
                el.removeAttribute( 'contenteditable' );
                el.classList.remove( 'fr-deletable' );
                if ( !el.getAttribute( 'class' ) ) el.removeAttribute( 'class' );
            } );
        }

        // `el`, when editing: the equation on the page, whose size the dialog starts from and which
        // OK replaces (for LaTeX, where it is in the text, from texAt()). `format` ('svg', 'mathml' or
        // 'latex'): what it was inserted as, which the dialog starts with, so an edited equation goes
        // back in the form it came out of. `inline`: whether it is an inline equation ($...$, for LaTeX),
        // which the Inline switch starts at.
        function showDialog( latex, el, format, inline ) {
            latex = latex || '';
            var startSize = 1;

            if ( !el ) saveCaret();
            if ( !overlay ) overlay = createOverlay( ids, design );
            overlay.classList.add( 'cc-eqneditor-open' );

            var okBtn = overlay.querySelector( '.cc-eqneditor-modal-ok' );
            var cancelBtn = overlay.querySelector( '.cc-eqneditor-modal-cancel' );
            var closeBtn = overlay.querySelector( '.cc-eqneditor-modal-close' );
            var modeSelect = overlay.querySelector( '[data-insert-mode]' );

            function onOk() {
                var current = eqTextArea ? eqTextArea.getTextArea().textContent.trim() : '';
                if ( current ) {
                    editor.undo.saveStep();
                    // The Size slider's, where it applies (see addSizeSlider()); else the size it had.
                    var sizer = sizeSliderIn( overlay );
                    var scale = sizer && sizer.scale() || startSize;
                    if ( eqOutput.setScale || eqOutput.setEquationSize ) ( eqOutput.setScale || eqOutput.setEquationSize ).call( eqOutput, scale );
                    insertEquation( buildInsert( current, modeSelect.value ), el );
                    editor.undo.saveStep();
                    eqTextArea.pushToHistory();
                }
                close();
            }

            // Rebound on every open rather than left as permanent listeners: the overlay is
            // shared by one plugin instance, and re-adding the same three handlers each time
            // is cheaper than tracking whether they are already attached.
            okBtn.onclick = onOk;
            cancelBtn.onclick = close;
            closeBtn.onclick = close;

            apiReady.then( function () { return ensureInit( licence ); } ).then( function () {
                injectStyleOverridesOnce( cssUrl.slice( 0, cssUrl.lastIndexOf( '/' ) + 1 ) + 'prototypes/latinmodern-math.otf' );
                mount();
                startInsertAs( modeSelect, format, design );
                startInline( overlay.querySelector( 'input[data-inline-toggle]' ), inline, applyInline );
                startSize = sizeOf( el && el.nodeType ? el : null );
                var sizer = sizeSliderIn( overlay );
                if ( sizer ) sizer.start( el && el.nodeType ? imageScaleOf( el ) || startSize : 0 );
                eqTextArea.clear();
                if ( latex ) eqTextArea.insert( latex, latex.length );
                eqTextArea.notifyOutputs();
                focusEditor( document.getElementById( ids.root ) );
            } ).catch( function ( err ) {
                console.error( err );
                close();
            } );
        }

        function _init() {
            // See the comment on MATHML_ELEMENTS above: neither <math>'s elements nor
            // referrerpolicy are on Froala's default allowlists, so both insert modes need
            // them added here, or the html.insert() calls in showDialog() silently strip the
            // markup/attribute rather than erroring.
            var allowedTags = editor.opts.htmlAllowedTags || [];
            MATHML_ELEMENTS.concat( SVG_ELEMENTS ).forEach( function ( name ) {
                if ( allowedTags.indexOf( name ) === -1 ) allowedTags.push( name );
            } );
            editor.opts.htmlAllowedTags = allowedTags;

            var allowedAttrs = editor.opts.htmlAllowedAttrs || [];
            // role and the aria- attributes carry an equation's spoken text (on the wrapper round its
            // MathML) - without them, saved equations lost it each time the content was loaded.
            [ 'referrerpolicy', 'display', 'xmlns', 'role', 'aria-label', 'aria-hidden', 'lang' ].concat( MATHML_ATTRIBUTES, SVG_ATTRIBUTES ).forEach( function ( name ) {
                if ( allowedAttrs.indexOf( name ) === -1 ) allowedAttrs.push( name );
            } );
            editor.opts.htmlAllowedAttrs = allowedAttrs;

            // MathML and SVG elements that are empty by nature: Froala removed them (a matrix lost
            // the strut that spaces its rows) unless they are on this list.
            var emptyTags = editor.opts.htmlAllowedEmptyTags || [];
            [ 'mspace', 'mglyph', 'none', 'mprescripts', 'path', 'line', 'polyline', 'polygon', 'rect', 'circle',
                'ellipse', 'use' ].forEach( function ( name ) {
                if ( emptyTags.indexOf( name ) === -1 ) emptyTags.push( name );
            } );
            editor.opts.htmlAllowedEmptyTags = emptyTags;

            // Equations whole while in the editor (see lockEquations()), but not in what is saved.
            lockEquations();
            editor.events.on( 'html.set', lockEquations );
            editor.events.on( 'html.inserted', lockEquations );
            editor.events.on( 'html.beforeGet', unlockEquations );
            editor.events.on( 'html.afterGet', lockEquations );

            // LaTeX shown as maths (see wrapTex()), saved as the LaTeX.
            wrapTex();
            editor.events.on( 'html.set', wrapTex );
            editor.events.on( 'html.inserted', wrapTex );
            editor.events.on( 'html.get', unwrapTex );
            // Undo and redo put back a snapshot of the content without its usual events.
            editor.events.on( 'commands.undo', wrapTex );
            editor.events.on( 'commands.redo', wrapTex );

            // Click an existing equation to edit it again - reads the LaTeX back the same two
            // ways as the TinyMCE and CKEditor 5 plugins, but on a single click, not a double
            // one, unlike them. Froala shows its own resize/align popup directly over an image
            // on the *first* click of any click on it, so a genuine double-click is not
            // reachable here: the second click always lands on that popup, not the image
            // underneath it, whatever this plugin does with mousedown or click handlers of its
            // own. A single click is the only interaction actually available, so this hides
            // Froala's own popup immediately and opens the equation dialog in its place -
            // scoped to images matching CodeCogs' own rendering URL, so an ordinary uploaded
            // image a user clicks still gets Froala's normal resize/align popup untouched.
            editor.events.on( 'mousedown', function ( e ) {
                var target = e.target;
                if ( !target ) return;
                // LaTeX shown as maths opens on a double-click (below), as its text does.
                if ( target.closest && target.closest( '.cc-tex' ) ) return;

                if ( target.nodeName.toLowerCase() === 'img' ) {
                    var match = target.src.match( /(gif|svg|png)\.image\?(.*)/ );
                    if ( match ) {
                        // The press's own default would move focus to where it landed - under the
                        // dialog by then - taking it from the equation editor (see focusEditor()).
                        e.preventDefault();
                        editor.popups.hideAll();
                        var eq = splitInline( decodeEquation( match[ 2 ] ) );
                        showDialog( eq.latex, target, 'svg', eq.inline );
                    }
                    return;
                }

                var math = target.closest && target.closest( 'math[title]' );
                if ( math ) {
                    var eqLatex = math.getAttribute( 'title' ).trim();
                    if ( eqLatex ) {
                        e.preventDefault();
                        showDialog( eqLatex, math, 'mathml', math.getAttribute( 'display' ) !== 'block' );
                    }
                }
            } );

            // LaTeX in the text, as "Insert as LaTeX" puts it, on a double-click (a single click has
            // to stay free for putting the caret in it): the double-click has selected a word of it,
            // and the $...$ or $$...$$ round that is the equation.
            editor.events.$on( editor.$el, 'dblclick', function ( e ) {
                // LaTeX shown as maths: its own text says what it is.
                var texSpan = e.target && e.target.closest && e.target.closest( 'span.cc-tex' );
                if ( texSpan ) {
                    var texSrc = texSpan.querySelector( '.cc-tex-src' );
                    var texFound = texOfSource( texSrc ? texSrc.textContent : '' );
                    if ( texFound ) {
                        e.preventDefault();
                        showDialog( texFound.latex, texSpan, 'latex', !texFound.display );
                    }
                    return;
                }
                if ( e.target && e.target.closest && e.target.closest( 'math, img' ) ) return;
                var selection = editor.el.ownerDocument.getSelection();
                var range = selection && selection.rangeCount ? selection.getRangeAt( 0 ) : null;
                var tex = range && texAt( range.startContainer, range.startOffset );
                if ( tex ) {
                    e.preventDefault();
                    // The word the double-click selected is in this page, as the dialog is: left
                    // selected, the dialog's own editing area put the equation into it, not itself.
                    selection.removeAllRanges();
                    showDialog( tex.latex, tex, 'latex', !tex.display );
                }
            } );
        }

        return {
            _init: _init,
            showInsertPopup: function () { showDialog(); }
        };
    };

    FroalaEditor.RegisterCommand( 'eqneditor', {
        title: 'Insert Equation',
        icon: 'eqneditor',
        undo: true,
        focus: true,
        callback: function () {
            this.eqneditor.showInsertPopup();
        }
    } );
}() );
