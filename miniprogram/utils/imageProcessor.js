/**
 * 图像处理工具类
 * 负责图片的清晰度优化、噪点去除等核心功能
 */

class ImageProcessor {
  constructor() {
    this.canvas = null
    this.ctx = null
  }

  /**
   * 初始化Canvas
   */
  initCanvas(width, height) {
    this.canvas = wx.createCanvasContext('imageCanvas')
    return this.canvas
  }

  /**
   * 主要的图像处理函数
   * @param {string} imagePath - 图片路径
   * @param {string} mode - 处理模式 ('auto' | 'enhance')
   * @param {function} progressCallback - 进度回调
   * @returns {Promise<string>} 处理后的图片路径
   */
  async processImage(imagePath, mode = 'auto', progressCallback) {
    return new Promise((resolve, reject) => {
      try {
        // 获取图片信息
        wx.getImageInfo({
          src: imagePath,
          success: (imageInfo) => {
            this.performImageProcessing(imageInfo, mode, progressCallback)
              .then(resolve)
              .catch(reject)
          },
          fail: reject
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * 执行图像处理
   */
  async performImageProcessing(imageInfo, mode, progressCallback) {
    const { width, height, path } = imageInfo
    
    // Step 1: 创建Canvas
    progressCallback && progressCallback(10, '准备处理环境...')
    
    const canvas = wx.createOffscreenCanvas({
      type: '2d',
      width: width,
      height: height
    })
    const ctx = canvas.getContext('2d')

    // Step 2: 加载图片到Canvas
    progressCallback && progressCallback(25, '加载图片数据...')
    
    const image = canvas.createImage()
    
    return new Promise((resolve, reject) => {
      image.onload = () => {
        ctx.drawImage(image, 0, 0, width, height)
        
        // Step 3: 获取图像数据
        progressCallback && progressCallback(40, '分析图像质量...')
        const imageData = ctx.getImageData(0, 0, width, height)
        
        // Step 4: 应用处理算法
        this.applyImageEnhancement(imageData, mode, progressCallback)
          .then((processedImageData) => {
            // Step 5: 将处理后的数据写回Canvas
            progressCallback && progressCallback(85, '生成优化图片...')
            ctx.putImageData(processedImageData, 0, 0)
            
            // Step 6: 导出处理后的图片
            progressCallback && progressCallback(95, '保存处理结果...')
            wx.canvasToTempFilePath({
              canvas: canvas,
              success: (res) => {
                progressCallback && progressCallback(100, '处理完成！')
                resolve(res.tempFilePath)
              },
              fail: reject
            })
          })
          .catch(reject)
      }
      
      image.onerror = reject
      image.src = path
    })
  }

  /**
   * 应用图像增强算法
   */
  async applyImageEnhancement(imageData, mode, progressCallback) {
    return new Promise((resolve) => {
      const data = imageData.data
      const width = imageData.width
      const height = imageData.height

      // 构建掩膜：文字/边缘/邻域，用于保护文字与边缘细节
      progressCallback && progressCallback(45, '识别文字与边缘...')
      const masks = this.buildMasks(data, width, height)

      // 去噪仅作用于背景（非文字邻域），避免字体变形
      progressCallback && progressCallback(60, '背景去噪...')
      this.removeNoiseBackgroundOnly(data, width, height, masks)

      // 背景净化为白色（根据模式选择不同阈值），避开文字与边缘掩膜，并去除“透背”淡灰低饱和文本
      const threshold = this.getWhitenThreshold(mode)
      progressCallback && progressCallback(75, `白底净化（阈值${threshold}）...`)
      this.makeBackgroundWhiteWithMasks(data, width, height, threshold, masks)

      // 保留原图细节，不做锐化/强对比
      progressCallback && progressCallback(88, '生成优化图片...')
      resolve(imageData)
    })
  }

  /**
   * 去噪算法 - 中值滤波
   */
  removeNoise(data, width, height) {
    const temp = new Uint8ClampedArray(data)
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        for (let c = 0; c < 3; c++) { // RGB通道
          const neighbors = []
          
          // 获取3x3邻域的像素值
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const idx = ((y + dy) * width + (x + dx)) * 4 + c
              neighbors.push(temp[idx])
            }
          }
          
          // 计算中值
          neighbors.sort((a, b) => a - b)
          const median = neighbors[4] // 9个值的中值
          
          const idx = (y * width + x) * 4 + c
          data[idx] = median
        }
      }
    }
  }

  /**
   * 背景净化为白色（将高亮背景区域填充为白色，保留文字）
   * 简单阈值法：偏亮颜色（接近白色）直接设为 255
   */
  makeBackgroundWhite(data, width, height, threshold = 220) {
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b
      if (luminance >= threshold) {
        data[i] = 255
        data[i + 1] = 255
        data[i + 2] = 255
      }
    }
  }

  /**
   * 计算像素饱和度（简单HSV近似）
   */
  getSaturation(r, g, b) {
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    return max === 0 ? 0 : (max - min) / max
  }

  /**
   * 构建掩膜：
   * - edgeMask: 边缘区域（Sobel梯度高），保护边缘
   * - textMask: 暗文本区域（亮度低且饱和度适中），保护文字
   * - textNeighborhood: 文本邻域（对 textMask 进行一次膨胀），更好保护字形
   */
  buildMasks(data, width, height) {
    const temp = new Uint8ClampedArray(data)
    const edge = new Uint8Array(width * height)
    const text = new Uint8Array(width * height)
    const neigh = new Uint8Array(width * height)

    // Sobel 边缘
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4
        const gx =
          -temp[((y - 1) * width + (x - 1)) * 4] - 2 * temp[((y) * width + (x - 1)) * 4] - temp[((y + 1) * width + (x - 1)) * 4] +
          temp[((y - 1) * width + (x + 1)) * 4] + 2 * temp[((y) * width + (x + 1)) * 4] + temp[((y + 1) * width + (x + 1)) * 4]
        const gy =
          -temp[((y - 1) * width + (x - 1)) * 4] - 2 * temp[((y - 1) * width + (x)) * 4] - temp[((y - 1) * width + (x + 1)) * 4] +
          temp[((y + 1) * width + (x - 1)) * 4] + 2 * temp[((y + 1) * width + (x)) * 4] + temp[((y + 1) * width + (x + 1)) * 4]
        const mag = Math.abs(gx) + Math.abs(gy)
        edge[y * width + x] = mag > 60 ? 1 : 0
      }
    }

