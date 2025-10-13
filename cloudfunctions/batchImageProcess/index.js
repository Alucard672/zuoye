// 批量图像处理云函数
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  
  try {
    const { imageUrls, mode = 'auto', options = {} } = event
    
    console.log('开始批量处理图片:', { count: imageUrls.length, mode })
    
    const results = []
    
    // 并行处理多个图片（最多5个并行，避免超时）
    const batchSize = 3
    for (let i = 0; i < imageUrls.length; i += batchSize) {
      const batch = imageUrls.slice(i, i + batchSize)
      
      const batchPromises = batch.map(async (imageUrl, index) => {
        try {
          // 调用单个图片处理云函数
          const result = await cloud.callFunction({
            name: 'imageProcess',
            data: {
              imageUrl: imageUrl,
              mode: mode,
              options: options
            }
          })
          
          return {
            index: i + index,
            success: true,
            data: result.result
          }
        } catch (error) {
          console.error(`处理第${i + index + 1}张图片失败:`, error)
          return {
            index: i + index,
            success: false,
            error: error.message
          }
        }
      })
      
      const batchResults = await Promise.all(batchPromises)
      results.push(...batchResults)
      
      // 如果还有更多批次，稍微延迟避免并发过高
      if (i + batchSize < imageUrls.length) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
    
    console.log('批量处理完成:', {
      total: results.length,
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    })
    
    return {
      success: true,
      data: {
        results: results,
        summary: {
          total: results.length,
          success: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length
        }
      }
    }
    
  } catch (error) {
    console.error('批量处理失败:', error)
    return {
      success: false,
      error: error.message
    }
  }
}