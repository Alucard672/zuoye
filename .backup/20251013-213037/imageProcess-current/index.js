// 标准云函数：图像占位处理（复制版）
// 功能：将传入的 COS fileID 原样复制到 processed/ 前缀下，返回新的 processedFileID
// 兼容：单图与多图（数组），返回结构与小程序端 CloudImageProcessor 兼容

const cloud = require('wx-server-sdk')
const path = require('path')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function pickArray(event, keys) {
  for (const k of keys) {
    if (Array.isArray(event[k]) && event[k].length > 0) return event[k].filter(Boolean)
  }
  return null
}

// 推断后缀名（fileID 可能没有扩展名）
function guessExt(fileID) {
  try {
    const p = fileID.split('?')[0] || ''
    const base = path.basename(p)
    const idx = base.lastIndexOf('.')
    if (idx > 0 && idx < base.length - 1) {
      const ext = base.slice(idx + 1).toLowerCase()
      if (['jpg','jpeg','png','webp','bmp'].includes(ext)) return '.' + ext
    }
  } catch (_) {}
  return '.jpg'
}

async function copyOneFile(fileID) {
  // 1) 下载原文件为 Buffer
  const dl = await cloud.downloadFile({ fileID })
  const buf = dl && dl.fileContent
  if (!buf || !Buffer.isBuffer(buf)) {
    throw new Error('下载源文件失败')
  }

  // 2) 生成目标 cloudPath（processed/ 前缀）
  const now = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  const ext = guessExt(fileID)
  const cloudPath = `processed/${now}_${rand}${ext}`

  // 3) 上传到 COS，得到新的 fileID
  const up = await cloud.uploadFile({
    cloudPath,
    fileContent: buf
  })

  return {
    fileID: up.fileID,
    cloudPath
  }
}

exports.main = async (event, context) => {
  const t0 = Date.now()
  const wxContext = cloud.getWXContext()

  try {
    const multiList = pickArray(event, ['imageUrls', 'images', 'files', 'list'])
    const single = event.imageUrl || (Array.isArray(multiList) ? multiList[0] : null)

    // 多页模式
    if (Array.isArray(multiList) && multiList.length > 1) {
      const pages = []
      for (let i = 0; i < multiList.length; i++) {
        const fid = multiList[i]
        if (!fid || typeof fid !== 'string') continue
        const res = await copyOneFile(fid)
        pages.push({
          fileID: res.fileID,
          width: null,
          height: null,
          pageIndex: i + 1
        })
      }

      return {
        success: true,
        data: {
          pages,
          pageCount: pages.length,
          processTime: Date.now() - t0
        },
        env: wxContext && wxContext.ENV ? wxContext.ENV : 'unknown'
      }
    }

    // 单图模式
    if (!single || typeof single !== 'string') {
      throw new Error('缺少有效的 imageUrl（应为云存储 fileID）')
    }

    const out = await copyOneFile(single)

    return {
      success: true,
      data: {
        processedFileID: out.fileID,
        metadata: {
          mode: 'copied',
          note: '占位实现：已复制到 processed/ 前缀'
        },
        processTime: Date.now() - t0,
        originalSize: null,
        processedSize: null
      },
      env: wxContext && wxContext.ENV ? wxContext.ENV : 'unknown'
    }
  } catch (err) {
    console.error('imageProcess 执行失败:', err)
    return {
      success: false,
      error: err && err.message ? err.message : String(err),
      processTime: Date.now() - t0
    }
  }
}