// Render PNG jobs from brandgen.py: node render.js <jobs.json> <out-dir>
// Or shrink PNGs it rendered before, with every byte of the picture unchanged:
// node render.js --recompress <file.png>...
// An ES module, as the repository's package.json makes every .js file.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Chromium saves screenshots with quick compression. The same filtered rows
// deflated at the highest level make the 1920x1080 splash a quarter smaller.
// Nothing else changes: the rows, their filters and every other chunk stay as
// they were, so the picture is the same to the byte.
function recompress(png) {
  const out = [png.subarray(0, 8)];
  const idat = [];
  let idatAt = -1;
  for (let pos = 8; pos < png.length; ) {
    const length = png.readUInt32BE(pos);
    const type = png.toString('latin1', pos + 4, pos + 8);
    if (type === 'IDAT') {
      if (idatAt < 0) idatAt = out.length;
      idat.push(png.subarray(pos + 8, pos + 8 + length));
    } else {
      out.push(png.subarray(pos, pos + 12 + length));
    }
    pos += 12 + length;
  }
  const rows = zlib.inflateSync(Buffer.concat(idat));
  const data = zlib.deflateSync(rows, { level: 9 });
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write('IDAT', 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(data, zlib.crc32(head.subarray(4))), 0);
  out.splice(idatAt, 0, head, data, crc);
  const smaller = Buffer.concat(out);
  return smaller.length < png.length ? smaller : png;
}

async function render(jobsFile, out) {
  const { chromium } = await import('playwright');
  const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  const browser = await chromium.launch();
  for (const job of jobs) {
    const page = await browser.newPage({ viewport: { width: job.w, height: job.h }, deviceScaleFactor: 1 });
    const svg = job.svg.replace('<svg ', `<svg width="${job.w}" height="${job.h}" style="display:block" `);
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
    const file = path.join(out, job.out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, recompress(await page.screenshot({ omitBackground: !!job.transparent })));
    await page.close();
    console.log(job.out);
  }
  await browser.close();
}

if (process.argv[2] === '--recompress') {
  for (const file of process.argv.slice(3)) {
    const before = fs.readFileSync(file);
    const after = recompress(before);
    fs.writeFileSync(file, after);
    console.log(`${file}: ${before.length} -> ${after.length} bytes`);
  }
} else {
  render(process.argv[2], process.argv[3]);
}
