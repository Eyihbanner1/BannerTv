// Render PNG jobs from brandgen.py: node render.js <jobs.json> <out-dir>
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const out = process.argv[3];
  const browser = await chromium.launch();
  for (const job of jobs) {
    const page = await browser.newPage({ viewport: { width: job.w, height: job.h }, deviceScaleFactor: 1 });
    const svg = job.svg.replace('<svg ', `<svg width="${job.w}" height="${job.h}" style="display:block" `);
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
    const file = path.join(out, job.out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file, omitBackground: !!job.transparent });
    await page.close();
    console.log(job.out);
  }
  await browser.close();
})();
