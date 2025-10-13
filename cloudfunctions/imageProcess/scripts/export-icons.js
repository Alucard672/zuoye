/**
 * Batch convert SVG icons in project /images to PNG using sharp.
 * Output: overwrite corresponding .png files (96x96).
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

(async () => {
  try {
    // project root: from cloudfunctions/imageProcess/scripts -> go up three levels
    const rootDir = path.resolve(__dirname, '../../..');
    const imagesDir = path.join(rootDir, 'images');

    if (!fs.existsSync(imagesDir)) {
      console.error('[export-icons] images directory not found:', imagesDir);
      process.exit(1);
    }

    // list svg files in images
    const files = fs.readdirSync(imagesDir).filter(f => f.toLowerCase().endsWith('.svg'));
    if (files.length === 0) {
      console.error('[export-icons] No SVG icons found in images/');
      process.exit(1);
    }

    // Default output size for icons
    const defaultSize = 96;

    // Optional per-file size overrides (if needed later)
    const sizeMap = {
      'logo.svg': 80,
      'success-icon.svg': 120
    };

    console.log('[export-icons] Converting SVG -> PNG in:', imagesDir);
    for (const svgName of files) {
      const base = svgName.replace(/\.svg$/i, '');
      const svgPath = path.join(imagesDir, svgName);
      const pngPath = path.join(imagesDir, `${base}.png`);

      const outSize = sizeMap[svgName] || defaultSize;

      try {
        const svgBuffer = fs.readFileSync(svgPath);
        // Render to PNG with fixed size, transparent background preserved
        const pngBuffer = await sharp(svgBuffer, { density: 144 })
          .resize(outSize, outSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png({ quality: 90 })
          .toBuffer();

        fs.writeFileSync(pngPath, pngBuffer);
        console.log(`✓ ${svgName} -> ${base}.png (${outSize}x${outSize})`);
      } catch (e) {
        console.error(`✗ Failed: ${svgName}`, e.message);
      }
    }

    console.log('[export-icons] Done.');
    process.exit(0);
  } catch (err) {
    console.error('[export-icons] Fatal error:', err);
    process.exit(1);
  }
})();