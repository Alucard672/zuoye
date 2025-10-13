/**
 * 通用工具函数
 */

/**
 * 格式化时间
 */
const formatTime = date => {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = date.getHours()
  const minute = date.getMinutes()
  const second = date.getSeconds()

  return `${[year, month, day].map(formatNumber).join('-')} ${[hour, minute, second].map(formatNumber).join(':')}`
}

const formatNumber = n => {
  n = n.toString()
  return n[1] ? n : `0${n}`
}

/**
 * 文件大小格式化
 */
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * 防抖函数
 */
const debounce = (func, wait) => {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

/**
 * 节流函数
 */
const throttle = (func, limit) => {
  let inThrottle
  return function() {
    const args = arguments
    const context = this
    if (!inThrottle) {
      func.apply(context, args)
      inThrottle = true
      setTimeout(() => inThrottle = false, limit)
    }
  }
}

/**
 * 深拷贝
 */
const deepClone = (obj) => {
  if (obj === null || typeof obj !== "object") return obj
  if (obj instanceof Date) return new Date(obj.getTime())
  if (obj instanceof Array) return obj.map(item => deepClone(item))
  if (typeof obj === "object") {
    const clonedObj = {}
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key])
      }
    }
    return clonedObj
  }
}

/**
 * 生成唯一ID
 */
const generateUniqueId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}

/**
 * 验证图片格式
 */
const validateImageFormat = (fileName) => {
  const validFormats = ['jpg', 'jpeg', 'png', 'webp']
  const fileExtension = fileName.split('.').pop().toLowerCase()
  return validFormats.includes(fileExtension)
}

/**
 * 压缩图片
 */
const compressImage = (src, quality = 0.8) => {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src: src,
      quality: quality * 100, // 微信小程序的quality是0-100
      success: resolve,
      fail: reject
    })
  })
}

/**
 * 获取图片信息
 */
const getImageInfo = (src) => {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: src,
      success: resolve,
      fail: reject
    })
  })
}

/**
 * 保存图片到相册
 */
const saveImageToAlbum = (filePath) => {
  return new Promise((resolve, reject) => {
    wx.saveImageToPhotosAlbum({
      filePath: filePath,
      success: resolve,
      fail: reject
    })
  })
}

/**
 * 显示加载提示
 */
const showLoading = (title = '加载中...', mask = true) => {
  wx.showLoading({
    title: title,
    mask: mask
  })
}

/**
 * 隐藏加载提示
 */
const hideLoading = () => {
  wx.hideLoading()
}

/**
 * 显示成功提示
 */
const showSuccess = (title, duration = 1500) => {
  wx.showToast({
    title: title,
    icon: 'success',
    duration: duration
  })
}

/**
 * 显示错误提示
 */
const showError = (title, duration = 2000) => {
  wx.showToast({
    title: title,
    icon: 'error',
    duration: duration
  })
}

/**
 * 显示普通提示
 */
const showToast = (title, duration = 1500) => {
  wx.showToast({
    title: title,
    icon: 'none',
    duration: duration
  })
}

/**
 * 显示确认对话框
 */
const showConfirm = (options) => {
  return new Promise((resolve) => {
    wx.showModal({
      title: options.title || '提示',
      content: options.content || '',
      confirmText: options.confirmText || '确定',
      cancelText: options.cancelText || '取消',
      success: (res) => {
        resolve(res.confirm)
      },
      fail: () => {
        resolve(false)
      }
    })
  })
}

/**
 * 检查网络状态
 */
const checkNetworkStatus = () => {
  return new Promise((resolve) => {
    wx.getNetworkType({
      success: (res) => {
        resolve({
          networkType: res.networkType,
          isConnected: res.networkType !== 'none'
        })
      },
      fail: () => {
        resolve({
          networkType: 'unknown',
          isConnected: false
        })
      }
    })
  })
}

/**
 * 本地存储操作
 */
const storage = {
  set: (key, value) => {
    try {
      wx.setStorageSync(key, value)
      return true
    } catch (e) {
      console.error('Storage set error:', e)
      return false
    }
  },
  
  get: (key, defaultValue = null) => {
    try {
      const value = wx.getStorageSync(key)
      return value !== '' ? value : defaultValue
    } catch (e) {
      console.error('Storage get error:', e)
      return defaultValue
    }
  },
  
  remove: (key) => {
    try {
      wx.removeStorageSync(key)
      return true
    } catch (e) {
      console.error('Storage remove error:', e)
      return false
    }
  },
  
  clear: () => {
    try {
      wx.clearStorageSync()
      return true
    } catch (e) {
      console.error('Storage clear error:', e)
      return false
    }
  }
}

/**
 * 统计工具
 */
const analytics = {
  // 记录用户行为
  track: (event, properties = {}) => {
    const data = {
      event: event,
      properties: properties,
      timestamp: Date.now(),
      userId: storage.get('userId') || 'anonymous'
    }
    
    // 这里可以发送到分析服务
    console.log('Analytics track:', data)
  },
  
  // 记录页面访问
  pageView: (pageName) => {
    analytics.track('page_view', {
      page: pageName,
      timestamp: Date.now()
    })
  }
}

module.exports = {
  formatTime,
  formatFileSize,
  debounce,
  throttle,
  deepClone,
  generateUniqueId,
  validateImageFormat,
  compressImage,
  getImageInfo,
  saveImageToAlbum,
  showLoading,
  hideLoading,
  showSuccess,
  showError,
  showToast,
  showConfirm,
  checkNetworkStatus,
  storage,
  analytics
}