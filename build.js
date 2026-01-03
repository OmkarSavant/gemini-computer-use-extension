import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const watch = process.argv.includes('--watch');

// Ensure dist directories exist
fs.mkdirSync('dist/background', { recursive: true });
fs.mkdirSync('dist/sidepanel', { recursive: true });
fs.mkdirSync('dist/content', { recursive: true });
fs.mkdirSync('dist/icons', { recursive: true });

// Copy static files
function copyStatic() {
  // Copy manifest
  fs.copyFileSync('manifest.json', 'dist/manifest.json');

  // Copy icons
  for (const size of ['16', '48', '128']) {
    fs.copyFileSync(`icons/icon${size}.png`, `dist/icons/icon${size}.png`);
  }

  // Copy sidepanel HTML and CSS
  fs.copyFileSync('sidepanel/sidepanel.html', 'dist/sidepanel/sidepanel.html');
  fs.copyFileSync('sidepanel/sidepanel.css', 'dist/sidepanel/sidepanel.css');

  // Copy content script (no bundling needed)
  fs.copyFileSync('content/content.js', 'dist/content/content.js');

  console.log('Static files copied.');
}

// Update manifest to point to dist paths
function updateManifest() {
  const manifest = JSON.parse(fs.readFileSync('dist/manifest.json', 'utf8'));

  // Update paths for dist structure
  manifest.background.service_worker = 'background/service-worker.js';
  manifest.side_panel.default_path = 'sidepanel/sidepanel.html';

  // Remove module type since we're bundling
  delete manifest.background.type;

  fs.writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2));
  console.log('Manifest updated.');
}

// Update sidepanel HTML to point to bundled JS
function updateSidepanelHtml() {
  let html = fs.readFileSync('dist/sidepanel/sidepanel.html', 'utf8');
  // Remove type="module" since we're bundling to IIFE
  html = html.replace('type="module"', '');
  fs.writeFileSync('dist/sidepanel/sidepanel.html', html);
}

copyStatic();
updateManifest();
updateSidepanelHtml();

const buildOptions = {
  entryPoints: [
    'src/background/service-worker.js',
    'src/sidepanel/sidepanel.js'
  ],
  bundle: true,
  outdir: 'dist',
  outbase: 'src',
  format: 'iife',  // IIFE format for Chrome extension compatibility
  platform: 'browser',
  target: 'chrome120',
  sourcemap: watch,
  minify: !watch,
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(buildOptions);
  console.log('Build complete! Load the "dist" folder as an unpacked extension.');
}
