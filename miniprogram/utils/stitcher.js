/**
 * 轻量图片拼接器（竖向）
 * - 自适应目标宽度（降低内存峰值）
 * - 分步让出主线程避免长时间阻塞导致黑屏
 * - 按平台设置导出质量，减少生成时内存/CPU压力
 */
const Stitcher = {
  async stitchVertical(urls = []) {
    if (!Array.isArray(urls) || urls.length < 2) {
      throw new Error('至少两张图片才能拼接')
    }

    const sys = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {}
    const isAndroid = (sys.platform || '').toLowerCase() === 'android'
    const memGB = Number(sys.benchmarkLevel || sys.memory || 4)
    // 基于平台与内存估算目标宽
    // iOS/高配：1600，安卓或低内存：1280，更低再 1080
    let targetWidth = isAndroid ? 1280 : 1600
    if (memGB && memGB < 4) targetWidth = 1080

    // 读取每张尺寸
    const infos = await Promise.all(
      urls.map(u => new Promise((resolve, reject) => {
        wx.getImageInfo({ src: u, success: resolve, fail: reject })
      }))
    )

    // 实际绘制宽度 = min(最大原宽, targetWidth)
    const maxW = Math.max(...infos.map(i => i.width))
    const width = Math.min(maxW, targetWidth)
    const heights = infos.map(i => Math.round((i.height * width) / i.width))
    const totalHeight = heights.reduce((a, b) => a + b, 0)

    // 兼容 OffscreenCanvas 与普通 canvas
    const createCanvas = () => {
      if (wx.createOffscreenCanvas) {
        return wx.createOffscreenCanvas({ type: '2d', width, height: totalHeight })
      }
      const canvas = wx.createCanvas()
      // 在部分环境下需先设置宽高
      canvas.width = width
      canvas.height = totalHeight
      return canvas
    }

    const canvas = createCanvas()
    const ctx = canvas.getContext('2d')

    // 白底填充，避免透明叠加造成额外内存与渲染成本
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, totalHeight)

    // 分步绘制，逐张让出主线程
    let y = 0
    for (let i = 0; i < infos.length; i++) {
      const info = infos[i]
      const img = canvas.createImage()
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
        img.src = urls[i]
      })
      const h = heights[i]
      ctx.drawImage(img, 0, y, width, h)
      y += h
      // 让出一帧，避免长时间阻塞引发黑屏（特别是安卓）
      // 使用 Promise + setTimeout(0) 最通用
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, 0))
    }

    // 导出：安卓降低质量，使用 jpg 减小体积
    const quality = isAndroid ? 0.7 : 0.85
    const out = await new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas,
        fileType: 'jpg',
        quality,
        success: (res) => resolve(res.tempFilePath),
        fail: reject
      })
    })

    return out
  }
}

module.exports = Stitcher