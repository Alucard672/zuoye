const Stitcher = require('../../utils/stitcher.js')
// pages/result/result.js
Page({
  data: {
    processedImages: [],
    currentImageIndex: 0,
    activeTab: 'optimized',
    rating: 0,
    showShareModal: false,
    selectedMap: {},
    selectedCount: 0,
    selectedIndices: [],
    stitchedPath: ''
  },

  onLoad() {
    // 获取处理结果数据
    const app = getApp()
    if (app.globalData.processedImages && app.globalData.processedImages.length > 0) {
      this.setData({
        processedImages: app.globalData.processedImages
      })
    } else {
      // 如果没有数据，返回首页
      wx.showToast({
        title: '没有找到处理结果',
        icon: 'none'
      })
      setTimeout(() => {
        wx.redirectTo({
          url: '/pages/index/index'
        })
      }, 1500)
    }
  },

  // 切换标签页
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({
      activeTab: tab
    })
  },

  // 切换图片
  switchImage(e) {
    const index = e.currentTarget.dataset.index
    this.setData({
      currentImageIndex: index
    })
  },

  // 勾选（通过 checkbox-group 汇总）
  onSelectChange(e) {
    const values = Array.isArray(e?.detail?.value) ? e.detail.value : []
    const map = {}
    values.forEach(v => { map[v] = true })
    this.setData({
      selectedMap: map,
      selectedIndices: values.map(v => parseInt(v, 10)).filter(n => !Number.isNaN(n)),
      selectedCount: values.length
    })
  },

  // 拼接所选（竖向）
  async stitchSelected() {
    const imgs = this.data.processedImages || []
    const indices = this.data.selectedIndices || []
    const selected = indices
      .filter(i => i >= 0 && i < imgs.length)
      .map(i => imgs[i].processed)
    if (selected.length < 2) {
      wx.showToast({ title: '请至少选择两张图片', icon: 'none' })
      return
    }
    wx.showLoading({ title: '拼接中...' })
    try {
      const out = await Stitcher.stitchVertical(selected)
      wx.hideLoading()
      this.setData({ stitchedPath: out })
      wx.previewImage({ urls: [out], current: out })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '拼接失败', icon: 'none' })
    }
  },

  // 预览图片（更强容错：支持 data-src、全局/页面单图）
  previewImage(e) {
    const app = getApp()
    const { processedImages, currentImageIndex, processedImage } = this.data

    // 1) 尝试 data-src
    const direct = e?.currentTarget?.dataset?.src

    // 2) 尝试全局列表
    const listHasData = Array.isArray(processedImages) && processedImages.length > 0
    const listCurrent = listHasData ? processedImages[currentImageIndex]?.processed : undefined
    const listFirst = listHasData ? processedImages[0]?.processed : undefined

    // 3) 尝试页面与全局的单图
    const pageSingle = processedImage
    const appSingle = app?.globalData?.processedImage

    const current = direct || listCurrent || listFirst || pageSingle || appSingle
    if (!current) {
      wx.showToast({ title: '暂无可预览图片', icon: 'none' })
      return
    }

    wx.previewImage({
      urls: [current],
      current
    })
  },



  // 保存到相册（需使用本地临时文件路径）
  saveToAlbum() {
    const currentImage = this.data.processedImages[this.data.currentImageIndex]
    const url = currentImage && currentImage.processed
    if (!url) {
      wx.showToast({ title: '没有可保存的图片', icon: 'none' })
      return
    }
    this._saveUrlToAlbum(url)
  },

  // 保存拼接结果
  saveStitched() {
    const url = this.data.stitchedPath
    if (!url) {
      wx.showToast({ title: '暂无拼接结果', icon: 'none' })
      return
    }
    this._saveUrlToAlbum(url)
  },

  // 通用保存
  _saveUrlToAlbum(url) {
    wx.showLoading({ title: '保存中...' })
    wx.downloadFile({
      url,
      success: (res) => {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => { wx.hideLoading(); wx.showToast({ title: '已保存到相册', icon: 'success' }) },
          fail: (err) => {
            wx.hideLoading()
            if (err.errMsg && err.errMsg.includes('auth')) {
              wx.showModal({
                title: '需要授权',
                content: '需要您授权保存图片到相册',
                confirmText: '去设置',
                success: (r) => { if (r.confirm) wx.openSetting() }
              })
            } else {
              wx.showToast({ title: '保存失败', icon: 'none' })
            }
          }
        })
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '下载失败', icon: 'none' }) }
    })
  },

  // 增强当前图片的文字清晰度（仅作用于暗文字像素）
  async refineText() {
    const list = this.data.processedImages || []
    const idx = this.data.currentImageIndex
    const url = (list[idx] && list[idx].processed) || null
    if (!url) {
      wx.showToast({ title: '暂无可增强图片', icon: 'none' })
      return
    }
    wx.showLoading({ title: '增强中...' })
    try {
      const out = await this._enhanceTextForUrl(url)
      const copy = list.slice()
      copy[idx] = { ...copy[idx], processed: out }
      this.setData({ processedImages: copy })
      wx.hideLoading()
      wx.showToast({ title: '已增强', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '增强失败', icon: 'none' })
    }
  },

  // 轻量“文字增强”：对暗像素做对比提升+微弱反锐化
  _enhanceTextForUrl(url) {
    return new Promise((resolve, reject) => {
      wx.getImageInfo({
        src: url,
        success: (info) => {
          const w = info.width, h = info.height
          const canvas = wx.createOffscreenCanvas({ type: '2d', width: w, height: h })
          const ctx = canvas.getContext('2d')
          const img = canvas.createImage()
          img.onload = () => {
            ctx.drawImage(img, 0, 0, w, h)
            const imgData = ctx.getImageData(0, 0, w, h)
            const data = imgData.data

            // 1) 轻度对比提升（仅暗像素）
            const contrast = 0.15
            const factor = (259 * ((contrast * 255) + 255)) / (255 * (259 - (contrast * 255)))
            for (let i = 0; i < data.length; i += 4) {
              const r = data[i], g = data[i+1], b = data[i+2]
              const lum = 0.299*r + 0.587*g + 0.114*b
              if (lum < 170) {
                for (let c = 0; c < 3; c++) {
                  let v = data[i + c]
                  v = factor * (v - 128) + 128
                  data[i + c] = Math.max(0, Math.min(255, v))
                }
              }
            }

            // 2) 轻度反锐化（仅暗像素）
            const k = [0, -0.25, 0, -0.25, 2, -0.25, 0, -0.25, 0]
            const src = new Uint8ClampedArray(data)
            for (let y = 1; y < h - 1; y++) {
              for (let x = 1; x < w - 1; x++) {
                const base = (y*w + x) * 4
                const lum = 0.299*src[base] + 0.587*src[base+1] + 0.114*src[base+2]
                if (lum >= 170) continue
                for (let c = 0; c < 3; c++) {
                  let sum = 0, ki = 0
                  for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                      const idx = ((y+dy)*w + (x+dx)) * 4 + c
                      sum += src[idx] * k[ki++]
                    }
                  }
                  data[base + c] = Math.max(0, Math.min(255, sum))
                }
              }
            }

            ctx.putImageData(imgData, 0, 0)
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

  // 分享到微信
  shareToWechat() {
    console.log('share(result.ui): open share modal')
    this.setData({
      showShareModal: true
    })
  },

  // 连接打印机
  printImage() {
    wx.showModal({
      title: '打印功能',
      content: '即将支持连接打印机功能，敬请期待！',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  // 设置评分
  setRating(e) {
    const rating = e.currentTarget.dataset.rating
    this.setData({
      rating: rating
    })

    // 提交评分
    this.submitRating(rating)
  },

  // 提交评分
  submitRating(rating) {
    // 这里应该调用评分API
    console.log('用户评分:', rating)
    
    wx.showToast({
      title: '感谢您的评价！',
      icon: 'success',
      duration: 1500
    })
  },

  // 处理更多图片
  processMore() {
    wx.navigateBack({
      delta: 2 // 返回到首页
    })
  },

  // 返回首页
  goHome() {
    wx.navigateBack({
      delta: 2 // 返回到首页
    })
  },

  // 显示分享弹窗
  hideShareModal() {
    this.setData({
      showShareModal: false
    })
  },

  // 阻止事件冒泡
  stopPropagation() {
    // 空函数，用于阻止事件冒泡
  },

  // 分享给朋友
  shareToFriend() {
    this.hideShareModal()
    wx.showToast({
      title: '请使用右上角分享',
      icon: 'none'
    })
  },

  // 分享到群聊
  shareToGroup() {
    this.hideShareModal()
    wx.showToast({
      title: '请使用右上角分享',
      icon: 'none'
    })
  },

  // 获取模式文本
  getModeText(mode) {
    const modeMap = {
      'auto': '智能优化',
      'enhance': '深度增强',
      'whiten-soft': '白底（柔和）',
      'whiten': '白底（标准）',
      'whiten-strong': '白底（强效）'
    }
    return modeMap[mode] || '智能优化'
  },

  // 获取评分文本
  getRatingText(rating) {
    const ratingMap = {
      1: '需要改进',
      2: '一般般',
      3: '还不错',
      4: '很满意',
      5: '非常棒！'
    }
    return ratingMap[rating] || ''
  },

  // 分享功能
  onShareAppMessage() {
    const img = '/images/share-logo.png'
    console.log('share(result): imageUrl =', img)
    return {
      title: '我用作业清晰优化了作业照片，效果很棒！',
      path: '/pages/index/index',
      imageUrl: img
    }
  },

  onShareTimeline() {
    const img = '/images/share-logo.png'
    console.log('share(result.timeline): imageUrl =', img)
    return {
      title: '作业清晰 - 让作业照片更清晰',
      imageUrl: img
    }
  }
})