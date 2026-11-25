// Renders public/icons/icon.svg to the PNG sizes the web manifest and iOS need.
// Usage: node tools/make-icons.cjs   (needs Playwright; run once, outputs are committed)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const svg = fs.readFileSync(path.join(__dirname, '../public/icons/icon.svg'), 'utf8');
const out = path.join(__dirname, '../public/icons');
(async () => {
  const b = await chromium.launch();
  const render = async (size, file, { pad = 0, bg = null } = {}) => {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    const inner = size - pad * 2;
    await p.setContent(`<body style="margin:0;background:${bg ?? 'transparent'}"><div style="width:${size}px;height:${size}px;display:grid;place-items:center"><div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div></body>`);
    await p.screenshot({ path: path.join(out, file), omitBackground: bg === null });
    await p.close();
  };
  await render(192, 'icon-192.png');
  await render(512, 'icon-512.png');
  await render(512, 'icon-maskable-512.png', { pad: 64, bg: '#05080e' }); // safe zone for adaptive icons
  await render(180, 'apple-touch-icon.png', { bg: '#05080e' });
  await b.close();
})();
