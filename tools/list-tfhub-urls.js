const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.join(process.env.TEMP, 'cv-model-src', 'hand-pose-detection.js'), 'utf8');
const pose = fs.readFileSync(path.join(process.env.TEMP, 'cv-model-src', 'pose-detection.js'), 'utf8');
const face = fs.readFileSync(path.join(process.env.TEMP, 'cv-model-src', 'face-landmarks-detection.js'), 'utf8');

for (const [label, src] of [
  ['hand', s],
  ['pose', pose],
  ['face', face],
]) {
  console.log('\n==== ' + label + ' ====');
  const urls = [...src.matchAll(/https:\/\/tfhub\.dev\/[^"'`\s]+/g)].map(m => m[0]);
  [...new Set(urls)].forEach(u => console.log(u));
}
