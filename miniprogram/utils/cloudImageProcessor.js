/**
 * 云开发图像处理工具类
 * 使用微信小程序云开发进行真实的图像处理
 */

class CloudImageProcessor {
  constructor() {
    this.isCloudReady = false
    this.init()
  }

  /**
   * 批量上传并拼接为A4多页
   * @param {Array<string>} imagePaths - 本地图片路径数组或已是fileID的数组
   * @param {function} [progressCallback] - 进度回调函数
   * @returns {Promise<{success:boolean, pages:Array, pageCount:number, processTime:number}>}
   */
  async processImagesMulti(imagePaths, progressCallback) {
    if (!this.isCloudReady) throw new Error('云开发未初始化')

    // 过滤空值
    const inputs = (imagePaths || []).filter(Boolean)
    if (inputs.length === 0) throw new Error('请传入至少一张图片')

    try {
      // 上传进度：0-40%
      const fileIDs = []
      for (let i = 0; i < inputs.length; i++) {
        const p = Math.min(40, Math.round(((i + 1) / inputs.length) * 40))
        typeof progressCallback === 'function' && progressCallback(p, `上传第${i + 1}张图片...`)
        let fid = inputs[i]
        if (fid.startsWith('http://tmp/') || fid.startsWith('wxfile://')) {
          fid = await this.uploadImage(fid, `merge_${Date.now()}_${i}.jpg`)
        }
        fileIDs.push(fid)
      }

      // 云端处理：40-90%
      typeof progressCallback === 'function' && progressCallback(50, '云端拼接处理中...')
      const result = await wx.cloud.callFunction({
        name: 'imageProcess',
        data: {
          // 兼容多键名，确保云端无论使用哪个字段都能收到
          imageUrls: fileIDs,
          imageUrl: fileIDs[0],
          images: fileIDs,
          files: fileIDs,
          list: fileIDs
        }
      })

      // 整理结果：90-100%
      typeof progressCallback === 'function' && progressCallback(95, '生成页面结果...')

      if (result.result?.success) {
        const data = result.result.data
        // 为每页获取临时链接
        const fileList = data.pages.map(p => p.fileID)
        const tempRes = await wx.cloud.getTempFileURL({ fileList })
        const pagesWithUrl = data.pages.map((p, idx) => ({
          ...p,
          tempFileURL: tempRes.fileList?.[idx]?.tempFileURL || null
        }))

        typeof progressCallback === 'function' && progressCallback(100, '拼接完成！')

        return {
          success: true,
          pages: pagesWithUrl,
          pageCount: data.pageCount,
          processTime: data.processTime
        }
      } else {
        throw new Error(result.result?.error || '云端拼接失败')
      }
    } catch (e) {
      console.error('批量拼接失败:', e)
      throw new Error('图片拼接失败，请重试')
    }
  }

  /**
   * 初始化云开发
   */
  init() {
    try {
      if (wx.cloud) {
        this.isCloudReady = true
        console.log('云开发已初始化')
      } else {
        console.error('云开发不可用，请检查基础库版本')
      }
    } catch (error) {
      console.error('云开发初始化失败:', error)
    }
  }

  /**
   * 上传图片到云存储
   * @param {string} filePath - 本地图片路径
   * @param {string} fileName - 文件名
   * @returns {Promise<string>} 云存储文件ID
   */
  async uploadImage(filePath, fileName) {
    if (!this.isCloudReady) {
      throw new Error('云开发未初始化')
    }

    try {
      const timestamp = Date.now()
      const cloudPath = `original/${timestamp}_${fileName}`
      
      const uploadResult = await wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: filePath
      })

