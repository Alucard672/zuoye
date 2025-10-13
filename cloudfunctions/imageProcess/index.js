// cloudfunctions/imageProcess/index.js
const cloud = require('wx-server-sdk');
const Jimp = require('jimp');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// A4竖版 + 两列栅格排版参数
const A4_WIDTH = 1240;
const A4_HEIGHT = 1754;
const MARGIN = 40;
const GAP = 20;
// 单列：每张图宽约 200mm（保留左右留白）
const COLS = 1;
const TARGET_MM = 200; // 目标宽度（毫米）
const TARGET_PX = Math.round(A4_WIDTH * TARGET_MM / 210); // 约 1181 px
const CELL_WIDTH = Math.floor((A4_WIDTH - MARGIN * 2 - GAP * (COLS - 1)) / COLS);

exports.main = async (event, context) => {
  const t0 = Date.now();

  // 兼容多键名：imageUrls/images/files/list 或单张 imageUrl
  const imageUrl = (event && event.imageUrl) || null;
  const imageUrls =
    (event && event.imageUrls) ||
    (event && event.images) ||
    (event && event.files) ||
    (event && event.list) ||
    null;

  const files = Array.isArray(imageUrls)
    ? imageUrls.filter(Boolean)
    : (imageUrl ? [imageUrl] : []);

  if (!files.length) {
    return { success: false, error: 'imageUrl or imageUrls is required.', code: 'INVALID_ARGS' };
  }
  // 限制一次处理的最大数量，避免超时/内存风险（可按需调整）
  const MAX_BATCH = 10;
  if (files.length > MAX_BATCH) {
    files.length = MAX_BATCH;
  }

  // 前端可选参数：ops（逐张操作）、布局与输出模式
  const ops = Array.isArray(event && event.ops) ? event.ops : [];
  let outputMode = (event && event.outputMode) || 'pages'; // 'perImage' 或 'pages'
  if (outputMode !== 'pages' && outputMode !== 'perImage') outputMode = 'pages';
  const layout = (event && event.layout) || {};
  const pageCfg = layout.page || {};
  // 支持自定义纸张尺寸；默认沿用 A4
  const PAGE_WIDTH = pageCfg.widthPx || A4_WIDTH;
  const PAGE_HEIGHT = pageCfg.heightPx || A4_HEIGHT;
  const targetMM = layout.targetWidthMM || TARGET_MM; // 例如 200mm
  const COLS_LOCAL = layout.cols || 1;
  const CELL_WIDTH_LOCAL = Math.floor((PAGE_WIDTH - MARGIN * 2 - GAP * (COLS_LOCAL - 1)) / COLS_LOCAL);
  const TARGET_PX_LOCAL = Math.round(PAGE_WIDTH * targetMM / 210);

  try {
    // 下载并处理所有图片（含方向纠正：按文字横排得分）
    const processed = [];
    for (let i = 0; i < files.length; i++) {
      const dl = await cloud.downloadFile({ fileID: files[i] });
      const buffer = dl.fileContent;

      // 先完成清晰化与二值化
      let img = await processSingle(buffer);

      // 文字方向纠正：如未指定跳过，则自动纠正
      if (!(ops[i] && ops[i].skipAutoOrientation)) {
        img = ensureUprightByText(img);
      }

      // 应用前端手动操作（旋转/翻转）
      if (ops[i]) {
        img = applyOps(img, ops[i]);
      }

      // 统一缩放到约 targetMM 宽（保留留白；不降质只按宽度同比缩放）
      if (img.bitmap.width !== TARGET_PX_LOCAL) {
        img = img.resize(TARGET_PX_LOCAL, Jimp.AUTO);
      }

      processed.push(img);
    }

    let uploaded = [];

    if (outputMode === 'perImage') {
      // 逐张上传，便于前端单独选择、高清查看、手动方向调整
      uploaded = [];
      for (let i = 0; i < processed.length; i++) {
        const buf = await processed[i].getBufferAsync(Jimp.MIME_PNG);
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const up = await cloud.uploadFile({
          cloudPath: `processed/${y}/${m}/${d}/single_${Date.now()}_${i + 1}.png`,
          fileContent: buf
        });
        uploaded.push({
          fileID: up.fileID,
          width: processed[i].bitmap.width,
          height: processed[i].bitmap.height,
          size: buf.length,
          type: 'single',
          srcIndex: i
        });
      }
    } else {
      // 拼接为自定义尺寸（默认A4）并自动分页
      const pagesOut = await layoutGridPagesCustom(processed, PAGE_WIDTH, PAGE_HEIGHT, CELL_WIDTH_LOCAL, MARGIN, GAP, COLS_LOCAL);

      uploaded = [];
      for (let i = 0; i < pagesOut.length; i++) {
        const buf = await pagesOut[i].getBufferAsync(Jimp.MIME_PNG);
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const up = await cloud.uploadFile({
          cloudPath: `processed/${y}/${m}/${d}/merged_${Date.now()}_${i + 1}.png`,
          fileContent: buf
        });
        uploaded.push({
          fileID: up.fileID,
          width: pagesOut[i].bitmap.width,
          height: pagesOut[i].bitmap.height,
          size: buf.length,
          type: 'page',
          pageIndex: i
        });
      }
    }

    // 统一返回结构：兼容单页与多项
    const singleFid = uploaded.length === 1 ? uploaded[0].fileID : undefined;
    return {
      success: true,
      data: {
        items: uploaded, // 兼容 perImage 或 pages
        pages: outputMode === 'pages' ? uploaded : [],
        pageCount: outputMode === 'pages' ? uploaded.length : 0,
        processTime: Date.now() - t0,
        perImageCount: processed.length,
        processedFileID: singleFid,
        fileID: singleFid,
        mode: outputMode
      }
    };
  } catch (err) {
    console.error('[imageProcess] failed:', err);
    return {
      success: false,
      error: `Image processing failed: ${err.message}`,
      code: 'JIMP_PROCESS_ERROR'
    };
  }
};

