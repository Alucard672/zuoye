/**
 * 处理页：云端处理完成后，前端进行“白底净化”二次处理，不做锐化与强对比
 */
const CloudImageProcessor = require('../../utils/cloudImageProcessor.js')
const ImageProcessor = require('../../utils/imageProcessor.js')
const { showLoading, hideLoading, showSuccess, showError } = require('../../utils/util.js')

Page({
  data: {
    images: [],
    currentIndex: 0,
    currentImage: null,
    processedImage: null,
    processedFileID: null,
    isProcessing: false,
    progress: 0,
    statusText: '准备处理',
    processingText: '正在分析图片...',
    originalSize: '',
    processedSize: '',
    hasMoreImages: false,
    networkStatus: null,
    estimatedTime: 0
  },

  onLoad() {
    // 初始化云图像处理器
    this.cloudProcessor = new CloudImageProcessor()
    
    // 获取传递的图片数据
    const pages = getCurrentPages()
    const prevPage = pages[pages.length - 2]
    if (prevPage && prevPage.data.selectedImages) {
      this.setData({
        images: prevPage.data.selectedImages,
        currentImage: prevPage.data.selectedImages[0],
        hasMoreImages: prevPage.data.selectedImages.length > 1,
        statusText: '准备优化'
      })
      this.updateImageInfo()
      this.checkNetworkAndEstimate()
    }
  },

  // 检查网络状态并估算处理时间
  async checkNetworkAndEstimate() {
    try {
      const networkStatus = await this.cloudProcessor.checkNetworkStatus()
      this.setData({ networkStatus })

      if (!networkStatus.isConnected) {
        wx.showModal({
          title: '网络连接异常',
          content: '图片处理需要网络连接，请检查网络后重试',
          showCancel: false
        })
        return
      }

      // 评估当前图片质量和处理时间
      if (this.data.currentImage) {
        const assessment = await this.cloudProcessor.assessImageQuality(this.data.currentImage.path)
        this.setData({
          estimatedTime: assessment.estimatedProcessTime
        })

        // 显示质量建议
        if (assessment.recommendations.length > 0) {
          console.log('图片质量建议:', assessment.recommendations)
        }
      }
    } catch (error) {
      console.error('网络检查失败:', error)
    }
  },

  // 更新图片信息
  updateImageInfo() {
    const { currentImage } = this.data
    if (currentImage) {
      wx.getImageInfo({
        src: currentImage.path,
        success: (res) => {
          const sizeKB = Math.round((currentImage.size || 0) / 1024)
          this.setData({
            originalSize: `${res.width}×${res.height} ${sizeKB}KB`
          })
        }
      })
    }
  },

  // 开始处理
  async startProcess() {
    if (!this.data.currentImage) {
      showError('请先选择图片')
      return
    }

    // 检查网络连接
    if (this.data.networkStatus && !this.data.networkStatus.isConnected) {
      wx.showModal({
        title: '无网络连接',
        content: '图片处理需要网络连接，请检查网络后重试',
        showCancel: false
      })
      return
    }

    this.setData({
      isProcessing: true,
      progress: 0,
      statusText: '正在处理',
      processingText: '连接云端处理服务...'
    })

    try {
      // 根据选择数量决定：单张优化 或 多张拼接为A4
      let result
      const imgs = this.data.images || []
      if (imgs.length > 1) {
        // 批量模式：逐张处理，显示总进度与当前序号
        const app = getApp()
        const total = imgs.length
        const processedList = []
        for (let i = 0; i < total; i++) {
          const img = imgs[i]
          this.setData({
            processingText: `正在处理第 ${i + 1}/${total} 张...`,
            currentIndex: i
          })
          const single = await this.cloudProcessor.processImage(
            img.path,
            (p, text) => {
              const overall = Math.round(((i + p / 100) / total) * 100)
              this.setData({
                progress: overall,
                processingText: `第 ${i + 1}/${total} 张：${text || ''}`
              })
            }
          )
          // 写入全局与本地列表
          const tempURL = await this.cloudProcessor.getTempFileURL(single.processed)
          processedList.push({
            original: img.path,
            processed: tempURL,
            processedFileID: single.processed,
            mode: 'scanned',
            metadata: single.metadata,
            processTime: single.processTime
          })
          app.addProcessedImage(processedList[processedList.length - 1])
        }
        // 批量完成后，显示最后一张为“优化后”，并跳转结果页
        const last = processedList[processedList.length - 1]
        wx.getImageInfo({
          src: last.processed,
          success: (res) => {
            this.setData({
              processedImage: last.processed,
              processedFileID: last.processedFileID,
              isProcessing: false,
              statusText: '批量处理完成',
              processedSize: `${res.width}×${res.height}`,
              progress: 100,
              hasMoreImages: false
            })
            showSuccess(`共处理 ${processedList.length} 张`)
          }
        })
        // 直接进入结果页（用户手动选择拼接）
        wx.navigateTo({ url: '/pages/result/result' })
        return
      } else {
        result = await this.cloudProcessor.processImage(
          this.data.currentImage.path,
          (progress, text) => {
            this.setData({
              progress: Math.round(progress),
              processingText: text
            })
          }
        )
      }

      if (!result.success) {
        throw new Error('处理失败')
      }

      // 分支：多页拼接或单张
      const app = getApp()

      if (result.pages && result.pageCount) {
        // 多页拼接结果
        const firstPage = result.pages[0]
        const tempURL = firstPage.tempFileURL

        wx.getImageInfo({
          src: tempURL,
          success: (res) => {
            this.setData({
              processedImage: tempURL,
              processedFileID: firstPage.fileID,
              isProcessing: false,
              statusText: `拼接完成（${result.pageCount}页）`,
              processedSize: `${res.width}×${res.height}`,
              progress: 100
            })

            // 保存每一页处理结果
            result.pages.forEach((p, idx) => {
              app.addProcessedImage({
                original: 'multi',
                processed: p.tempFileURL,
                processedFileID: p.fileID,
                mode: 'merged-a4',
                metadata: { width: p.width, height: p.height, pageIndex: idx + 1 },
                processTime: result.processTime
              })
            })

            showSuccess(`拼接完成，共 ${result.pageCount} 页！`)
          }
        })
      } else {
        // 单张优化结果（兼容旧逻辑）
        const tempURL = await this.cloudProcessor.getTempFileURL(result.processed)
        // 二次本地处理：仅进行“背景净化为白”，不锐化、不强对比
        const localProcessor = new ImageProcessor()
        // 进度提示（可选）
        typeof this.setData === 'function' && this.setData({ processingText: '正在进行白底净化...' })
        try {
          // 仅生成标准版白底图（单张结果）
          const stdPath = await localProcessor.processImage(tempURL, 'whiten', (p) => {
            typeof this.setData === 'function' && this.setData({ progress: Math.min(95, Math.max(0, Math.round(p))) })
          })
          
          // 若为横图则旋转为竖向
          const rotatedPath = await this.rotateIfLandscape(stdPath)

          wx.getImageInfo({
            src: rotatedPath,
            success: (res) => {
              const processedSizeKB = Math.round((result.processedSize || 0) / 1024)
              this.setData({
                processedImage: rotatedPath,
                processedFileID: result.processed,
                isProcessing: false,
                statusText: '优化完成',
                processedSize: `${res.width}×${res.height} ${processedSizeKB}KB`,
                progress: 100
              })
              // 只注入一张结果到全局
              app.addProcessedImage({
                original: this.data.currentImage.path,
                processed: rotatedPath,
                processedFileID: result.processed,
                mode: 'whiten',
                metadata: result.metadata,
                processTime: result.processTime
              })
              showSuccess('图片优化完成')
            }
          })
        } catch (e) {
          // 若本地二次处理失败，回退使用云端 tempURL
          wx.getImageInfo({
            src: tempURL,
            success: (res) => {
              const processedSizeKB = Math.round((result.processedSize || 0) / 1024)
              this.setData({
                processedImage: tempURL,
                processedFileID: result.processed,
                isProcessing: false,
                statusText: '优化完成',
                processedSize: `${res.width}×${res.height} ${processedSizeKB}KB`,
                progress: 100
              })
              app.addProcessedImage({
                original: this.data.currentImage.path,
                processed: tempURL,
                processedFileID: result.processed,
                mode: 'scanned',
                metadata: result.metadata,
                processTime: result.processTime
              })
              showSuccess('图片优化完成！')
            }
          })
        }
      }

    } catch (error) {
      console.error('图片处理失败:', error)
      this.setData({
        isProcessing: false,
        statusText: '处理失败'
      })

      let errorMsg = '图片处理失败，请重试'
      if (error.message.includes('网络')) {
        errorMsg = '网络连接异常，请检查网络后重试'
      } else if (error.message.includes('超时')) {
        errorMsg = '处理超时，请稍后重试'
      } else if (error.message.includes('格式')) {
        errorMsg = '图片格式不支持，请选择JPG或PNG格式'
      }

      wx.showModal({
        title: '处理失败',
        content: errorMsg,
        confirmText: '重试',
        cancelText: '返回',
        success: (res) => {
          if (res.confirm) {
            this.startProcess()
          } else {
            this.goBack()
          }
        }
      })
    }
  },

  // 重新处理
  reprocess() {
    this.setData({
      processedImage: null,
      processedFileID: null,
      progress: 0,
      statusText: '准备优化'
    })
  },

  // 处理下一张
  processNext() {
    const { images, currentIndex } = this.data
    if (currentIndex + 1 < images.length) {
      this.setData({
        currentIndex: currentIndex + 1,
        currentImage: images[currentIndex + 1],
        processedImage: null,
        processedFileID: null,
        progress: 0,
        statusText: '准备优化',
        hasMoreImages: currentIndex + 2 < images.length
      })
      this.updateImageInfo()
      this.checkNetworkAndEstimate()
    }
  },

  // 缩略图点击切换当前预览
  onThumbTap(e) {
    const idx = e.currentTarget.dataset.index
    const { images } = this.data
    if (typeof idx === 'number' && images && images[idx]) {
      this.setData({
        currentIndex: idx,
        currentImage: images[idx],
        processedImage: null,
        processedFileID: null,
        progress: 0,
        statusText: '准备优化',
        hasMoreImages: idx + 1 < images.length
      })
      this.updateImageInfo()
      this.checkNetworkAndEstimate()
    }
  },

  // 查看结果（跳转结果页）
  viewResult() {
    if (!this.data.processedImage) {
      showError('请先完成图片处理')
      return
    }

    wx.navigateTo({
      url: '/pages/result/result'
    })
  },

  // 点击放大预览优化后图片
  previewProcessed() {
    const { processedImage } = this.data
    if (!processedImage) {
      showError('暂无可预览的图片')
      return
    }
    wx.previewImage({
      current: processedImage,
      urls: [processedImage]
    })
  },

  // 返回上一页
  goBack() {
    wx.navigateBack()
  },

  // 原图加载完成
  onOriginalImageLoad(e) {
    console.log('原图加载完成', e.detail)
  },

  // 处理后图片加载完成
  onProcessedImageLoad(e) {
    console.log('处理后图片加载完成', e.detail)
  },

  // 如为横图则旋转为竖向
  async rotateIfLandscape(path) {
    return new Promise((resolve, reject) => {
      wx.getImageInfo({
        src: path,
        success: (info) => {
          if (info.width <= info.height) return resolve(path)
          const canvas = wx.createOffscreenCanvas({ type: '2d', width: info.height, height: info.width })
          const ctx = canvas.getContext('2d')
          const img = canvas.createImage()
          img.onload = () => {
            ctx.translate(info.height, 0)
            ctx.rotate(Math.PI / 2)
            ctx.drawImage(img, 0, 0, info.width, info.height)
            wx.canvasToTempFilePath({
              canvas,
              success: (res) => resolve(res.tempFilePath),
              fail: reject
            })
          }
          img.onerror = reject
          img.src = path
        },
        fail: reject
      })
    })
  },

  // 页面卸载时清理资源
  onUnload() {
    // 如果有临时文件，可以考虑清理（可选）
    // 云存储文件会自动管理，无需手动删除
  },

  // 分享功能
  onShareAppMessage() {
    const img = '/images/share-logo.png'
    console.log('share(process): imageUrl =', img)
    return {
      title: '作业清晰 - 智能优化作业照片',
      path: '/pages/index/index',
      imageUrl: img
    }
  },

  onShareTimeline() {
    const img = '/images/share-logo.png'
    console.log('share(process.timeline): imageUrl =', img)
    return {
      title: '作业清晰 - 智能优化作业照片',
      imageUrl: img
    }
  }
})