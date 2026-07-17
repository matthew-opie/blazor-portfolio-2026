const fs = require('fs');
const path = require('path');
const dir = path.join(process.env.TEMP || '/tmp', 'cv-model-src');

function dump(file, patterns) {
  const s = fs.readFileSync(path.join(dir, file), 'utf8');
  console.log(`\n======== ${file} ========`);
  for (const re of patterns) {
    const matches = [...s.matchAll(re)];
    for (const m of matches.slice(0, 30)) {
      const start = Math.max(0, m.index - 80);
      const end = Math.min(s.length, m.index + m[0].length + 120);
      console.log('---');
      console.log(s.slice(start, end).replace(/\s+/g, ' '));
    }
  }
}

dump('coco-ssd.js', [
  /BASE_PATH[^;]{0,200}/g,
  /modelUrl[^,]{0,120}/g,
  /lite_mobilenet[^"'`]{0,80}/g,
  /mobilenet_v2[^"'`]{0,80}/g,
  /savedmodel\/[^"'`]+/g,
]);

dump('body-pix.js', [
  /quantBytes[^,]{0,80}/g,
  /mobilenet\/[^"'`]+/g,
  /modelUrl[^,]{0,120}/g,
  /BASE_URL[^;]{0,200}/g,
  /multiplier[^,]{0,80}/g,
]);

dump('pose-detection.js', [
  /SINGLEPOSE_LIGHTNING[^,]{0,100}/g,
  /SINGLEPOSE_THUNDER[^,]{0,100}/g,
  /modelUrl[^,]{0,160}/g,
  /DEFAULT_MOVENET[^;]{0,200}/g,
]);

dump('hand-pose-detection.js', [
  /detectorModelUrl[^,]{0,160}/g,
  /landmarkModelUrl[^,]{0,160}/g,
  /DEFAULT_[A-Z_]+[^;]{0,220}/g,
]);

dump('face-landmarks-detection.js', [
  /detectorModelUrl[^,]{0,160}/g,
  /landmarkModelUrl[^,]{0,160}/g,
  /DEFAULT_[A-Z_]+[^;]{0,220}/g,
]);

dump('depth-estimation.js', [
  /modelUrl[^,]{0,160}/g,
  /DEFAULT_[A-Z_]+[^;]{0,220}/g,
  /ar_portrait[^"'`]{0,80}/g,
]);