// 单张清晰化 + 抑制背面透字 + 小连通域过滤（性能优化：宽度>1600先缩）
async function processSingle(buffer) {
  let img = await Jimp.read(buffer);

  if (img.bitmap.width > 1600) {
    img = img.resize(1600, Jimp.AUTO);
  }

  // 轻度预处理：避免强对比造成大片全黑
  img
    .grayscale()
    .brightness(0.02)
    .contrast(0.2)
    .gaussian(1);

  const { width, height, data } = img.bitmap;

  // 自适应局部阈值（二值化）：避免全局硬阈值导致大片全黑
  const idxAt = (x, y) => ((width * y + x) << 2);
  // 构建积分图（summed-area table），用于快速计算任意窗口均值
  const sat = new Uint32Array((width + 1) * (height + 1)); // 多一行一列填零
  const satIndex = (x, y) => (y * (width + 1) + x);

  for (let y = 1; y <= height; y++) {
    let rowSum = 0;
    for (let x = 1; x <= width; x++) {
      const g = data[idxAt(x - 1, y - 1)];
      rowSum += g;
      sat[satIndex(x, y)] = sat[satIndex(x, y - 1)] + rowSum;
    }
  }

  const R = 10; // 窗口半径，约21x21
  const bias = 12; // 偏置，前景需比局部均值更暗一点
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - R), y1 = Math.min(height - 1, y + R);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - R), x1 = Math.min(width - 1, x + R);
      // 转为积分图坐标（+1）
      const A = sat[satIndex(x0, y0)];
      const B = sat[satIndex(x1 + 1, y0)];
      const C = sat[satIndex(x0, y1 + 1)];
      const D = sat[satIndex(x1 + 1, y1 + 1)];
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const mean = (D - B - C + A) / area;

      const idx = idxAt(x, y);
      const g = data[idx];
      const isForeground = g < (mean - bias);
      const val = isForeground ? 0 : 255;
      data[idx] = val; data[idx + 1] = val; data[idx + 2] = val;
    }
  }

  // 小连通域过滤（8邻域）
  const isBlack = (idx) => data[idx] === 0 && data[idx + 1] === 0 && data[idx + 2] === 0;
  const visited = new Uint8Array(width * height);
  const posIndex = (x, y) => (width * y + x);
  const dirs = [[-1,0],[1,0],[0,-1],[0,1],[ -1,-1 ],[ -1,1 ],[ 1,-1 ],[ 1,1 ]];
  const areaThreshold = Math.max(25, Math.floor((width * height) * 0.00002));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = posIndex(x, y);
      if (visited[p]) continue;
      const di = idxAt(x, y);
      if (!isBlack(di)) { visited[p] = 1; continue; }

      let queue = [[x, y]];
      let area = 0;
      let pixels = [];
      visited[p] = 1;

      while (queue.length) {
        const [cx, cy] = queue.pop();
        const cPos = posIndex(cx, cy);
        const cIdx = idxAt(cx, cy);
        if (!isBlack(cIdx)) continue;

        area++;
        pixels.push(cIdx);

        for (const [dx, dy] of dirs) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nPos = posIndex(nx, ny);
          if (visited[nPos]) continue;
          const nIdx = idxAt(nx, ny);
          if (isBlack(nIdx)) {
            visited[nPos] = 1;
            queue.push([nx, ny]);
          } else {
            visited[nPos] = 1;
          }
        }
      }

      if (area < areaThreshold) {
        for (const i of pixels) {
          data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
        }
      }
    }
  }

  return img;
}