    // 文本掩膜：暗色且有一定饱和度/对比，认为是前景文字
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const r = temp[idx], g = temp[idx + 1], b = temp[idx + 2]
        const lum = 0.299 * r + 0.587 * g + 0.114 * b
        const sat = this.getSaturation(r, g, b)
        text[y * width + x] = (lum < 160 && sat > 0.08) ? 1 : 0
      }
    }

    // 邻域膨胀（一次 3x3）
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let hasTextNeighbor = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (text[(y + dy) * width + (x + dx)]) { hasTextNeighbor = 1; break }
          }
          if (hasTextNeighbor) break
        }
        neigh[y * width + x] = hasTextNeighbor
      }
    }

    return { edgeMask: edge, textMask: text, textNeighborhood: neigh }
  }

  /**
   * 背景去噪（仅作用于非文字邻域）
   */
  removeNoiseBackgroundOnly(data, width, height, masks) {
    const temp = new Uint8ClampedArray(data)
    const textNeigh = masks.textNeighborhood
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (textNeigh[y * width + x]) continue
        for (let c = 0; c < 3; c++) {
          const neighbors = []
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const idx = ((y + dy) * width + (x + dx)) * 4 + c
              neighbors.push(temp[idx])
            }
          }
          neighbors.sort((a, b) => a - b)
          const median = neighbors[4]
          const idx = (y * width + x) * 4 + c
          data[idx] = median
        }
      }
    }
  }

  /**
   * 白底净化（带掩膜与“透背”处理）
   * 规则：
   * - 亮度 >= threshold 且非文字邻域 => 设为白色
   * - “透背”：亮度在 [threshold-20, threshold] 且饱和度很低（<0.06），且不在文字邻域 => 设为白色
   * - 边缘/文字邻域 => 保留
   */
  makeBackgroundWhiteWithMasks(data, width, height, threshold, masks) {
    const textNeigh = masks.textNeighborhood
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const r = data[i], g = data[i + 1], b = data[i + 2]
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      const sat = this.getSaturation(r, g, b)
      const nearText = textNeigh[p] === 1

      const isBright = lum >= threshold
      const isBleed = (lum >= threshold - 20 && lum < threshold) && sat < 0.06

      if (!nearText && (isBright || isBleed)) {
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255
      }
    }
  }

  /**
   * 对比度增强
   */
  enhanceContrast(data, intensity) {
    const factor = (259 * (intensity * 255 + 255)) / (255 * (259 - intensity * 255))
    
    for (let i = 0; i < data.length; i += 4) {
      // 处理RGB通道
      for (let c = 0; c < 3; c++) {
        let value = data[i + c]
        value = factor * (value - 128) + 128
        data[i + c] = Math.max(0, Math.min(255, value))
      }
    }
  }

  /**
   * 锐化滤镜
   */
  applySharpen(data, width, height, intensity) {
    const sharpenKernel = [
      0, -intensity, 0,
      -intensity, 1 + 4 * intensity, -intensity,
      0, -intensity, 0
    ]
    
    const temp = new Uint8ClampedArray(data)
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0
          
          for (let ky = 0; ky < 3; ky++) {
            for (let kx = 0; kx < 3; kx++) {
              const idx = ((y + ky - 1) * width + (x + kx - 1)) * 4 + c
              sum += temp[idx] * sharpenKernel[ky * 3 + kx]
            }
          }
          
          const idx = (y * width + x) * 4 + c
          data[idx] = Math.max(0, Math.min(255, sum))
        }
      }
    }
  }

  /**
   * 批量处理图片
   */
  async batchProcess(imagePaths, mode = 'auto', progressCallback) {
    const results = []
    const total = imagePaths.length
    
    for (let i = 0; i < imagePaths.length; i++) {
      const imagePath = imagePaths[i]
      
      try {
        const processedPath = await this.processImage(
          imagePath, 
          mode, 
          (progress, text) => {
            const overallProgress = Math.round(((i + progress / 100) / total) * 100)
            progressCallback && progressCallback(overallProgress, `处理第${i + 1}张图片: ${text}`)
          }
        )
        
        results.push({
          original: imagePath,
          processed: processedPath,
          success: true
        })
      } catch (error) {
        results.push({
          original: imagePath,
          processed: null,
          success: false,
          error: error
        })
      }
    }
    
    return results
  }

  /**
   * 图片质量评估
   */
  assessImageQuality(imagePath) {
    return new Promise((resolve, reject) => {
      wx.getImageInfo({
        src: imagePath,
        success: (imageInfo) => {
          // 简单的质量评估逻辑
          const { width, height } = imageInfo
          const resolution = width * height
          
          let quality = 'good'
          if (resolution < 500000) { // 小于50万像素
            quality = 'low'
          } else if (resolution > 2000000) { // 大于200万像素
            quality = 'high'
          }
          
          resolve({
            width,
            height,
            resolution,
            quality,
            recommendations: this.getQualityRecommendations(quality)
          })
        },
        fail: reject
      })
    })
  }

  /**
   * 获取质量改进建议
   */
  getQualityRecommendations(quality) {
    const recommendations = {
      'low': [
        '建议重新拍摄更高分辨率的照片',
        '确保拍摄时光线充足',
        '保持手机稳定，避免模糊'
      ],
      'good': [
        '照片质量良好，可以直接处理',
        '建议选择智能优化模式'
      ],
      'high': [
        '照片质量很好，建议使用深度增强模式',
        '可以获得最佳的优化效果'
      ]
    }
    
    return recommendations[quality] || recommendations['good']
  }

  /**
   * 根据模式选择白底阈值
   * whiten-soft: 210（保留更多灰度细节）
   * whiten/auto: 220（标准）
   * whiten-强效/enhance: 235（更白的背景）
   */
  getWhitenThreshold(mode) {
    const m = String(mode || 'whiten').toLowerCase()
    if (m === 'whiten-soft') return 210
    if (m === 'whiten-strong' || m === 'enhance') return 235
    return 220
  }
}




module.exports = ImageProcessor