// app.js
const { analytics } = require('./utils/util.js')

App({
  onLaunch() {
    // 初始化云开发到指定环境，避免调用默认环境导致超时或函数不匹配
    if (!wx.cloud) {
      console.error('基础库不支持云开发，请升级微信版本');
    } else {
      wx.cloud.init({
        env: 'bbs-4g91m08ha404f7d0'
      });
      console.log('wx.cloud.init 完成，env=bbs-4g91m08ha404f7d0');
    }
    // 初始化云开发
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
    } else {
      wx.cloud.init({
        // env 参数说明：
        //   env 参数决定接下来小程序发起的云开发调用（wx.cloud.xxx）会默认请求到哪个云环境的资源
        //   此处请填入环境 ID, 环境 ID 可打开云控制台查看
        env: 'bbs-4g91m08ha404f7d0', // 您的云开发环境ID
        traceUser: true,
      })
    }

    // 展示本地存储能力
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    // 检查小程序版本更新
    this.checkForUpdate()

    // 登录
    wx.login({
      success: res => {
        console.log('登录成功', res.code)
        
        // 记录启动事件
        analytics.track('app_launch', {
          scene: this.globalData.scene,
          version: this.globalData.version
        })
      }
    })

    // 获取用户信息
    wx.getSetting({
      success: res => {
        if (res.authSetting['scope.userInfo']) {
          wx.getUserInfo({
            success: res => {
              this.globalData.userInfo = res.userInfo
            }
          })
        }
      }
    })
  },

  onShow(options) {
    this.globalData.scene = options.scene
    analytics.pageView('app_show')
  },

  onHide() {
    analytics.track('app_hide')
  },

  onError(msg) {
    console.error('应用错误:', msg)
    analytics.track('app_error', {
      error: msg,
      timestamp: Date.now()
    })
  },

  // 检查小程序更新
  checkForUpdate() {
    const updateManager = wx.getUpdateManager()

    updateManager.onCheckForUpdate((res) => {
      console.log('检查更新结果:', res.hasUpdate)
    })

    updateManager.onUpdateReady(() => {
      wx.showModal({
        title: '更新提示',
        content: '新版本已经准备好，是否重启应用？',
        success: (res) => {
          if (res.confirm) {
            updateManager.applyUpdate()
          }
        }
      })
    })

    updateManager.onUpdateFailed(() => {
      wx.showToast({
        title: '更新失败，请检查网络',
        icon: 'none'
      })
    })
  },
  
  globalData: {
    userInfo: null,
    scene: 0,
    version: '1.0.0',
    
    // 云开发环境ID
    cloudEnv: 'bbs-4g91m08ha404f7d0',
    
    // 应用配置
    config: {
      maxImageSize: 10 * 1024 * 1024, // 10MB
      maxImageCount: 9, // 最多9张图片
      supportFormats: ['jpg', 'jpeg', 'png', 'webp'],
      processTimeout: 60000, // 60秒超时（云函数处理时间较长）
      
      // 图像处理参数
      imageProcess: {
        autoMode: {
          contrast: 1.2,
          sharpen: 0.8,
          denoise: true,
          brightness: 1.1
        },
        enhanceMode: {
          contrast: 1.5,
          sharpen: 1.2,
          denoise: true,
          brightness: 1.2
        }
      }
    },

    // 处理结果存储
    processedImages: [],
    
    // 用户统计数据
    userStats: {
      totalProcessed: 0,
      successCount: 0,
      favoriteMode: 'auto'
    },

    // 应用状态
    appState: {
      isProcessing: false,
      currentTask: null,
      networkStatus: 'unknown'
    }
  },

  // 全局方法
  
  // 更新用户统计
  updateUserStats(type, value) {
    const stats = this.globalData.userStats
    if (stats[type] !== undefined) {
      if (typeof value === 'number') {
        stats[type] += value
      } else {
        stats[type] = value
      }
      
      // 保存到本地存储
      wx.setStorageSync('userStats', stats)
    }
  },

  // 获取用户统计
  getUserStats() {
    const localStats = wx.getStorageSync('userStats')
    if (localStats) {
      this.globalData.userStats = { ...this.globalData.userStats, ...localStats }
    }
    return this.globalData.userStats
  },

  // 重置处理结果
  clearProcessedImages() {
    this.globalData.processedImages = []
  },

  // 添加处理结果
  addProcessedImage(imageData) {
    this.globalData.processedImages.push(imageData)
    this.updateUserStats('totalProcessed', 1)
  }
})