// 根据文字横排得分纠正方向：选择“行黑像素方差”更大的方向
function ensureUprightByText(img) {
  // 评估 0/90/180/270 四个角度，先用横向行方差选最佳
  const candidates = [
    { deg: 0,  im: img },
    { deg: 90, im: img.clone().rotate(90) },
    { deg: 180, im: img.clone().rotate(180) },
    { deg: 270, im: img.clone().rotate(270) }
  ];
  let best = candidates[0], bestScore = horizontalLineScore(candidates[0].im);
  for (let i = 1; i < candidates.length; i++) {
    const sc = horizontalLineScore(candidates[i].im);
    if (sc > bestScore) { best = candidates[i]; bestScore = sc; }
  }
  // 若最佳为0或180，追加上下密度判别以避免“文字头朝下”
  if (best.deg === 0 || best.deg === 180) {
    const score0 = topBottomBalance(candidates.find(c => c.deg === 0).im);
    const score180 = topBottomBalance(candidates.find(c => c.deg === 180).im);
    best = (score0 > score180) ? candidates.find(c => c.deg === 0) : candidates.find(c => c.deg === 180);
  }
  return best.im;
}

// 前端手动操作应用：旋转/翻转
function applyOps(img, op = {}) {
  let out = img;
  if (op.rotateDeg) {
    const deg = ((op.rotateDeg % 360) + 360) % 360;
    out = out.rotate(deg);
  }
  if (op.flipH) out = out.flip(true, false);
  if (op.flipV) out = out.flip(false, true);
  return out;
}

// 计算上下密度差：上1/3与下1/3黑像素数之差（越大表示更“正”）
function topBottomBalance(img) {
  const { width, height, data } = img.bitmap;
  const isBlack = (idx) => data[idx] === 0 && data[idx + 1] === 0 && data[idx + 2] === 0;
  const H1 = Math.floor(height / 3);
  const H2 = height - H1;
  let top = 0, bottom = 0;
  for (let y = 0; y < H1; y++) {
    let base = (width * y) << 2;
    for (let x = 0; x < width; x++) {
      const idx = base + (x << 2);
      if (isBlack(idx)) top++;
    }
  }
  for (let y = H2; y < height; y++) {
    let base = (width * y) << 2;
    for (let x = 0; x < width; x++) {
      const idx = base + (x << 2);
      if (isBlack(idx)) bottom++;
    }
  }
  // 返回上-下，数值越大说明更接近“文字头在上”
  return top - bottom;
}

