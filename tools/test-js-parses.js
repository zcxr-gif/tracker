// test-js-parses.js
//
// Does every browser-loaded script actually PARSE?
//
// This exists because `node --check` said yes when the browser said no. A
// missing comma between two members of an object literal — MobileSettingsUI is
// `export const MobileSettingsUI = { ... }`, not a class — is a hard syntax
// error in the browser and takes the whole file with it. The map depends on
// that file, so the visible symptom was "the map isn't loading", nothing that
// pointed at settings or events at all.
//
//     $ node --check MobileSettingsUI.js   ->  exit 0   (wrong)
//     browser                              ->  SyntaxError: Unexpected identifier
//
// `node --check` parses a .js file as a script; these are ES modules, and the
// two disagree. A dynamic import() parses as a module, which is what the
// browser does, so that is what this uses.
//
// Only SyntaxError counts as a failure. These modules touch `window` and
// `document` the moment they evaluate, so a ReferenceError here means the file
// parsed fine and then ran in the wrong place — which is expected and not what
// this test is about.
//
// Run:  node tools/test-js-parses.js
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');

// Everything index.html loads locally, plus the crew-centre modules the
// dashboard and pilot pages pull in.
const FILES = fs.readdirSync(ROOT)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => !f.startsWith('_'))
    .sort();

let pass = 0; let fail = 0;

(async () => {
    console.log(`\nParsing ${FILES.length} scripts the way a browser would\n`);

    for (const file of FILES) {
        const url = pathToFileURL(path.join(ROOT, file)).href;
        try {
            await import(url);
            pass++;
        } catch (err) {
            if (err instanceof SyntaxError) {
                console.log(`  ✗ ${file}\n      SyntaxError: ${err.message}`);
                fail++;
            } else {
                // Parsed, then failed to run outside a browser. Fine.
                pass++;
            }
        }
    }

    if (!fail) console.log(`  ✓ all ${pass} parse cleanly`);
    console.log(`\n${fail ? `${fail} file(s) will not parse in a browser.` : `${pass} files checked.`}`);
    process.exit(fail ? 1 : 0);
})();
