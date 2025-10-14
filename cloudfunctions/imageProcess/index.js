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

  // 是否将处理结果存入云存储，默认为 true
  const { saveToCloud = true } = (event && event.options) || {};

  // 前端可选参数：ops（逐张操作）、布局与输出模式
  const ops = Array.isArray(event && event.ops) ? event.ops : [];
  // 按需调整：默认采用单张输出，不分页、不拼接
  let outputMode = 'perImage';
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

      // 先完成清晰化（默认不二值化，保留灰度细节）
      let img = await processSingle(buffer, event && event.options);

      // 保持原始方向：不做自动旋转纠正

      // 应用前端手动操作（旋转/翻转）
      if (ops[i]) {
        img = applyOps(img, ops[i]);
      }

      // 维持原图比例与尺寸（不再强制缩放到 TARGET_PX_LOCAL）

      processed.push(img);
    }

    let uploaded = [];

    if (outputMode === 'perImage') {
      // 逐张处理：上传或返回base64
      uploaded = [];
      for (let i = 0; i < processed.length; i++) {
        const buf = await processed[i].getBufferAsync(Jimp.MIME_PNG);
        let item;
        if (saveToCloud) {
          const now = new Date();
          const y = now.getFullYear();
          const m = String(now.getMonth() + 1).padStart(2, '0');
          const d = String(now.getDate()).padStart(2, '0');
          const up = await cloud.uploadFile({
            cloudPath: `processed/${y}/${m}/${d}/single_${Date.now()}_${i + 1}.png`,
            fileContent: buf
          });
          item = {
            fileID: up.fileID,
            width: processed[i].bitmap.width,
            height: processed[i].bitmap.height,
            size: buf.length,
            type: 'single',
            srcIndex: i
          };
        } else {
          // 统一上传到云存储，避免返回大体积 base64
          const now = new Date();
          const y = now.getFullYear();
          const m = String(now.getMonth() + 1).padStart(2, '0');
          const d = String(now.getDate()).padStart(2, '0');
          const up = await cloud.uploadFile({
            cloudPath: `processed/${y}/${m}/${d}/single_${Date.now()}_${i + 1}.png`,
            fileContent: buf
          });
          item = {
            fileID: up.fileID,
            width: processed[i].bitmap.width,
            height: processed[i].bitmap.height,
            size: buf.length,
            type: 'single',
            srcIndex: i
          };
        }
        uploaded.push(item);
      }
    } else {
      // 拼接为自定义尺寸（默认A4）并自动分页
      const pagesOut = await layoutGridPagesCustom(processed, PAGE_WIDTH, PAGE_HEIGHT, CELL_WIDTH_LOCAL, MARGIN, GAP, COLS_LOCAL);

      uploaded = [];
      for (let i = 0; i < pagesOut.length; i++) {
        const buf = await pagesOut[i].getBufferAsync(Jimp.MIME_PNG);
        let item;
        if (saveToCloud) {
          const now = new Date();
          const y = now.getFullYear();
          const m = String(now.getMonth() + 1).padStart(2, '0');
          const d = String(now.getDate()).padStart(2, '0');
          const up = await cloud.uploadFile({
            cloudPath: `processed/${y}/${m}/${d}/merged_${Date.now()}_${i + 1}.png`,
            fileContent: buf
          });
          item = {
            fileID: up.fileID,
            width: pagesOut[i].bitmap.width,
            height: pagesOut[i].bitmap.height,
            size: buf.length,
            type: 'page',
            pageIndex: i
          };
        } else {
          // 统一上传到云存储，避免返回大体积 base64
          const now = new Date();
          const y = now.getFullYear();
          const m = String(now.getMonth() + 1).padStart(2, '0');
          const d = String(now.getDate()).padStart(2, '0');
          const up = await cloud.uploadFile({
            cloudPath: `processed/${y}/${m}/${d}/merged_${Date.now()}_${i + 1}.png`,
            fileContent: buf
          });
          item = {
            fileID: up.fileID,
            width: pagesOut[i].bitmap.width,
            height: pagesOut[i].bitmap.height,
            size: buf.length,
            type: 'page',
            pageIndex: i
          };
        }
        uploaded.push(item);
      }
    }

    // 统一返回结构（精简，避免返回大体积 base64）
    const singleItem = uploaded.length === 1 ? uploaded[0] : {};
    const singleFid = singleItem.fileID;

    // 单张时返回最小必要信息
    if (uploaded.length === 1) {
      return {
        success: true,
        data: {
          fileID: singleItem.fileID,
          processedFileID: singleItem.fileID,
          width: singleItem.width,
          height: singleItem.height,
          processTime: Date.now() - t0,
          perImageCount: processed.length,
          mode: outputMode
        }
      };
    }

    // 多项时返回精简字段（不包含 base64）
    const safeItems = uploaded.map(it => ({
      fileID: it.fileID,
      width: it.width,
      height: it.height,
      size: it.size,
      type: it.type,
      pageIndex: it.pageIndex,
      srcIndex: it.srcIndex
    }));

    return {
      success: true,
      data: {
        items: safeItems,
        pages: outputMode === 'pages' ? safeItems : [],
        pageCount: outputMode === 'pages' ? safeItems.length : 0,
        processTime: Date.now() - t0,
        perImageCount: processed.length,
        processedFileID: uploaded[0] && uploaded[0].fileID,
        fileID: uploaded[0] && uploaded[0].fileID,
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
async function processSingle(buffer, options) {
  let img = await Jimp.read(buffer);

  // 保持原尺寸；仅在超大图时做适度下采样以控内存
  if (img.bitmap.width > 2000) {
    img = img.resize(1600, Jimp.AUTO);
  }

  const {
    version = 'v2', // Default to new version. v1: selective brightening, v2: adaptive normalization
  } = options || {};

  img.grayscale();

  if (version === 'v2') {
    // v2: Adaptive background normalization. Optimized for performance.
    console.log('Using image processing v2: adaptive normalization (optimized)');

    // Optimization: Downscale for fast background estimation, then upscale.
    const smallWidth = 200; // Further reduce size for speed
    const background = img.clone()
      .resize(smallWidth, Jimp.AUTO) // Shrink
      .gaussian(10) // Reduce blur radius for speed
      .resize(img.bitmap.width, img.bitmap.height, Jimp.RESIZE_BICUBIC); // Scale back up

    const contrastFactor = 1.5;
    const targetBg = 255; // Target background color (pure white)

    img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
      const originalLum = this.bitmap.data[idx];
      const backgroundLum = background.bitmap.data[idx];

      // Normalize: (original - background) * contrast + target_background
      let newVal = (originalLum - backgroundLum) * contrastFactor + targetBg;
      newVal = Math.max(0, Math.min(255, newVal)); // Clamp to 0-255

      this.bitmap.data[idx + 0] = newVal;
      this.bitmap.data[idx + 1] = newVal;
      this.bitmap.data[idx + 2] = newVal;
    });

  } else {
    // v1: Selective brightening based on global thresholds. Simpler, faster.
    console.log('Using image processing v1: selective brightening');
    // 作为背景参考的轻度模糊副本（仅用于高亮区域的去噪）
    const blurred = img.clone().gaussian(2);

    const src = img.bitmap.data;
    const blurData = blurred.bitmap.data;

    // 阈值可按需调整
    const T_BG = 180;     // 背景高亮阈值：更高的像素视为背景
    const T_MID = 140;    // 中灰阈值：轻微提亮，避免灰底
    const LIFT_BG = 16;   // 背景提升幅度（提亮）
    const LIFT_MID = 6;   // 中灰轻提升
    const DARKEN_TEXT = 4;// 暗文字轻微加深，提升对比

    for (let i = 0; i < src.length; i += 4) {
      // 灰度图：R=G=B，任选一个通道即可
      const g = src[i];
      let v = g;

      if (g >= T_BG) {
        // 背景：用模糊值替换以去噪 + 小幅提亮
        v = blurData[i];
        v = Math.min(255, v + LIFT_BG);
      } else if (g >= T_MID) {
        // 中灰：仅轻微提亮，保留细节
        v = Math.min(255, g + LIFT_MID);
      } else {
        // 暗文字与下划线：轻微加深，保护细节，不做平滑
        v = Math.max(0, g - DARKEN_TEXT);
      }

      src[i] = v;
      src[i + 1] = v;
      src[i + 2] = v;
      // alpha 保持不变
    }
  }

  // 若未显式要求二值化，则直接返回增强后的灰度图，最大化保留细节
  const doBinary = options && options.binary === true;
  if (!doBinary) {
    return img;
  }

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

  // 保守二值化参数（仅在 options.binary=true 时使用），更利于保留细线
  const R = 10;
  const bias = 10;
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
  // 保守的小连通域过滤阈值，尽量保留细线条（如下划线）
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