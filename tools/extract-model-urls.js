const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const tmp = path.join(process.env.TEMP || '/tmp', 'cv-model-src');
fs.mkdirSync(tmp, { recursive: true });

const pkgs = [
  { name: 'coco-ssd', ver: '2.2.3', path: 'dist/coco-ssd.js' },
  { name: 'pose-detection', ver: '2.1.3', path: 'dist/pose-detection.js' },
  { name: 'hand-pose-detection', ver: '2.0.1', path: 'dist/hand-pose-detection.js' },
  { name: 'body-pix', ver: '2.2.0', path: 'dist/body-pix.js' },
  { name: 'face-landmarks-detection', ver: '1.0.5', path: 'dist/face-landmarks-detection.js' },
  { name: 'depth-estimation', ver: '0.0.3', path: 'dist/depth-estimation.js' },
  { name: 'body-segmentation', ver: '1.0.1', path: 'dist/body-segmentation.js' },
];

function get(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        get(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`${url} -> ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

(async () => {
  for (const p of pkgs) {
    const url = `https://cdn.jsdelivr.net/npm/@tensorflow-models/${p.name}@${p.ver}/${p.path}`;
    const out = path.join(tmp, `${p.name}.js`);
    process.stdout.write(`GET ${url}\n`);
    try {
      const buf = await get(url);
      fs.writeFileSync(out, buf);
      process.stdout.write(`OK ${p.name} ${buf.length}\n`);
    } catch (e) {
      process.stdout.write(`FAIL ${p.name}: ${e.message}\n`);
    }
  }

  for (const f of fs.readdirSync(tmp).filter(x => x.endsWith('.js'))) {
    const s = fs.readFileSync(path.join(tmp, f), 'utf8');
    const urls = [...s.matchAll(/https?:\/\/[^"'\\\s)]+/g)].map(m => m[0]);
    const uniq = [...new Set(urls)].filter(u =>
      /tfhub|storage\.googleapis|kaggle|tensorflow|model|weights|movenet|ssd|body|hand|face|depth|portrait|tfjs/i.test(u)
    );
    console.log(`\n==== ${f} ====`);
    uniq.forEach(u => console.log(u));
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
