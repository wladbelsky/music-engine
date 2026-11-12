/* Builds js/three.min.js from the `three` devDependency: `npm run vendor:three`.
 *
 * three ships ES modules only (no UMD since r160, no minified build either), and the wallpaper is plain scripts
 * that must load from file:// in Wallpaper Engine. So the library and the addons we use are bundled once into a
 * classic script that sets window.THREE, and the result is committed: the wallpaper itself still has no build step.
 *
 * THREE must be a plain object: with esbuild's --global-name the exports are getters, and the test stubs
 * (THREE.WebGLRenderer = class ..., test/helpers/load.js) would silently not apply. */
'use strict';
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PKG = path.join(ROOT, 'node_modules', 'three');
// addons (examples/jsm) that js/core uses; add a name here and run the script again
const ADDONS = {
  EffectComposer: 'postprocessing/EffectComposer.js',
  RenderPass: 'postprocessing/RenderPass.js',
  UnrealBloomPass: 'postprocessing/UnrealBloomPass.js',
  OutputPass: 'postprocessing/OutputPass.js',
  GTAOPass: 'postprocessing/GTAOPass.js',
};

const entry = [
  "import * as T from 'three';",
  ...Object.entries(ADDONS).map(([n, f]) => `import { ${n} } from 'three/addons/${f}';`),
  `globalThis.THREE = Object.assign({}, T, { ${Object.keys(ADDONS).join(', ')} });`,
].join('\n');

const version = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).version;
const out = path.join(ROOT, 'js', 'three.min.js');
esbuild.buildSync({
  stdin: { contents: entry, resolveDir: ROOT, sourcefile: 'three-entry.js' },
  bundle: true, format: 'iife', minify: true, legalComments: 'none', target: 'es2020',
  banner: { js: `/**\n * @license\n * three.js ${version} + addons (${Object.keys(ADDONS).join(', ')}), bundled by tools/vendor-three.js\n * Copyright 2010-${new Date().getFullYear()} Three.js Authors\n * SPDX-License-Identifier: MIT\n */` },
  outfile: out,
});
fs.copyFileSync(path.join(PKG, 'LICENSE'), path.join(ROOT, 'js', 'three.LICENSE.txt'));
console.log(`wrote js/three.min.js (three ${version}, ${Math.round(fs.statSync(out).size / 1024)} KB)`);
