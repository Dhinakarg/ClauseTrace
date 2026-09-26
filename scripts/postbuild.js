import fs from 'fs';
if (fs.existsSync('dist')) {
  if (fs.existsSync('dist/index.html')) {
    fs.copyFileSync('dist/index.html', 'dist/404.html');
    console.log('Copied dist/index.html -> dist/404.html for SPA GitHub Pages routing');
  }
  fs.writeFileSync('dist/.nojekyll', '');
  console.log('Created dist/.nojekyll to disable Jekyll on GitHub Pages');
}
