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
    estimatedTime: 0,
    rotationDeg: 0,
    hasSelected: false
  },

  onLoad() {
    // 初始化云图像处理器
    this.cloudProcessor = new CloudImageProcessor()
    
    // 获取传递的图片数据（优先：上一页selectedImages；兼容：事件通道；本页images）
    const pages = getCurrentPages()
    const prevPage = pages[pages.length - 2]
    let incoming = null

    if (prevPage && prevPage.data && Array.isArray(prevPage.data.selectedImages) && prevPage.data.selectedImages.length > 0) {
      incoming = prevPage.data.selectedImages
    }

    // 兼容事件通道传参
    const ec = this.getOpenerEventChannel ? this.getOpenerEventChannel() : null
    if (!incoming && ec) {
      ec.on && ec.on('images', (imgs) => {
        if (Array.isArray(imgs) && imgs.length > 0) {
          const app = getApp()
          app.clearProcessedImages()
          const isMulti = imgs.length > 1
          this.setData({
            images: imgs,
            currentImage: isMulti ? null : imgs[0],
            hasMoreImages: isMulti,
            hasSelected: !isMulti,
            statusText: isMulti ? '请选择图片' : '准备优化'
          })
          if (!isMulti) {
            this.updateImageInfo()
            this.checkNetworkAndEstimate()
          }
        }
      })
    }

    // 回退：若本页已存在 images（例如通过 navigateTo 后 setData 注入）
    if (!incoming && Array.isArray(this.data.images) && this.data.images.length > 0) {
      incoming = this.data.images
    }

    if (incoming && incoming.length > 0) {
      const app = getApp();
      app.clearProcessedImages();
      const isMulti = incoming.length > 1
      this.setData({
        images: incoming,
        currentImage: isMulti ? null : incoming[0],
        hasMoreImages: isMulti,
        hasSelected: !isMulti,
        statusText: isMulti ? '请选择图片' : '准备优化'
      })
      if (!isMulti) {
        this.updateImageInfo()
        this.checkNetworkAndEstimate()
      }
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
    if (this.data.isProcessing) return; // 防止重复点击

    // 若当前未设置图片，提示先选择
    if (!this.data.currentImage && Array.isArray(this.data.images) && this.data.images.length > 0) {
      showError('请先在上方选择一张图片');
      return;
    }

    if (!this.data.currentImage) {
      showError('请先选择图片');
      return;
    }

    // 检查网络连接
    if (this.data.networkStatus && !this.data.networkStatus.isConnected) {
      wx.showModal({
        title: '无网络连接',
        content: '图片处理需要网络连接，请检查网络后重试',
        showCancel: false
      });
      return;
    }

    this.setData({
      isProcessing: true,
      progress: 0,
      statusText: '正在处理',
      processingText: '连接云端处理服务...'
    });

    const app = getApp();
    try {
      const imgs = this.data.images || [];

      // 批量处理逻辑
      if (imgs.length > 1) {
        app.globalData.isBatchProcessing = true;
        this.__batchMode = true;
        const total = imgs.length;
        for (let i = 0; i < total; i++) {
          const img = imgs[i];
          this.setData({
            processingText: `正在处理第 ${i + 1}/${total} 张...`,
            currentIndex: i,
            currentImage: img // 更新当前处理的图片
          });
          await this.processSingleImage(img.path, (p, text) => {
            const overall = Math.round(((i + p / 100) / total) * 100);
            this.setData({
              progress: overall,
              processingText: `第 ${i + 1}/${total} 张：${text || ''}`
            });
          });
        }
        this.setData({
          isProcessing: false,
          statusText: '批量处理完成',
          progress: 100,
          hasMoreImages: false
        });
        this.__batchMode = false;
        app.globalData.isBatchProcessing = false;
        showSuccess(`共处理 ${imgs.length} 张`);
        wx.navigateTo({ url: '/pages/result/result' });
        return;
      }

      // 单张处理逻辑
      await this.processSingleImage(this.data.currentImage.path, (progress, text) => {
        this.setData({
          progress: Math.round(progress),
          processingText: text
        });
      });

    } catch (error) {
      console.error('图片处理失败:', error)
      if (app && app.globalData) app.globalData.isBatchProcessing = false;
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
    const app = getApp();
    app.clearProcessedImages();
    this.setData({
      processedImage: null,
      processedFileID: null,
      progress: 0,
      statusText: '准备优化'
    });
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
        hasSelected: true,
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

  // 查看结果（跳转结果页）—处理中或批量锁定时禁止跳转
  viewResult() {
    const app = getApp()
    if (this.data.isProcessing || (app && app.globalData && app.globalData.isBatchProcessing)) {
      showError('正在处理，请稍候完成后再查看结果')
      return
    }
    if (!this.data.processedImage) {
      showError('请先完成图片处理')
      return
    }
    wx.navigateTo({ url: '/pages/result/result' })
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

  // 手动左/右旋原图（仅记录角度并透传到云端，不做自动旋转）
  rotateLeft() {
    const deg = (this.data.rotationDeg - 90 + 360) % 360
    this.setData({ rotationDeg: deg })
  },
  rotateRight() {
    const deg = (this.data.rotationDeg + 90) % 360
    this.setData({ rotationDeg: deg })
  },

  // 处理后图片加载完成（不做自动旋转，保持用户手动控制）
  onProcessedImageLoad(e) {
    console.log('处理后图片加载完成', e.detail)
  },

  // 单张图片处理的核心逻辑
  async processSingleImage(imagePath, progressCallback) {
    const app = getApp();
    try {
      const result = await this.cloudProcessor.processImage(
        imagePath,
        { rotate: this.data.rotationDeg }, // 透传手动旋转角度到云端
        progressCallback
      );

      if (!result.success) {
        throw new Error('处理失败');
      }

      const tempURL = result.processedUrl || await this.cloudProcessor.getTempFileURL(result.processed);
      if (!tempURL) {
        throw new Error('云端未返回有效的图片数据');
      }

      // 使用 wx.getImageInfo 获取 base64 图片信息
      return new Promise((resolve, reject) => {
        wx.getImageInfo({
          src: tempURL,
          success: (res) => {
            const processedSizeKB = Math.round((result.processedSize || 0) / 1024);
            const batchMode = !!this.__batchMode;
            this.setData({
              processedImage: tempURL,
              processedFileID: result.processed,
              isProcessing: batchMode ? true : false,
              statusText: batchMode ? '正在处理' : '优化完成',
              processedSize: `${res.width}×${res.height} ${processedSizeKB}KB`,
              progress: batchMode ? this.data.progress : 100
            });

            app.addProcessedImage({
              original: imagePath,
              processed: tempURL,
              processedFileID: result.processed,
              mode: 'scanned',
              metadata: result.metadata,
              processTime: result.processTime
            });
            if (!this.__batchMode) {
              showSuccess('图片优化完成！');
            }
            resolve();
          },
          fail: (err) => {
            console.error('加载 base64 图片信息失败', err);
            reject(new Error('无法解析云端返回的图片'));
          }
        });
      });
    } catch (error) {
      console.error('图片处理失败:', error);
      this.setData({
        isProcessing: false,
        statusText: '处理失败'
      });
      // 抛出错误，由上层统一处理
      throw error;
    }
  },

  // 将图片旋转到与原图一致的方向（纵向或横向）
  rotateToMatchOriginal(url, targetPortrait) {
    return new Promise((resolve, reject) => {
      wx.getImageInfo({
        src: url,
        success: (info) => {
          const w = info.width, h = info.height
          const needPortrait = !!targetPortrait
          const isPortrait = h >= w
          // 不需要旋转
          if (needPortrait === isPortrait) {
            resolve(url)
            return
          }
          // 需要旋转90度
          const canvas = wx.createOffscreenCanvas({ type: '2d', width: h, height: w })
          const ctx = canvas.getContext('2d')
          const img = canvas.createImage()
          img.onload = () => {
            // 将画布旋转90度并绘制
            ctx.translate(h, 0)
            ctx.rotate(Math.PI / 2)
            ctx.drawImage(img, 0, 0, w, h)
            wx.canvasToTempFilePath({
              canvas,
              success: (res) => resolve(res.tempFilePath),
              fail: reject
            })
          }
          img.onerror = reject
          img.src = url
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