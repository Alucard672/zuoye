// pages/index/index.js
Page({
  data: {
    showGuide: false,
    selectedImages: []
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
    // 页面显示时的逻辑
  },

  // 从聊天记录选择图片
  chooseFromChat() {
    wx.chooseMessageFile({
      count: 9,
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
    wx.chooseImage({
      count: 9,
      sizeType: ['original'],
      sourceType: ['album'],
      success: (res) => {
        const tempFiles = res.tempFilePaths.map((path, index) => ({
          path: path,
          size: 0, // 需要获取实际大小
          name: `image_${index + 1}.jpg`
        }))
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

  // 处理选中的图片
  handleSelectedImages(files) {
    if (!files || files.length === 0) {
      return
    }

    // 检查文件大小和格式
    const validFiles = []
    const maxSize = getApp().globalData.config.maxImageSize
    const supportFormats = getApp().globalData.config.supportFormats

    for (let file of files) {
      // 检查文件大小
      if (file.size && file.size > maxSize) {
        wx.showToast({
          title: '图片过大，请选择小于10MB的图片',
          icon: 'none'
        })
        continue
      }

      // 检查文件格式
      const fileName = file.name || file.path
      const fileExt = fileName.split('.').pop().toLowerCase()
      if (!supportFormats.includes(fileExt)) {
        wx.showToast({
          title: '不支持的图片格式',
          icon: 'none'
        })
        continue
      }

      validFiles.push(file)
    }

    if (validFiles.length === 0) {
      wx.showToast({
        title: '没有有效的图片文件',
        icon: 'none'
      })
      return
    }

    // 保存选中的图片到全局数据
    this.setData({
      selectedImages: validFiles
    })

    // 跳转到处理页面
    wx.navigateTo({
      url: '/pages/process/process',
      success: () => {
        // 将图片数据传递给处理页面
        const pages = getCurrentPages()
        const currentPage = pages[pages.length - 1]
        currentPage.setData({
          images: validFiles
        })
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