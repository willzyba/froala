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
 *       eqneditorServer: 'fxtex.codecogs.com',  // where the editor's own code is served from
 *       eqneditorRenderUrl: 'https://latex.codecogs.com'   // where equations are rendered
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

    var DEFAULT_EDITOR_HOST = 'fxtex.codecogs.com';
    var DEFAULT_RENDER_URL = 'https://latex.codecogs.com';

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
    // lifetime, even once eqneditor.api.min.js itself has loaded. Called once per page; an
    // empty licence is the normal, expected state until a real one is configured.
    var initPromise = null;

    function ensureInit( licence ) {
        if ( initPromise ) return initPromise;
        initPromise = ( typeof EqEditor.init === 'function' )
            ? EqEditor.init( { licence: licence || '' } ).catch( function ( err ) {
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

    function decodeEquation( encoded ) {
        var latex = encoded;
        try {
            latex = decodeURIComponent( encoded );
        } catch ( e ) {
            // Not valid percent-encoding; still worth showing as it stands.
        }
        return latex.replace( /&space;/g, ' ' ).replace( /&plus;/g, '+' ).replace( /&hash;/g, '#' );
    }

    function escapeHtml( s ) {
        return String( s )
            .replace( /&/g, '&amp;' ).replace( /</g, '&lt;' )
            .replace( />/g, '&gt;' ).replace( /"/g, '&quot;' );
    }

    // Gaps in the shared eqneditor.css (loaded separately, asynchronously, from the host
    // configured above) this dialog needs but can't assume it will get: editor.codecogs.com,
    // the old default host and still configurable, serves an older stylesheet that predates the CCEqnEditor/
    // CCMathViewHost/CCLatexInput class names entirely (only a local dev mirror does not have
    // this gap), so the maths/LaTeX mutual-exclusion is written defensively here rather than
    // left to eqneditor.css. !important throughout, injected once rather than relying on load
    // order against eqneditor.css: which stylesheet's rule wins would otherwise depend on which
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
            '.cc-eqn-bar { display: flex !important; align-items: center !important; gap: 16px !important; flex: 0 0 auto !important; ' +
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
            } else {
                box.style.zoom = String( size );
                box.style.setProperty( 'max-width', 'calc(96vw / ' + size + ')', 'important' );   // still no wider than the window
            }
        }
        if ( insertSelect && design.insertAs && insertSelect.querySelector( 'option[value="' + design.insertAs + '"]' ) ) {
            insertSelect.value = design.insertAs;
        }
        if ( latexToggle && design.latex && !latexToggle.checked && !latexToggle.disabled ) {
            latexToggle.checked = true;
            latexToggle.dispatchEvent( new Event( 'change', { bubbles: true } ) );
        }
    }

    function apiMathRules() {
        var out = '';
        for ( var i = 0; i < document.styleSheets.length; i++ ) {
            var rules;
            try { rules = document.styleSheets[ i ].cssRules; } catch ( e ) { continue; }
            for ( var j = 0; j < rules.length; j++ ) {
                var r = rules[ j ], decls = '';
                if ( !r.selectorText || !/(^|,)\s*\.(fxtex|CCMathView)\b/.test( r.selectorText ) ) continue;
                for ( var k = 0; k < r.style.length; k++ ) {
                    decls += r.style[ k ] + ':' + r.style.getPropertyValue( r.style[ k ] ) + ' !important;';
                }
                if ( decls ) {
                    out += r.selectorText.split( ',' ).map( function ( s ) {
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
    function createOverlay( ids ) {
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
                        '<span class="cc-switch-label">LaTeX markup</span>' +
                    '</label>' +
                    '<div class="cc-eqn-bar-right cc-eqneditor-modal-actions">' +
                        '<select class="cc-eqn-select" data-insert-mode title="How to insert the equation">' +
                            '<option value="mathml" selected>Insert as MathML</option>' +
                            '<option value="svg">Insert as image (SVG)</option>' +
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
        var scriptUrl = opts.eqneditorScriptUrl || ( origin + '/eqneditor.api.min.js' );
        var cssUrl = opts.eqneditorCssUrl || ( origin + '/eqneditor.css' );
        var mathmlCssUrl = opts.eqneditorMathmlCssUrl || ( origin + '/fxtex.css' );

        var apiReady = loadScriptOnce( scriptUrl );
        loadCssOnce( cssUrl );
        loadCssOnce( mathmlCssUrl );

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

            applyDesign( document.getElementById( ids.root ), design, latexToggle,
                document.querySelector( '#' + ids.overlay + ' [data-insert-mode]' ) );
        }

        // referrerpolicy="origin" rather than leaving it to the page's own Referrer-Policy:
        // latex.codecogs.com identifies the calling site by referer, and a page with a
        // stricter policy (or none at all, on some browsers' defaults) would otherwise send
        // none at all.
        function buildInsert( latex, mode ) {
            if ( mode === 'svg' ) {
                return '<img src="' + escapeHtml( eqOutput.exportAs( 'url' ) ) + '" ' +
                    'alt="' + escapeHtml( latex ) + '" referrerpolicy="origin">';
            }
            return eqOutput.exportAs( 'mathml' );
        }

        function close() {
            overlay.classList.remove( 'cc-eqneditor-open' );
            if ( eqTextArea ) eqTextArea.close();
        }

        function showDialog( latex ) {
            latex = latex || '';

            if ( !overlay ) overlay = createOverlay( ids );
            overlay.classList.add( 'cc-eqneditor-open' );

            var okBtn = overlay.querySelector( '.cc-eqneditor-modal-ok' );
            var cancelBtn = overlay.querySelector( '.cc-eqneditor-modal-cancel' );
            var closeBtn = overlay.querySelector( '.cc-eqneditor-modal-close' );
            var modeSelect = overlay.querySelector( '[data-insert-mode]' );

            function onOk() {
                var current = eqTextArea ? eqTextArea.getTextArea().textContent.trim() : '';
                if ( current ) {
                    editor.undo.saveStep();
                    editor.html.insert( buildInsert( current, modeSelect.value ) );
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
                eqTextArea.clear();
                if ( latex ) eqTextArea.insert( latex, latex.length );
                eqTextArea.notifyOutputs();
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
            MATHML_ELEMENTS.forEach( function ( name ) {
                if ( allowedTags.indexOf( name ) === -1 ) allowedTags.push( name );
            } );
            editor.opts.htmlAllowedTags = allowedTags;

            var allowedAttrs = editor.opts.htmlAllowedAttrs || [];
            [ 'referrerpolicy', 'display', 'xmlns' ].forEach( function ( name ) {
                if ( allowedAttrs.indexOf( name ) === -1 ) allowedAttrs.push( name );
            } );
            editor.opts.htmlAllowedAttrs = allowedAttrs;

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

                if ( target.nodeName.toLowerCase() === 'img' ) {
                    var match = target.src.match( /(gif|svg|png)\.image\?(.*)/ );
                    if ( match ) {
                        editor.popups.hideAll();
                        showDialog( decodeEquation( match[ 2 ] ) );
                    }
                    return;
                }

                var math = target.closest && target.closest( 'math[title]' );
                if ( math ) {
                    var eqLatex = math.getAttribute( 'title' ).trim();
                    if ( eqLatex ) showDialog( eqLatex );
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