// 计算横向文字行得分：对每一行统计黑像素数，平滑后取方差
function horizontalLineScore(img) {
  const { width, height, data } = img.bitmap;
  const rows = new Array(height).fill(0);

  // 黑像素判断
  const isBlack = (idx) => data[idx] === 0 && data[idx + 1] === 0 && data[idx + 2] === 0;

  for (let y = 0; y < height; y++) {
    let count = 0;
    let base = (width * y) << 2;
    for (let x = 0; x < width; x++) {
      const idx = base + (x << 2);
      if (isBlack(idx)) count++;
    }
    rows[y] = count;
  }

  // 轻度平滑（移动平均窗口=5）
  const smoothed = rows.slice();
  const K = 2;
  for (let y = 0; y < height; y++) {
    let sum = 0, c = 0;
    for (let k = -K; k <= K; k++) {
      const yy = y + k;
      if (yy >= 0 && yy < height) { sum += rows[yy]; c++; }
    }
    smoothed[y] = sum / c;
  }

  // 计算方差作为行结构显著度
  let mean = 0;
  for (let y = 0; y < height; y++) mean += smoothed[y];
  mean /= height;

  let varSum = 0;
  for (let y = 0; y < height; y++) {
    const d = smoothed[y] - mean;
    varSum += d * d;
  }
  const variance = varSum / height;

  // 增强信噪比：用最大值归一化
  const maxVal = Math.max(...smoothed) || 1;
  return variance / maxVal;
}

// 两列栅格排版：按行填充，每行最多2张，行高为本行最大高度
/**
 * 自定义尺寸拼接分页
 * @param {Jimp[]} images
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @param {number} cellWidth
 * @param {number} margin
 * @param {number} gap
 * @param {number} cols
 */
async function layoutGridPagesCustom(images, pageWidth, pageHeight, cellWidth, margin, gap, cols) {
  const pages = [];
  let page = new Jimp(pageWidth, pageHeight, 0xFFFFFFFF);
  let cursorY = margin;
  let col = 0;
  let rowMaxH = 0;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const w = img.bitmap.width;
    const h = img.bitmap.height;

    // 新行且空间不足则分页
    if (col === 0 && (cursorY + h > pageHeight - margin)) {
      pages.push(page);
      page = new Jimp(pageWidth, pageHeight, 0xFFFFFFFF);
      cursorY = margin;
      col = 0;
      rowMaxH = 0;
    }

    const xLeft = margin;
    const xRight = margin + cellWidth + gap;
    const xCell = (cols === 1 || col === 0) ? xLeft : xRight;
    const x = xCell + Math.floor((cellWidth - w) / 2);

    page.composite(img, x, cursorY);
    rowMaxH = Math.max(rowMaxH, h);

    // 切换列或换行
    if (cols === 1) {
      col = 0;
      cursorY += h + gap;
      rowMaxH = 0;
    } else {
      if (col === 0) {
        col = 1;
      } else {
        col = 0;
        cursorY += rowMaxH + gap;
        rowMaxH = 0;
      }
    }
  }

  pages.push(page);
  return pages;
}

// 保留原函数签名以兼容旧调用（当前实现单列）
async function layoutGridPages(images) {
  const pages = [];
  let page = new Jimp(A4_WIDTH, A4_HEIGHT, 0xFFFFFFFF);
  let cursorY = MARGIN;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const w = img.bitmap.width;
    const h = img.bitmap.height;

    // 剩余空间不足则分页
    if (cursorY + h > A4_HEIGHT - MARGIN) {
      pages.push(page);
      page = new Jimp(A4_WIDTH, A4_HEIGHT, 0xFFFFFFFF);
      cursorY = MARGIN;
    }

    // 单列居左，保留左右留白；水平居中到目标宽的单元格
    const x = MARGIN + Math.floor((CELL_WIDTH - w) / 2);
    page.composite(img, x, cursorY);

    // 下一行
    cursorY += h + GAP;
  }

  pages.push(page);
  return pages;
}