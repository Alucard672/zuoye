// components/image-uploader/image-uploader.js
const { formatFileSize, generateUniqueId, validateImageFormat } = require('../../utils/util.js')

Component({
  properties: {
    maxCount: {
      type: Number,
      value: 9
    },
    maxSize: {
      type: Number,
      value: 10 * 1024 * 1024 // 10MB
    },
    uploadText: {
      type: String,
      value: '选择图片'
    },
    uploadHint: {
      type: String,
      value: '支持JPG、PNG格式，最大10MB'
    }
  },

  data: {
    imageList: [],
    isDragging: false
  },

  methods: {
    // 选择图片
    chooseImage() {
      const remainingCount = this.properties.maxCount - this.data.imageList.length
      
      if (remainingCount <= 0) {
        wx.showToast({
          title: `最多只能选择${this.properties.maxCount}张图片`,
          icon: 'none'
        })
        return
      }

      wx.showActionSheet({
        itemList: ['从相册选择', '从聊天记录选择'],
        success: (res) => {
          if (res.tapIndex === 0) {
            this.chooseFromAlbum(remainingCount)
          } else if (res.tapIndex === 1) {
            this.chooseFromChat(remainingCount)
          }
        }
      })
    },

    // 从相册选择
    chooseFromAlbum(count) {
      wx.chooseImage({
        count: count,
        sizeType: ['original'],
        sourceType: ['album'],
        success: (res) => {
          this.handleSelectedImages(res.tempFilePaths)
        },
        fail: (err) => {
          console.error('选择图片失败:', err)
          wx.showToast({
            title: '选择图片失败',
            icon: 'none'
          })
        }
      })
    },

    // 从聊天记录选择
    chooseFromChat(count) {
      wx.chooseMessageFile({
        count: count,
        type: 'image',
        success: (res) => {
          const filePaths = res.tempFiles.map(file => file.path)
          this.handleSelectedImages(filePaths)
        },
        fail: (err) => {
          console.error('选择聊天记录图片失败:', err)
          wx.showToast({
            title: '选择图片失败',
            icon: 'none'
          })
        }
      })
    },

    // 处理选中的图片
    handleSelectedImages(filePaths) {
      const validImages = []
      const invalidImages = []

      filePaths.forEach(path => {
        // 验证文件格式
        if (!validateImageFormat(path)) {
          invalidImages.push(path)
          return
        }

        // 获取图片信息
        wx.getImageInfo({
          src: path,
          success: (info) => {
            // 检查文件大小
            if (info.size && info.size > this.properties.maxSize) {
              wx.showToast({
                title: '图片过大，请选择小于10MB的图片',
                icon: 'none'
              })
              return
            }

            const imageItem = {
              id: generateUniqueId(),
              path: path,
              name: `图片${this.data.imageList.length + validImages.length + 1}`,
              size: info.size || 0,
              sizeText: formatFileSize(info.size || 0),
              width: info.width,
              height: info.height,
              status: 'ready',
              uploading: false,
              progress: 0
            }

            validImages.push(imageItem)
            
            // 更新图片列表
            this.setData({
              imageList: [...this.data.imageList, ...validImages]
            })

            // 触发选择完成事件
            this.triggerEvent('select', {
              images: this.data.imageList
            })
          },
          fail: (err) => {
            console.error('获取图片信息失败:', err)
          }
        })
      })

      // 显示无效图片提示
      if (invalidImages.length > 0) {
        wx.showToast({
          title: `${invalidImages.length}张图片格式不支持`,
          icon: 'none'
        })
      }
    },

    // 预览图片
    previewImage(e) {
      const index = e.currentTarget.dataset.index
      const urls = this.data.imageList.map(item => item.path)
      
      wx.previewImage({
        urls: urls,
        current: urls[index]
      })
    },

    // 删除图片
    deleteImage(e) {
      const index = e.currentTarget.dataset.index
      const imageList = [...this.data.imageList]
      imageList.splice(index, 1)
      
      this.setData({
        imageList: imageList
      })

      // 触发删除事件
      this.triggerEvent('delete', {
        index: index,
        images: imageList
      })
    },

    // 清空全部
    clearAll() {
      wx.showModal({
        title: '确认清空',
        content: '确定要清空所有图片吗？',
        success: (res) => {
          if (res.confirm) {
            this.setData({
              imageList: []
            })

            // 触发清空事件
            this.triggerEvent('clear')
          }
        }
      })
    },

    // 处理全部
    processAll() {
      if (this.data.imageList.length === 0) {
        wx.showToast({
          title: '请先选择图片',
          icon: 'none'
        })
        return
      }

      // 触发处理事件
      this.triggerEvent('process', {
        images: this.data.imageList
      })
    },

    // 获取状态文本
    getStatusText(status) {
      const statusMap = {
        'ready': '准备就绪',
        'processing': '处理中',
        'completed': '已完成',
        'error': '处理失败'
      }
      return statusMap[status] || ''
    },

    // 更新图片状态
    updateImageStatus(id, status, progress = 0) {
      const imageList = this.data.imageList.map(item => {
        if (item.id === id) {
          return {
            ...item,
            status: status,
            progress: progress,
            uploading: status === 'processing'
          }
        }
        return item
      })

      this.setData({
        imageList: imageList
      })
    },

    // 获取图片列表
    getImageList() {
      return this.data.imageList
    },

    // 设置拖拽状态
    setDragging(isDragging) {
      this.setData({
        isDragging: isDragging
      })
    }
  }
})