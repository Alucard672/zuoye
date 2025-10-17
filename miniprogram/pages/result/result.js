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
    selectedOrder: [],
    orderMap: {},
    stitchedPath: '',
    version: '',
    savedList: [], // 保存区列表：[{savedFilePath, name, size, time}]
    usePngIcons: true
  },

  // 任一图标加载失败时，降级为文字符号图标，避免报错闪烁
  onIconFail() {
    if (this.data.usePngIcons) {
      this.setData({ usePngIcons: false })
    }
  },

  onLoad() {
    // 获取处理结果数据
    const app = getApp()
    if (app.globalData.processedImages && app.globalData.processedImages.length > 0) {
      // 读取优化记录（兼容旧键 savedStitchResults）
      let savedNew = []
      let savedOld = []
      try { savedNew = wx.getStorageSync('optimizeRecords') || [] } catch (e) { savedNew = [] }
      try { savedOld = wx.getStorageSync('savedStitchResults') || [] } catch (e) { savedOld = [] }
      const merged = ([]).concat(Array.isArray(savedNew) ? savedNew : [], Array.isArray(savedOld) ? savedOld : [])
      // 映射显示字段
      const mapped = merged.map(it => ({ ...it, timeText: this._formatTime(it.time), sizeText: this._formatSize(it.size) }))
      this.setData({
        processedImages: app.globalData.processedImages,
        version: (app.globalData && app.globalData.version) || '1.4.2',
        savedList: mapped
      })
      // 单张优化：自动加入优化记录（同页仅一次，避免重复）
      if (!this.__autoSavedOnce && Array.isArray(app.globalData.processedImages) && app.globalData.processedImages.length === 1) {
        this.__autoSavedOnce = true
        const it = app.globalData.processedImages[0]
        const url = it && it.processed
        if (url) {
          wx.nextTick(() => {
            setTimeout(() => {
              const name = `optimized_${Date.now()}.jpg`
              this._saveToVault(url, name)
            }, 16)
          })
        }
      }
      // 进入结果页后确保关闭任何遗留的加载态，并清理批量锁
      try { wx.hideLoading() } catch(e) {}
      if (app && app.globalData) app.globalData.isBatchProcessing = false
    } else {
      // 无处理结果时，作为“优化记录”浏览入口使用：不跳转，仅加载记录列表
      let savedNew = []
      let savedOld = []
      try { savedNew = wx.getStorageSync('optimizeRecords') || [] } catch (e) { savedNew = [] }
      try { savedOld = wx.getStorageSync('savedStitchResults') || [] } catch (e) { savedOld = [] }
      const merged = ([]).concat(Array.isArray(savedNew) ? savedNew : [], Array.isArray(savedOld) ? savedOld : [])
      const mapped = merged.map(it => ({ ...it, timeText: this._formatTime(it.time), sizeText: this._formatSize(it.size) }))
      const app = getApp()
      this.setData({
        processedImages: [],
        version: (app && app.globalData && app.globalData.version) || '1.4.2',
        savedList: mapped
      })
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
    const nums = values.map(v => parseInt(v, 10)).filter(n => !Number.isNaN(n))
    // 记录“选择顺序”：先维护之前的顺序，移除未勾选的，追加新勾选的（按本次数组顺序）
    const prev = Array.isArray(this.data.selectedOrder) ? this.data.selectedOrder.slice() : []
    const setNow = new Set(nums)
    const kept = prev.filter(i => setNow.has(i))
    const added = nums.filter(i => !prev.includes(i))
    const newOrder = kept.concat(added)
    // 建立索引到序号的映射，便于 WXML 显示
    const orderMap = {}
    newOrder.forEach((idx, pos) => { orderMap[idx] = pos + 1 })
    this.setData({
      selectedMap: map,
      selectedIndices: nums,
      selectedOrder: newOrder,
      orderMap,
      selectedCount: nums.length
    })
  },

  // 拼接所选（竖向）
  async stitchSelected() {
    const imgs = this.data.processedImages || []
    const indices = this.data.selectedIndices || []
    const order = (this.data.selectedOrder && this.data.selectedOrder.length > 0) ? this.data.selectedOrder : indices
    const selected = order
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
      // 先更新状态，等一帧再进行后续操作，避免瞬时峰值
      this.setData({ stitchedPath: out })
      wx.nextTick(() => {
        setTimeout(() => {
          // 写入保存区（不再预览）
          const name = `stitched_${Date.now()}.jpg`
          this._saveToVault(out, name)
        }, 16)
      })
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

  // 保存拼接结果到相册
  saveStitched() {
    const url = this.data.stitchedPath
    if (!url) {
      wx.showToast({ title: '暂无拼接结果', icon: 'none' })
      return
    }
    this._saveUrlToAlbum(url)
  },

  // 保存拼接结果到“保存区”（本地持久化）
  saveStitchedToVault() {
    const url = this.data.stitchedPath
    if (!url) {
      wx.showToast({ title: '暂无拼接结果', icon: 'none' })
      return
    }
    const name = `stitched_${Date.now()}.jpg`
    this._saveToVault(url, name)
  },

  // 通用保存
  _saveUrlToAlbum(url) {
    wx.showLoading({ title: '保存中...' })
    const doSave = (filePath) => {
      wx.saveImageToPhotosAlbum({
        filePath,
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
    }
    // 本地临时文件可直接保存
    if (/^wxfile:\/\//.test(url) || /^http:\/\/tmp\//.test(url)) {
      doSave(url)
      return
    }
    // 远程或云文件，先下载再保存
    wx.downloadFile({
      url,
      success: (res) => doSave(res.tempFilePath),
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

  // 保存到“保存区”（内部实现）
  _saveToVault(url, name) {
    const fs = wx.getFileSystemManager()
    const persist = (tempPath) => {
      fs.saveFile({
        tempFilePath: tempPath,
        success: (r) => {
          // 获取大小
          let size = 0
          try { size = fs.statSync(r.savedFilePath).size || 0 } catch(e) {}
          const now = Date.now()
          const item = { savedFilePath: r.savedFilePath, name: name || 'stitched.jpg', size, time: now, timeText: this._formatTime(now), sizeText: this._formatSize(size) }
          const list = (this.data.savedList || []).slice()
          list.unshift(item)
          // 超过10条则移除最早的（并尝试删除文件，避免空间占用）
          while (list.length > 10) {
            const removed = list.pop()
            try { if (removed && removed.savedFilePath) wx.getFileSystemManager().unlinkSync(removed.savedFilePath) } catch (e) {}
          }
          this.setData({ savedList: list })
          try { wx.setStorageSync('optimizeRecords', list) } catch(e) {}
          wx.showToast({ title: '已加入优化记录', icon: 'success' })
        },
        fail: () => wx.showToast({ title: '保存失败', icon: 'none' })
      })
    }
    if (/^wxfile:\/\//.test(url) || /^http:\/\/tmp\//.test(url)) {
      persist(url)
    } else {
      wx.downloadFile({
        url,
        success: (res) => persist(res.tempFilePath),
        fail: () => wx.showToast({ title: '下载失败', icon: 'none' })
      })
    }
  },

  // 预览保存区图片
  openSaved(e) {
    const path = e.currentTarget.dataset.path
    if (!path) return
    wx.previewImage({ urls: [path], current: path })
  },

  // 保存区图片保存到相册
  saveSavedToAlbum(e) {
    const path = e.currentTarget.dataset.path
    if (!path) return
    this._saveUrlToAlbum(path)
  },

  // 转发保存区图片（取消或失败时不做任何预览）
  forwardSaved(e) {
    const path = e.currentTarget.dataset.path
    if (!path) return
    if (wx.showShareImageMenu) {
      wx.showShareImageMenu({
        path,
        success: () => {},
        fail: () => {},      // 不预览
        complete: () => {}   // 不预览
      })
    } else {
      // 低版本：仅提示，不预览
      wx.showToast({ title: '请使用右上角进行转发', icon: 'none' })
    }
  },

  // 删除保存区图片（当前未在UI暴露，保留以备后用）
  removeSaved(e) {
    const path = e.currentTarget.dataset.path
    if (!path) return
    const fs = wx.getFileSystemManager()
    try { fs.unlinkSync(path) } catch(e) {}
    const list = (this.data.savedList || []).filter(i => i.savedFilePath !== path)
    this.setData({ savedList: list })
    try { wx.setStorageSync('optimizeRecords', list) } catch(e) {}
    wx.showToast({ title: '已删除', icon: 'success' })
  },

  // 清空保存区
  clearVault() {
    const list = this.data.savedList || []
    const fs = wx.getFileSystemManager()
    for (const it of list) {
      try { if (it && it.savedFilePath) fs.unlinkSync(it.savedFilePath) } catch (e) {}
    }
    this.setData({ savedList: [] })
    try { wx.setStorageSync('optimizeRecords', []) } catch (e) {}
    wx.showToast({ title: '已清空', icon: 'success' })
  },

  // 时间格式化
  _formatTime(ts) {
    try {
      const d = new Date(ts)
      const pad = (n) => (n < 10 ? '0' + n : '' + n)
      const y = d.getFullYear()
      const m = pad(d.getMonth() + 1)
      const day = pad(d.getDate())
      const hh = pad(d.getHours())
      const mm = pad(d.getMinutes())
      return `${y}-${m}-${day} ${hh}:${mm}`
    } catch (e) {
      return '' + ts
    }
  },

  // 大小格式化
  _formatSize(bytes) {
    const n = Number(bytes) || 0
    if (n >= 1024 * 1024) return Math.round(n / 1024 / 1024) + ' MB'
    return Math.max(1, Math.round(n / 1024)) + ' KB'
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