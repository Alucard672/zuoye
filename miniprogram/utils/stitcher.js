/**
 * 轻量图片拼接器（竖向）
 * 使用 OffscreenCanvas 将多张图片竖向拼接为一张，返回 tempFilePath
 */
const Stitcher = {
  async stitchVertical(urls = []) {
    if (!Array.isArray(urls) || urls.length < 2) {
      throw new Error('至少两张图片才能拼接')
    }
    // 先获取尺寸
    const infos = await Promise.all(urls.map(u => new Promise((resolve, reject) => {
      wx.getImageInfo({ src: u, success: resolve, fail: reject })
    })))
    const width = Math.max(...infos.map(i => i.width))
    const totalHeight = infos.reduce((sum, i) => sum + Math.round((i.height * width) / i.width), 0)

    const canvas = wx.createOffscreenCanvas({ type: '2d', width, height: totalHeight })
    const ctx = canvas.getContext('2d')
    let y = 0
    for (let i = 0; i < infos.length; i++) {
      const info = infos[i]
      const img = canvas.createImage()
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
        img.src = urls[i]
      })
      const h = Math.round((info.height * width) / info.width)
      ctx.drawImage(img, 0, y, width, h)
      y += h
    }
    const out = await new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({ canvas, success: (res) => resolve(res.tempFilePath), fail: reject })
    })
    return out
  }
}

module.exports = Stitcher