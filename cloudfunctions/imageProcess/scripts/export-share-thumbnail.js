/**
 * Generate small share thumbnail from logo.svg or logo.png
 * Output: /images/share-logo.png (200x200, quality 70)
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

(async () => {
  try {
    const rootDir = path.resolve(__dirname, '../../..');
    const imagesDir = path.join(rootDir, 'images');
    const outPath = path.join(imagesDir, 'share-logo.png');

    const svgPath = path.join(imagesDir, 'logo.svg');
    const pngPath = path.join(imagesDir, 'logo.png');

    let inputBuffer = null;
    let from = '';

    if (fs.existsSync(svgPath)) {
      inputBuffer = fs.readFileSync(svgPath);
      from = 'logo.svg';
    } else if (fs.existsSync(pngPath)) {
      inputBuffer = fs.readFileSync(pngPath);
      from = 'logo.png';
    } else {
      console.error('[export-share-thumbnail] logo not found in images/');
      process.exit(1);
    }

    const outBuf = await sharp(inputBuffer, { density: 144 })
      .resize(200, 200, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ quality: 70 })
      .toBuffer();

    fs.writeFileSync(outPath, outBuf);
    console.log(`[export-share-thumbnail] ✓ ${from} -> share-logo.png (200x200, q=70)`);
    process.exit(0);
  } catch (e) {
    console.error('[export-share-thumbnail] Failed:', e);
    process.exit(1);
  }
})();