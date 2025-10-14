// pages/index/index.js
Page({
  data: {
    showGuide: false,
    selectedImages: [],
    processingLock: false,
    version: ''
  },

  onLoad() {
    // 检查是否是首次使用
    const isFirstTime = wx.getStorageSync('isFirstTime')
    if (!isFirstTime) {
      this.setData({
        showGuide: true
      })
      wx.setStorageSync('isFirstTime', false)
    }
  },

  onShow() {
    // 同步全局批量处理状态，防止处理中误操作
    const app = getApp()
    const locked = !!(app && app.globalData && app.globalData.isBatchProcessing)
    this.setData({ 
      processingLock: locked,
      version: (app && app.globalData && app.globalData.version) || '1.4.2'
    })
    if (locked) {
      wx.showToast({ title: '正在批量处理，请稍候', icon: 'none' })
    }
  },

  // 删除单张已选图片
  removeSelected(e) {
    const idx = e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.index : -1
    if (idx < 0) return
    const list = (this.data.selectedImages || []).slice()
    const removed = list.splice(idx, 1)[0]
    this.setData({ selectedImages: list })
    // 如需同步删除云端文件，可在 removed.fileID 存在时调用 wx.cloud.deleteFile
    // if (removed && removed.fileID) { wx.cloud.deleteFile({ fileList: [removed.fileID] }) }
  },

  // 清空所有已选
  clearSelected() {
    this.setData({ selectedImages: [] })
  },

  // 从聊天记录选择图片
  chooseFromChat() {
    const app = getApp()
    if (app && app.globalData && app.globalData.isBatchProcessing) {
      wx.showToast({ title: '正在批量处理，请稍候', icon: 'none' })
      return
    }
    wx.chooseMessageFile({
      count: 10,
      type: 'image',
      success: (res) => {
        this.handleSelectedImages(res.tempFiles)
      },
      fail: (err) => {
        console.error('选择聊天记录图片失败:', err)
        wx.showToast({
          title: '选择失败，请重试',
          icon: 'none'
        })
      }
    })
  },

  // 从相册选择图片
  chooseFromAlbum() {
    const app = getApp()
    if (app && app.globalData && app.globalData.isBatchProcessing) {
      wx.showToast({ title: '正在批量处理，请稍候', icon: 'none' })
      return
    }
    wx.chooseImage({
      count: 10,
      sizeType: ['original'],
      sourceType: ['album'],
      success: (res) => {
        // 使用 res.tempFiles 直接获取真实大小与路径
        const tempFiles = (res.tempFiles || []).map((f, index) => ({
          path: f.path || f.tempFilePath || res.tempFilePaths?.[index],
          size: f.size || 0,
          name: f.name || `image_${index + 1}.jpg`
        })).filter(it => !!it.path)
        this.handleSelectedImages(tempFiles)
      },
      fail: (err) => {
        console.error('选择相册图片失败:', err)
        wx.showToast({
          title: '选择失败，请重试',
          icon: 'none'
        })
      }
    })
  },

  // 处理选中的图片（含自动压缩）
  async handleSelectedImages(files) {
    if (!files || files.length === 0) return

    const app = getApp()
    const maxSize = app.globalData.config.maxImageSize
    const supportFormats = app.globalData.config.supportFormats
    const fsm = wx.getFileSystemManager()

    const toKB = (bytes) => Math.round((bytes || 0) / 1024)

    // 辅助：获取图片尺寸
    const getInfo = (src) => new Promise((resolve) => {
      wx.getImageInfo({
        src,
        success: (info) => resolve(info),
        fail: () => resolve({ width: 0, height: 0, type: 'unknown' })
      })
    })

    // 辅助：获取文件大小
    const getSize = (src) => new Promise((resolve) => {
      try {
        fsm.stat({
          path: src,
          success: (st) => resolve(st.size || 0),
          fail: () => resolve(0)
        })
      } catch (e) {
        resolve(0)
      }
    })

    // 自动压缩（quality阶梯：80 -> 60）
    const compressOnce = (src, quality = 80) => new Promise((resolve) => {
      wx.compressImage({
        src,
        quality,
        success: (res) => resolve(res.tempFilePath || res.path || src),
        fail: () => resolve(src)
      })
    })
    // 尺寸降采样：将长边限制到2048像素后导出
    const downscaleToMaxEdge = (src, maxEdge = 2048) => new Promise((resolve) => {
      wx.getImageInfo({
        src,
        success: (info) => {
          let { width, height } = info
          if (width === 0 || height === 0) { resolve(src); return }
          const longEdge = Math.max(width, height)
          if (longEdge <= maxEdge) { resolve(src); return }
          const scale = maxEdge / longEdge
          const newW = Math.round(width * scale)
          const newH = Math.round(height * scale)
          const canvas = wx.createOffscreenCanvas({ type: '2d', width: newW, height: newH })
          const ctx = canvas.getContext('2d')
          const img = canvas.createImage()
          img.onload = () => {
            ctx.drawImage(img, 0, 0, newW, newH)
            wx.canvasToTempFilePath({
              canvas,
              success: (res) => resolve(res.tempFilePath || res.path || src),
              fail: () => resolve(src)
            })
          }
          img.onerror = () => resolve(src)
          img.src = src
        },
        fail: () => resolve(src)
      })
    })

    const processed = []
    for (let i = 0; i < files.length && processed.length < app.globalData.config.maxImageCount; i++) {
      const file = files[i]
      const fileName = file.name || file.path
      const fileExt = (fileName.split('.').pop() || '').toLowerCase()

      // 检查格式（宽松兼容）：若扩展名不在白名单，尝试用 getImageInfo 能否解析；能解析则继续
      if (!supportFormats.includes(fileExt)) {
        const infoTry = await getInfo(path)
        if (!infoTry || !infoTry.width || !infoTry.height) {
          wx.showToast({ title: '不支持的图片格式', icon: 'none' })
          continue
        } else {
          // 仅提示一次兼容（可选）
          // wx.showToast({ title: '已兼容非常见格式', icon: 'none', duration: 1200 })
        }
      }

      const path = file.path
      let size = file.size || await getSize(path)
      const info = await getInfo(path)
      const needCompress = size > maxSize || info.width > 2000 || info.height > 2000

      let finalPath = path
      if (needCompress) {
        // 第一次压缩：quality 80
        const c80 = await compressOnce(path, 80)
        const c80Size = await getSize(c80)
        // 第二次压缩：quality 60（若仍超限）
        const c60 = c80Size > maxSize ? await compressOnce(c80, 60) : c80
        const c60Size = await getSize(c60)
        // 尺寸降采样（2048长边）后再压缩60（若仍超限）
        let cScaled = c60
        let cScaledSize = c60Size
        if (c60Size > maxSize || info.width > 3000 || info.height > 3000) {
          const scaled = await downscaleToMaxEdge(c60, 2048)
          const scaled60 = await compressOnce(scaled, 60)
          cScaled = scaled60
          cScaledSize = await getSize(scaled60)
        }
        if (cScaledSize > 0 && cScaledSize <= maxSize) {
          finalPath = cScaled
          size = cScaledSize
        } else {
          // 仍超限：允许继续（避免直接丢弃），但提示可能处理较慢
          wx.showToast({
            title: `图片较大(${toKB(cScaledSize || size)}KB)，已尝试压缩后继续处理`,
            icon: 'none',
            duration: 1500
          })
          finalPath = cScaled
          size = cScaledSize || size
        }
      }

      processed.push({
        path: finalPath,
        size,
        name: fileName
      })
    }

    if (processed.length === 0) {
      wx.showToast({ title: '没有有效的图片文件', icon: 'none' })
      return
    }

    // 保存选中的图片到页面并跳转
    this.setData({ selectedImages: processed })
    // 直接进入处理页，批量可无需先点单图
    wx.navigateTo({
      url: '/pages/process/process',
      success: (res) => {
        const ec = res && res.eventChannel
        if (ec && ec.emit) {
          ec.emit('images', processed)
        }
      }
    })
  },

  // 切换使用指南显示状态
  toggleGuide() {
    this.setData({
      showGuide: !this.data.showGuide
    })
  },

  // 分享功能
  onShareAppMessage() {
    const img = '/images/share-logo.png'
    console.log('share(index): imageUrl =', img)
    return {
      title: '作业清晰 - 让作业照片更清晰',
      path: '/pages/index/index',
      imageUrl: img
    }
  },

  // 图标加载成功
  onIconLoad(e) {
    const name = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.name
    console.log('[icon load]', name)
  },

  // 图标加载失败
  onIconError(e) {
    const name = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.name
    console.error('[icon error]', name, e && e.detail)
    // 可选：展示一个轻提示
    wx.showToast({
      title: `图标加载失败：${name || ''}`,
      icon: 'none',
      duration: 1500
    })
  }
})