      console.log('图片上传成功:', uploadResult.fileID)
      return uploadResult.fileID
      
    } catch (error) {
      console.error('图片上传失败:', error)
      throw new Error(`图片上传失败: ${error.message}`)
    }
  }

  /**
   * 将图片处理成扫描件样式
   * @param {string} imageUrl - 本地图片路径或云存储fileID
   * @param {function} [progressCallback] - 进度回调函数
   * @returns {Promise<Object>} 处理结果
   */
  async processImage(imageUrl, progressCallback, maybeThirdArg) {
    // 兼容旧调用签名：processImage(imagePath, 'auto', progressCallback)
    // 如果第二参不是函数且第三参是函数，则使用第三参作为回调；否则如果第二参是非函数则置为 undefined
    if (typeof progressCallback !== 'function') {
      progressCallback = (typeof maybeThirdArg === 'function') ? maybeThirdArg : undefined
    }

    if (!this.isCloudReady) {
      throw new Error('云开发未初始化');
    }

    try {
      // 1. 如果是本地文件，先上传到云存储
      let fileID = imageUrl;
      if (imageUrl.startsWith('http://tmp/') || imageUrl.startsWith('wxfile://')) {
        typeof progressCallback === 'function' && progressCallback(10, '上传图片到云端...');
        fileID = await this.uploadImage(imageUrl, 'temp_image.jpg');
      }

      typeof progressCallback === 'function' && progressCallback(30, '开始云端处理...');

      // 2. 直接调用 'imageProcess' 云函数
      const result = await wx.cloud.callFunction({
        name: 'imageProcess',
        data: {
          imageUrl: fileID,
        }
      });

      typeof progressCallback === 'function' && progressCallback(80, '生成优化结果...');

      // 3. 检查云函数返回结果
      if (result.result?.success) {
        const data = result.result.data;
        // 获取处理后图片的临时URL以便显示
        const tempURL = await this.getTempFileURL(data.processedFileID || data.processed || data.fileID);
        
        typeof progressCallback === 'function' && progressCallback(100, '处理完成！');

        return {
          success: true,
          processed: data.processedFileID,
          processedUrl: tempURL,
          metadata: data.metadata,
          processTime: data.processTime,
          originalSize: data.originalSize,
          processedSize: data.processedSize
        };
      } else {
        // 如果云函数内部出错，则抛出错误
        throw new Error(result.result?.error || '云端处理失败');
      }
      
    } catch (error) {
      console.error('云端图片处理失败:', error);
      
      // 抛出更友好的错误信息
      let errorMsg = '图片处理失败，请重试';
      if (error.message.includes('超时') || error.message.includes('TIMEOUT')) {
        errorMsg = '处理超时，服务器繁忙，请稍后重试';
      } else if (error.message.includes('网络')) {
        errorMsg = '网络连接异常，请检查网络后重试';
      }
      
      throw new Error(errorMsg);
    }
  }

  /**
   * 批量处理图片
   * @param {Array} imagePaths - 图片路径数组
   * @param {string} mode - 处理模式
   * @param {function} progressCallback - 进度回调
   * @returns {Promise<Array>} 处理结果数组
   */
  async batchProcessImages(imagePaths, mode = 'auto', progressCallback) {
    if (!this.isCloudReady) {
      throw new Error('云开发未初始化')
    }

    try {
      typeof progressCallback === 'function' && progressCallback(5, '准备批量处理...')

      // 先批量上传图片
      const fileIDs = []
      for (let i = 0; i < imagePaths.length; i++) {
        const progress = Math.round(((i + 1) / imagePaths.length) * 30) + 5
        typeof progressCallback === 'function' && progressCallback(progress, `上传第${i + 1}张图片...`)
        
        const fileID = await this.uploadImage(imagePaths[i], `batch_${i}.jpg`)
        fileIDs.push(fileID)
      }

      typeof progressCallback === 'function' && progressCallback(40, '开始批量处理...')

      // 调用批量处理云函数
      const result = await wx.cloud.callFunction({
        name: 'batchImageProcess',
        data: {
          imageUrls: fileIDs,
          mode: mode
        }
      })

      typeof progressCallback === 'function' && progressCallback(95, '整理处理结果...')

      if (result.result.success) {
        const results = result.result.data.results.map((item, index) => {
          if (item.success && item.data.success) {
            return {
              success: true,
              original: imagePaths[index],
              processed: item.data.data.processedFileID,
              metadata: item.data.data.metadata,
              index: index
            }
          } else {
            return {
              success: false,
              original: imagePaths[index],
              error: item.error || item.data.error,
              index: index
            }
          }
        })

        typeof progressCallback === 'function' && progressCallback(100, '批量处理完成！')
        return results
      } else {
        throw new Error(result.result.error || '批量处理失败')
      }
      
    } catch (error) {
      console.error('批量处理失败:', error)
      throw new Error(`批量处理失败: ${error.message}`)
    }
  }

  /**
   * 获取云存储文件的临时链接
   * @param {string} fileID - 云存储文件ID
   * @returns {Promise<string>} 临时访问链接
   */
  async getTempFileURL(input) {
    if (!this.isCloudReady) {
      throw new Error('云开发未初始化')
    }

    try {
      let fileList = []
      if (Array.isArray(input)) {
        fileList = input
          .map(it => typeof it === 'string' ? it : (it && (it.fileID || it.processed || it.processedFileID)))
          .filter(v => typeof v === 'string' && v.length > 0)
      } else if (typeof input === 'string') {
        fileList = [input]
      } else if (input && typeof input === 'object') {
        const fid = input.fileID || input.processed || input.processedFileID
        if (typeof fid === 'string' && fid.length > 0) fileList = [fid]
      }

      if (!fileList.length) {
        throw new Error('无有效 fileID')
      }
      // 二次严格过滤，确保仅传递非空字符串
      fileList = fileList.filter(v => typeof v === 'string' && v.length > 0)

      const result = await wx.cloud.getTempFileURL({ fileList })

      if (fileList.length === 1) {
        const one = result.fileList && result.fileList[0]
        if (one && one.tempFileURL) return one.tempFileURL
        throw new Error('获取临时链接失败')
      }

      // 多文件返回对应的 URL 列表
      return (result.fileList || []).map(i => i?.tempFileURL || null)
    } catch (error) {
      console.error('获取临时链接失败:', error)
      throw new Error(`获取临时链接失败: ${error.message}`)
    }
  }

  /**
   * 删除云存储文件
   * @param {Array} fileIDs - 文件ID数组
   */
  async deleteFiles(fileIDs) {
    if (!this.isCloudReady) {
      return
    }

    try {
      await wx.cloud.deleteFile({
        fileList: fileIDs
      })
      console.log('云存储文件删除成功')
    } catch (error) {
      console.error('删除云存储文件失败:', error)
    }
  }

  /**
   * 检查网络状态
   */
  async checkNetworkStatus() {
    return new Promise((resolve) => {
      wx.getNetworkType({
        success: (res) => {
          resolve({
            networkType: res.networkType,
            isConnected: res.networkType !== 'none',
            isWifi: res.networkType === 'wifi'
          })
        },
        fail: () => {
          resolve({
            networkType: 'unknown',
            isConnected: false,
            isWifi: false
          })
        }
      })
    })
  }

  /**
   * 图片质量预评估
   * @param {string} imagePath - 图片路径
   * @returns {Promise<Object>} 质量评估结果
   */
  async assessImageQuality(imagePath) {
    return new Promise((resolve, reject) => {
      wx.getImageInfo({
        src: imagePath,
        success: (imageInfo) => {
          const { width, height, path } = imageInfo
          const resolution = width * height
          const aspectRatio = width / height
          
          // 简单的质量评估逻辑
          let quality = 'good'
          let recommendations = []
          
          if (resolution < 500000) {
            quality = 'low'
            recommendations.push('图片分辨率较低，建议重新拍摄')
          } else if (resolution > 4000000) {
            quality = 'high'
            recommendations.push('图片质量很好，建议使用深度增强模式')
          }
          
          if (aspectRatio < 0.5 || aspectRatio > 2) {
            recommendations.push('图片比例特殊，处理时间可能较长')
          }
          
          resolve({
            width,
            height,
            resolution,
            aspectRatio,
            quality,
            recommendations,
            estimatedProcessTime: this.estimateProcessTime(resolution)
          })
        },
        fail: reject
      })
    })
  }

  /**
   * 估算处理时间
   * @param {number} resolution - 图片分辨率
   * @returns {number} 估算时间（秒）
   */
  estimateProcessTime(resolution) {
    // 基于分辨率估算处理时间
    if (resolution < 1000000) return 10
    if (resolution < 3000000) return 20
    if (resolution < 6000000) return 30
    return 45
  }
}

module.exports = CloudImageProcessor