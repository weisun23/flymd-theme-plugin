// flymd 主题管理器插件
// 单文件 ESM 入口。挂在 flymd 的 context API 上：
//   activate(context) / deactivate() / openSettings(context)

// ============================================================
// 常量
// ============================================================

const PLUGIN_ID = 'theme-manager'
const STYLE_TAG_ID = 'flymd-theme-plugin-injected'
const STORAGE_KEY_INDEX = 'themesIndex'        // { id: { name, author, version, description, source } }
const STORAGE_KEY_CURRENT = 'currentThemeId'   // 当前应用的主题 id

const META_KEYS = ['id', 'name', 'author', 'version', 'description', 'main']

// 主题数据根目录（在 activate 时填充）
let THEMES_ROOT = ''

// 当前已注册的菜单项移除函数；切换主题需要重建菜单
let removeMenuItem = null

// 菜单重建锁，防止并发调用
let rebuildingMenu = false

// 共享 context（来自 activate）
let CTX = null

// 监听菜单弹层的 MutationObserver（用于在不重建菜单的前提下给当前主题打 ✓）
let menuObserver = null

// 缓存当前主题 id（避免在 observer 回调里读 storage 异步抖动）
let cachedCurrentId = null
let menuVersion = 0


// ============================================================
// 工具：字符串与路径
// ============================================================

function slugify(str) {
  if (!str) return ''
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9一-龥\-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function isWindowsPath(p) {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.includes('\\')
}

function joinPath(...parts) {
  const useBackslash = parts.some((p) => p && isWindowsPath(p))
  const sep = useBackslash ? '\\' : '/'
  const cleaned = parts
    .filter((p) => p !== undefined && p !== null && p !== '')
    .map((p, i) => {
      let s = String(p)
      if (i > 0) s = s.replace(/^[\\/]+/, '')
      if (i < parts.length - 1) s = s.replace(/[\\/]+$/, '')
      return s
    })
  return cleaned.join(sep)
}

function basename(p) {
  if (!p) return ''
  const s = String(p).replace(/[\\/]+$/, '')
  const idx = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return idx >= 0 ? s.slice(idx + 1) : s
}

function dirname(p) {
  if (!p) return ''
  const s = String(p).replace(/[\\/]+$/, '')
  const idx = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return idx >= 0 ? s.slice(0, idx) : ''
}

// ============================================================
// 工具：CSS 元数据解析
// ============================================================

// 从 css 顶部 /* @key value */ 注释中读取主题元数据
function parseCssMeta(cssText) {
  const meta = {}
  if (!cssText) return meta
  // 只读首段连续注释
  const head = cssText.slice(0, 4096)
  const re = /\/\*\s*@([a-zA-Z][a-zA-Z0-9_-]*)\s+([^*]+?)\s*\*\//g
  let m
  while ((m = re.exec(head)) !== null) {
    const key = m[1].toLowerCase()
    const val = m[2].trim()
    if (META_KEYS.includes(key)) meta[key] = val
  }
  return meta
}

// 把元数据写回 css 头部（用于把单文件主题统一规范化）
function buildHeaderComment(meta) {
  const lines = []
  for (const k of ['id', 'name', 'author', 'version', 'description']) {
    if (meta[k]) lines.push('/* @' + k + ' ' + String(meta[k]).replace(/\*\//g, '* /') + ' */')
  }
  return lines.length ? lines.join('\n') + '\n' : ''
}

// ============================================================
// 工具：URL 解析（GitHub）
// ============================================================

function parseGithubInput(input) {
  if (!input) return null
  const s = String(input).trim().replace(/#.*$/, '').replace(/\?.*$/, '').replace(/\/+$/, '')

  // 完整 https://github.com/.../blob/branch/path/file.ext
  let m = s.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i)
  if (m) {
    return {
      owner: m[1],
      repo: m[2].replace(/\.git$/, ''),
      branch: m[3],
      path: m[4],
    }
  }

  // 完整 https://github.com/owner/repo[/...] 或 git@github.com:owner/repo
  m = s.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/i)
  if (m) return { owner: m[1], repo: m[2], branch: '', path: '' }

  // owner/repo/path 或 owner/repo/path@branch（子目录主题）
  m = s.match(/^([^\s/@]+)\/([^\s/@]+)\/([^\s@]+?)(?:@([^\s]+))?$/)
  if (m) return { owner: m[1], repo: m[2], branch: m[4] || '', path: m[3] }

  // owner/repo 或 owner/repo@branch
  m = s.match(/^([^\s/@]+)\/([^\s/@]+)(?:@([^\s/]+))?$/)
  if (m) return { owner: m[1], repo: m[2], branch: m[3] || '', path: '' }

  return null
}

function rawUrl(g, path, branch) {
  const b = branch || g.branch || 'main'
  return 'https://raw.githubusercontent.com/' + g.owner + '/' + g.repo + '/' + b + '/' + (path || '')
}

// ============================================================
// 工具：HTTP 拉取
// ============================================================

async function fetchText(url) {
  if (!CTX || !CTX.http) throw new Error('http API 不可用')
  const resp = await CTX.http.fetch(url, { method: 'GET' })
  if (!resp) throw new Error('HTTP no-response @ ' + url)

  const status = resp.status || resp.statusCode || 0
  const ok = resp.ok !== undefined ? resp.ok : (status >= 200 && status < 300)
  if (!ok) throw new Error('HTTP ' + status + ' @ ' + url)

  if (typeof resp.text === 'function') return await resp.text()
  if (typeof resp.data === 'string') return resp.data
  if (typeof resp.body === 'string') return resp.body
  if (resp.data && (resp.data instanceof ArrayBuffer || (resp.data.buffer instanceof ArrayBuffer))) {
    return new TextDecoder('utf-8').decode(resp.data)
  }
  throw new Error('无法从响应中提取文本内容')
}

async function fetchTextOrNull(url) {
  try {
    return await fetchText(url)
  } catch {
    return null
  }
}

// 在多个分支候选下尝试拉取一个相对路径
async function fetchFromBranches(g, path, branches) {
  for (const b of branches) {
    const txt = await fetchTextOrNull(rawUrl(g, path, b))
    if (txt !== null) return { text: txt, branch: b }
  }
  return null
}

// ============================================================
// 文件系统适配（在 flymd 暴露的有限 fs API 上加抽象）
// ============================================================
//
// flymd 文档明确暴露：readTextFile / writeTextFile / appendTextFile /
// readFileBinary / writeFileBinary / exists；
// 但没有暴露 mkdir / readDir / remove。我们通过：
//   1) 写文件时 try/catch（很多平台 writeTextFile 会自动建父目录），
//   2) 必要时 fallback 到 invoke 原生 Tauri 命令（best-effort）
// 同时维护一个 storage 索引作为权威清单。

async function ensureDir(absPath) {
  if (!absPath) return
  // best-effort：尝试 invoke Tauri 文件系统插件创建目录
  try {
    await CTX.invoke('plugin:fs|mkdir', { path: absPath, options: { recursive: true } })
    return
  } catch {}
  try {
    await CTX.invoke('plugin:fs|create_dir', { path: absPath, recursive: true })
    return
  } catch {}
  // 兜底：写入一个临时文件强制宿主创建父目录
  // （flymd 的 writeTextFile 会自动建父目录）
  try {
    const sep = absPath.includes('\\') ? '\\' : '/'
    await CTX.writeTextFile(absPath + sep + '.flymd-mkdir', '')
    return
  } catch (e) {
    console.warn('[theme] ensureDir fallback failed:', absPath, e)
  }
}

async function writeText(path, content) {
  await ensureDir(dirname(path))
  await CTX.writeTextFile(path, content)
}

async function readText(path) {
  if (typeof CTX.readTextFile === 'function') {
    return await CTX.readTextFile(path)
  }
  // fallback：用 readFileBinary 解码
  const bytes = await CTX.readFileBinary(path)
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes)
  }
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return s
}

async function pathExists(path) {
  try {
    return await CTX.exists(path)
  } catch {
    return false
  }
}

const ASSET_EXTS = /\.(png|jpe?g|gif|svg|webp|ico|bmp|avif|woff2?|ttf|otf|eot)$/i

async function copyFile(src, dest) {
  await ensureDir(dirname(dest))
  // 1) 优先使用 flymd 原生 API：readFileBinary + writeFileBinary
  try {
    const bytes = await CTX.readFileBinary(src)
    if (bytes && bytes.length > 0) {
      await CTX.writeFileBinary(dest, bytes)
      return true
    }
  } catch (e) {
    console.warn('[theme] copyFile native failed:', src, '->', dest, e)
  }
  // 2) Tauri fs plugin copy_file
  try {
    await CTX.invoke('plugin:fs|copy_file', { from: src, to: dest })
    return true
  } catch (e) {
    console.warn('[theme] copyFile invoke copy_file failed:', e)
  }
  // 3) 强制建目录后重试 writeFileBinary
  try {
    await CTX.writeTextFile(dirname(dest) + '/.tmp', '')
    const bytes = await CTX.readFileBinary(src)
    if (bytes && bytes.length > 0) {
      await CTX.writeFileBinary(dest, bytes)
      return true
    }
  } catch (e) {
    console.warn('[theme] copyFile mkdir-retry failed:', e)
  }
  return false
}

function resolveAssetUrl(absPath) {
  if (typeof window !== 'undefined' && window.__TAURI__) {
    const t = window.__TAURI__
    if (t.convertFileSrc) return t.convertFileSrc(absPath)
    if (t.core && t.core.convertFileSrc) return t.core.convertFileSrc(absPath)
    if (t.tauri && t.tauri.convertFileSrc) return t.tauri.convertFileSrc(absPath)
  }
  const encoded = absPath.replace(/\\/g, '/').replace(/#/g, '%23').replace(/\?/g, '%3F')
  return 'https://asset.localhost/' + encoded
}

function transformCssUrls(cssText, themeDir) {
  if (!cssText || !themeDir) return cssText
  return cssText.replace(/url\(\s*(['""]?)((?!data:|https?:|blob:|\/\/|#)[^)'""\s]+)\1\s*\)/gi, (match, quote, rawPath) => {
    const rel = rawPath.replace(/^\.\//, '')
    const abs = joinPath(themeDir, rel)
    return 'url(' + quote + resolveAssetUrl(abs) + quote + ')'
  })
}

// 已注册的 blob URL，切换主题时需要 revoke 释放内存
let activeBlobUrls = []

function revokeActiveBlobs() {
  if (typeof URL === 'undefined' || !URL.revokeObjectURL) return
  for (const u of activeBlobUrls) {
    try { URL.revokeObjectURL(u) } catch {}
  }
  activeBlobUrls = []
}

// 把 CSS 里的 url(./xxx.png) 转换成 blob: URL（webview 同源、不受 CSP/asset scope 限制）
async function resolveCssAssetsToBlobs(cssText, themeDir) {
  if (!cssText || !themeDir) return cssText
  if (typeof URL === 'undefined' || !URL.createObjectURL || typeof Blob === 'undefined') return cssText
  const re = /url\(\s*(['"]?)((?!data:|https?:|blob:|\/\/|#)[^)'"\s]+)\1\s*\)/gi
  const cache = new Map()
  // 收集所有不同的相对路径
  let m
  while ((m = re.exec(cssText)) !== null) {
    const rawPath = m[2]
    if (cache.has(rawPath)) continue
    cache.set(rawPath, null)
  }
  // 并发把每个资源读为 Blob
  const tasks = []
  for (const [rawPath] of cache) {
    const rel = rawPath.replace(/^\.\//, '')
    const abs = joinPath(themeDir, rel)
    const ext = (rel.split('.').pop() || '').toLowerCase()
    tasks.push((async () => {
      try {
        if (!(await pathExists(abs))) {
          console.warn('[theme] blob asset missing:', abs)
          return
        }
        const bytes = await CTX.readFileBinary(abs)
        if (!bytes || bytes.length === 0) return
        const blob = new Blob([bytes], { type: mimeForExt(ext) })
        const url = URL.createObjectURL(blob)
        cache.set(rawPath, url)
        activeBlobUrls.push(url)
      } catch (e) {
        console.warn('[theme] blob asset read failed:', abs, e)
      }
    })())
  }
  await Promise.all(tasks)
  // 替换
  return cssText.replace(/url\(\s*(['"]?)((?!data:|https?:|blob:|\/\/|#)[^)'"\s]+)\1\s*\)/gi, (match, quote, rawPath) => {
    const blobUrl = cache.get(rawPath)
    if (blobUrl) return 'url(' + quote + blobUrl + quote + ')'
    return match
  })
}

// 把 Uint8Array 编码成 base64 字符串
function bytesToBase64(bytes) {
  if (typeof window !== 'undefined' && window.btoa) {
    let bin = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
    }
    return window.btoa(bin)
  }
  return ''
}

function mimeForExt(ext) {
  switch ((ext || '').toLowerCase()) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'svg': return 'image/svg+xml'
    case 'webp': return 'image/webp'
    case 'ico': return 'image/x-icon'
    case 'bmp': return 'image/bmp'
    case 'avif': return 'image/avif'
    case 'woff': return 'font/woff'
    case 'woff2': return 'font/woff2'
    case 'ttf': return 'font/ttf'
    case 'otf': return 'font/otf'
    default: return 'application/octet-stream'
  }
}

// 把 CSS 里所有相对 url() 内联为 data: URI（在安装时执行一次，避免运行时依赖文件协议）
async function inlineCssAssets(cssText, sourceDir) {
  if (!cssText || !sourceDir) return cssText
  const re = /url\(\s*(['"]?)((?!data:|https?:|\/\/|#)[^)'"\s]+)\1\s*\)/gi
  const cache = new Map()
  const tasks = []
  // 收集所有相对路径
  let m
  while ((m = re.exec(cssText)) !== null) {
    const rawPath = m[2]
    if (cache.has(rawPath)) continue
    cache.set(rawPath, null)
    const rel = rawPath.replace(/^\.\//, '')
    const abs = joinPath(sourceDir, rel)
    const ext = (rel.split('.').pop() || '').toLowerCase()
    tasks.push((async () => {
      try {
        if (!(await pathExists(abs))) {
          console.warn('[theme] inlineCssAssets: missing asset', abs)
          return
        }
        const bytes = await CTX.readFileBinary(abs)
        if (!bytes || bytes.length === 0) {
          console.warn('[theme] inlineCssAssets: empty asset', abs)
          return
        }
        const b64 = bytesToBase64(bytes)
        if (!b64) return
        cache.set(rawPath, 'data:' + mimeForExt(ext) + ';base64,' + b64)
      } catch (e) {
        console.warn('[theme] inlineCssAssets read failed:', abs, e)
      }
    })())
  }
  await Promise.all(tasks)
  // 替换
  return cssText.replace(/url\(\s*(['"]?)((?!data:|https?:|\/\/|#)[^)'"\s]+)\1\s*\)/gi, (match, quote, rawPath) => {
    const dataUrl = cache.get(rawPath)
    if (dataUrl) return 'url(' + quote + dataUrl + quote + ')'
    return match
  })
}

// 删除主题目录（best-effort：先 invoke 原生 remove，失败则把 css 清空 + 索引删除）
async function removeThemeDir(themeDir) {
  try {
    await CTX.invoke('plugin:fs|remove', { path: themeDir, options: { recursive: true } })
    return
  } catch {}
  try {
    await CTX.invoke('plugin:fs|remove_dir', { path: themeDir, recursive: true })
    return
  } catch {}
  // 兜底：把 style.css 写空
  try {
    await writeText(joinPath(themeDir, 'style.css'), '')
    await writeText(joinPath(themeDir, 'theme.json'), '{}')
  } catch {}
}

// 在文件管理器中打开目录（best-effort）
async function revealInExplorer(absPath) {
  // 标准 Tauri opener 插件
  try {
    await CTX.invoke('plugin:opener|open_path', { path: absPath })
    return true
  } catch {}
  try {
    await CTX.invoke('plugin:shell|open', { path: absPath })
    return true
  } catch {}
  // flymd 自己可能挂的命令
  try {
    await CTX.invoke('flymd_open_path', { path: absPath })
    return true
  } catch {}
  return false
}

// ============================================================
// 主题根目录解析
// ============================================================
//
// 目标：%LOCALAPPDATA%\com.flymd\flymd\themes\
// 方法：用 getPluginDataDir() 反推 — 它返回
//   <AppLocalData>/flymd/plugin-data/<pluginId>/<libraryKey>/
// 我们退回三级，再追加 'themes'。

async function resolveThemesRoot() {
  // 优先：直接 invoke Tauri path 插件取 AppLocalData
  try {
    const local = await CTX.invoke('plugin:path|local_data_dir')
    if (local && typeof local === 'string') {
      return joinPath(local, 'com.flymd', 'flymd', 'themes')
    }
  } catch {}

  // 次选：通过 getPluginDataDir 推断
  if (typeof CTX.getPluginDataDir === 'function') {
    try {
      const dataDir = await CTX.getPluginDataDir()
      if (dataDir && typeof dataDir === 'string') {
        // 形如 <AppLocalData>/flymd/plugin-data/theme-manager/<libKey>/
        // 退回三级到 <AppLocalData>/flymd/，再加 themes
        const parts = String(dataDir).replace(/[\\/]+$/, '').split(/[\\/]/)
        // 删除尾部 4 段：libraryKey / pluginId / plugin-data / flymd
        // -> 不对，我们要退到含 'flymd' 的那一级
        // 正确做法：找最后一个 'flymd' 段，截到该段（含）
        let cut = -1
        for (let i = parts.length - 1; i >= 0; i--) {
          if (parts[i] === 'flymd') { cut = i; break }
        }
        if (cut > 0) {
          const head = parts.slice(0, cut + 1)
          return head.join(isWindowsPath(dataDir) ? '\\' : '/') + (isWindowsPath(dataDir) ? '\\' : '/') + 'themes'
        }
      }
    } catch {}
  }

  // 最终兜底：使用一个固定的 Windows 路径（会在非 Windows 上无效，但 flymd 主要发布桌面版）
  return 'C:/Users/Public/com.flymd/flymd/themes'
}

// ============================================================
// 主题索引（storage 中存清单，磁盘存内容）
// ============================================================

async function loadIndex() {
  const idx = await CTX.storage.get(STORAGE_KEY_INDEX)
  return idx && typeof idx === 'object' ? idx : {}
}

async function saveIndex(idx) {
  await CTX.storage.set(STORAGE_KEY_INDEX, idx || {})
}

async function loadCurrentId() {
  const id = await CTX.storage.get(STORAGE_KEY_CURRENT)
  return typeof id === 'string' && id ? id : null
}

async function saveCurrentId(id) {
  await CTX.storage.set(STORAGE_KEY_CURRENT, id || null)
}

function buildThemeDir(id) {
  return joinPath(THEMES_ROOT, id)
}

function buildThemeCssPath(id) {
  return joinPath(THEMES_ROOT, id, 'style.css')
}

function buildThemeJsonPath(id) {
  return joinPath(THEMES_ROOT, id, 'theme.json')
}

// ============================================================
// CSS 注入 / 卸载
// ============================================================

function ensureStyleTag() {
  let tag = document.getElementById(STYLE_TAG_ID)
  if (!tag) {
    tag = document.createElement('style')
    tag.id = STYLE_TAG_ID
    tag.setAttribute('type', 'text/css')
    document.head.appendChild(tag)
  }
  return tag
}

function injectCss(themeId, cssText) {
  const tag = ensureStyleTag()
  tag.setAttribute('data-theme-id', themeId || '')
  const themeDir = themeId ? buildThemeDir(themeId) : ''
  tag.textContent = themeDir ? transformCssUrls(cssText || '', themeDir) : (cssText || '')
}

function clearInjection() {
  const tag = document.getElementById(STYLE_TAG_ID)
  if (tag) {
    tag.removeAttribute('data-theme-id')
    tag.textContent = ''
  }
}

async function applyThemeById(id) {
  if (!id) {
    revokeActiveBlobs()
    clearInjection()
    await saveCurrentId(null)
    cachedCurrentId = null
    return
  }
  const idx = await loadIndex()
  if (!idx[id]) {
    if (CTX && CTX.ui) CTX.ui.notice('主题不存在：' + id, 'err')
    revokeActiveBlobs()
    clearInjection()
    await saveCurrentId(null)
    cachedCurrentId = null
    return
  }
  const cssPath = buildThemeCssPath(id)
  if (!(await pathExists(cssPath))) {
    if (CTX && CTX.ui) CTX.ui.notice('主题文件丢失：' + cssPath, 'err')
    revokeActiveBlobs()
    clearInjection()
    await saveCurrentId(null)
    cachedCurrentId = null
    return
  }
  let css = await readText(cssPath)
  // 先 revoke 上次主题的 blob，再为本次主题生成新的 blob URL
  revokeActiveBlobs()
  const themeDir = buildThemeDir(id)
  try {
    css = await resolveCssAssetsToBlobs(css, themeDir)
  } catch (e) {
    console.warn('[theme] resolveCssAssetsToBlobs failed, fallback to raw url():', e)
  }
  injectCss(id, css)
  await saveCurrentId(id)
  cachedCurrentId = id
}

// ============================================================
// 主题安装
// ============================================================

// 把一段 css + 元数据 写到 themes/<id>/，并更新索引
// 返回最终的 manifest（含 id）
async function installTheme({ rawCss, manifest, sourceLabel, overwrite }) {
  // 1) 决定 id
  const meta = parseCssMeta(rawCss || '')
  const id = (manifest && manifest.id) || meta.id ||
    slugify((manifest && manifest.name) || meta.name || sourceLabel || ('theme-' + Date.now()))

  if (!id) throw new Error('无法确定主题 id')

  // 2) 检查冲突
  const idx = await loadIndex()
  if (idx[id] && !overwrite) {
    const ok = await CTX.ui.confirm('主题 "' + id + '" 已存在，是否覆盖？')
    if (!ok) return null
  }

  // 3) 合成最终 manifest
  const finalManifest = {
    id,
    name: (manifest && manifest.name) || meta.name || id,
    version: (manifest && manifest.version) || meta.version || '0.0.1',
    author: (manifest && manifest.author) || meta.author || '',
    description: (manifest && manifest.description) || meta.description || '',
    main: 'style.css',
    source: sourceLabel || '',
    installedAt: new Date().toISOString(),
  }

  // 4) 准备 css：补元数据头（如果原文没有）
  let cssOut = rawCss || ''
  if (!parseCssMeta(cssOut).id) {
    cssOut = buildHeaderComment(finalManifest) + cssOut
  }

  // 5) 写入磁盘
  const dir = buildThemeDir(id)
  await ensureDir(dir)
  await writeText(buildThemeJsonPath(id), JSON.stringify(finalManifest, null, 2))
  await writeText(buildThemeCssPath(id), cssOut)

  // 6) 更新索引
  idx[id] = {
    name: finalManifest.name,
    author: finalManifest.author,
    version: finalManifest.version,
    description: finalManifest.description,
    source: finalManifest.source,
    installedAt: finalManifest.installedAt,
  }
  await saveIndex(idx)

  return finalManifest
}

async function uninstallTheme(id) {
  const idx = await loadIndex()
  if (!idx[id]) return false
  const dir = buildThemeDir(id)
  await removeThemeDir(dir)
  delete idx[id]
  await saveIndex(idx)
  // 如果删除的就是当前主题，清空注入
  const cur = await loadCurrentId()
  if (cur === id) {
    clearInjection()
    await saveCurrentId(null)
  }
  return true
}

// ============================================================
// 三种来源的安装
// ============================================================

async function installFromUrl(url) {
  if (!url) throw new Error('URL 为空')

  // GitHub 页面 URL 自动路由到 GitHub 安装逻辑
  if (/^https?:\/\/github\.com\//i.test(url)) {
    return await installFromGithub(url)
  }

  const lower = url.toLowerCase()

  // 如果 URL 以 .json 结尾或包含 theme.json：先按 manifest 处理
  if (/\.json($|\?)/.test(lower)) {
    const jsonText = await fetchText(url)
    let manifest
    try { manifest = JSON.parse(jsonText) } catch (e) { throw new Error('manifest JSON 解析失败：' + e.message) }
    if (!manifest || typeof manifest !== 'object') throw new Error('manifest 不是对象')
    const mainPath = manifest.main || 'style.css'
    const baseUrl = url.replace(/[^/]*$/, '') // 同目录
    const cssUrl = /^https?:/i.test(mainPath) ? mainPath : baseUrl + mainPath
    const cssText = await fetchText(cssUrl)
    return await installTheme({ rawCss: cssText, manifest, sourceLabel: 'url:' + url })
  }

  // 否则当作 css 文件
  const cssText = await fetchText(url)
  return await installTheme({ rawCss: cssText, sourceLabel: 'url:' + url })
}

async function installFromGithub(input) {
  const g = parseGithubInput(input)
  if (!g) throw new Error('GitHub 输入格式无法识别：' + input)

  const branches = g.branch ? [g.branch] : ['main', 'master']

  // 有明确子路径时，从该子目录安装
  if (g.path) {
    return await installFromGithubPath(g, branches)
  }

  // 1) 尝试根目录 theme.json
  let r = await fetchFromBranches(g, 'theme.json', branches)
  if (r) {
    let manifest
    try { manifest = JSON.parse(r.text) } catch (e) { throw new Error('theme.json 解析失败：' + e.message) }
    const mainRel = manifest.main || 'style.css'
    const cssUrl = rawUrl(g, mainRel, r.branch)
    const cssText = await fetchText(cssUrl)
    return await installTheme({
      rawCss: cssText,
      manifest,
      sourceLabel: 'github:' + g.owner + '/' + g.repo + (g.branch ? '@' + g.branch : ''),
    })
  }

  // 2) 回退到根目录 css 文件
  for (const p of ['theme.css', 'style.css']) {
    r = await fetchFromBranches(g, p, branches)
    if (r) {
      return await installTheme({
        rawCss: r.text,
        sourceLabel: 'github:' + g.owner + '/' + g.repo + '@' + r.branch + '/' + p,
      })
    }
  }

  // 3) 根目录无主题文件，尝试发现子目录中的主题并批量安装
  const discovered = await discoverGithubThemes(g, branches)
  if (discovered && discovered.themes.length > 0) {
    const names = discovered.themes.map(t => '  · ' + t.name)
    const ok = await CTX.ui.confirm(
      '在仓库中发现 ' + discovered.themes.length + ' 个主题，是否全部安装？\n' + names.join('\n')
    )
    if (!ok) return null

    let lastInstalled = null
    for (const theme of discovered.themes) {
      try {
        lastInstalled = await installTheme({
          rawCss: theme.css,
          manifest: theme.manifest,
          sourceLabel: 'github:' + g.owner + '/' + g.repo + '@' + discovered.branch + '/' + theme.path,
        })
        if (lastInstalled) CTX.ui.notice('已安装：' + lastInstalled.name, 'ok')
      } catch (e) {
        CTX.ui.notice('跳过 ' + theme.name + '：' + (e.message || String(e)), 'err', 3000)
      }
    }
    return lastInstalled
  }

  throw new Error('未在仓库中找到 theme.json / theme.css / style.css，也未发现子目录主题')
}

// 从 GitHub 仓库的指定子路径安装单个主题
async function installFromGithubPath(g, branches) {
  const path = g.path.replace(/\/$/, '')

  // 如果 path 直接指向文件
  if (/\.json($|\?)/i.test(path)) {
    const r = await fetchFromBranches(g, path, branches)
    if (r) {
      let manifest
      try { manifest = JSON.parse(r.text) } catch (e) { throw new Error('theme.json 解析失败：' + e.message) }
      const dir = path.replace(/[^/]*$/, '')
      const mainRel = manifest.main || 'style.css'
      const cssUrl = rawUrl(g, dir + mainRel, r.branch)
      const cssText = await fetchText(cssUrl)
      return await installTheme({
        rawCss: cssText, manifest,
        sourceLabel: 'github:' + g.owner + '/' + g.repo + '@' + r.branch + '/' + path,
      })
    }
  }
  if (/\.css($|\?)/i.test(path)) {
    const r = await fetchFromBranches(g, path, branches)
    if (r) {
      return await installTheme({
        rawCss: r.text,
        sourceLabel: 'github:' + g.owner + '/' + g.repo + '@' + r.branch + '/' + path,
      })
    }
  }

  // path 是子目录：在其中查找主题文件
  let r = await fetchFromBranches(g, path + '/theme.json', branches)
  if (r) {
    let manifest
    try { manifest = JSON.parse(r.text) } catch (e) { throw new Error('theme.json 解析失败：' + e.message) }
    const mainRel = manifest.main || 'style.css'
    const cssUrl = rawUrl(g, path + '/' + mainRel, r.branch)
    const cssText = await fetchText(cssUrl)
    return await installTheme({
      rawCss: cssText, manifest,
      sourceLabel: 'github:' + g.owner + '/' + g.repo + '@' + r.branch + '/' + path,
    })
  }

  for (const cssName of ['theme.css', 'style.css']) {
    r = await fetchFromBranches(g, path + '/' + cssName, branches)
    if (r) {
      return await installTheme({
        rawCss: r.text,
        sourceLabel: 'github:' + g.owner + '/' + g.repo + '@' + r.branch + '/' + path + '/' + cssName,
      })
    }
  }

  throw new Error('未在 ' + path + '/ 中找到 theme.json / theme.css / style.css')
}

// 用 GitHub Contents API 发现仓库中子目录里的主题
async function discoverGithubThemes(g, branches) {
  for (const branch of branches) {
    const apiUrl = 'https://api.github.com/repos/' + g.owner + '/' + g.repo + '/contents/?ref=' + branch
    const listText = await fetchTextOrNull(apiUrl)
    if (!listText) continue

    let items
    try { items = JSON.parse(listText) } catch { continue }
    if (!Array.isArray(items)) continue

    const dirs = items.filter(i => i.type === 'dir')
    if (dirs.length === 0) continue

    const themes = []
    for (const dir of dirs) {
      const jsonUrl = rawUrl(g, dir.name + '/theme.json', branch)
      const jsonText = await fetchTextOrNull(jsonUrl)
      if (jsonText) {
        let manifest
        try { manifest = JSON.parse(jsonText) } catch { continue }
        const mainRel = manifest.main || 'style.css'
        const cssUrl = rawUrl(g, dir.name + '/' + mainRel, branch)
        const cssText = await fetchTextOrNull(cssUrl)
        if (cssText) {
          themes.push({
            name: manifest.name || manifest.id || dir.name,
            path: dir.name,
            manifest,
            css: cssText,
          })
        }
        continue
      }
      // 没有 theme.json，尝试 css 文件
      for (const cssName of ['theme.css', 'style.css']) {
        const cssUrl = rawUrl(g, dir.name + '/' + cssName, branch)
        const cssText = await fetchTextOrNull(cssUrl)
        if (cssText) {
          const meta = parseCssMeta(cssText)
          themes.push({
            name: meta.name || dir.name,
            path: dir.name,
            manifest: meta.id ? meta : null,
            css: cssText,
          })
          break
        }
      }
    }

    if (themes.length > 0) return { themes, branch }
  }
  return null
}

async function copyThemeAssets(sourceDir, themeId) {
  if (!sourceDir || !themeId) return
  const destDir = buildThemeDir(themeId)
  console.log('[theme] copyThemeAssets:', sourceDir, '->', destDir)
  const stats = { copied: 0, failed: 0, skipped: 0 }
  await copyDirAssets(sourceDir, destDir, stats)
  console.log('[theme] copyThemeAssets done:', stats)
  if (CTX && CTX.ui && stats.failed > 0) {
    CTX.ui.notice('主题资源复制：' + stats.copied + ' 成功 / ' + stats.failed + ' 失败', 'warn', 5000)
  }
}

async function copyDirAssets(srcDir, destDir, stats) {
  const entries = await listDirEntries(srcDir)
  if (!entries || entries.length === 0) {
    console.warn('[theme] copyDirAssets: empty or unreadable dir:', srcDir)
    return
  }
  for (const entry of entries) {
    const name = entry.name || String(entry)
    if (name === '.' || name === '..') continue
    const srcPath = joinPath(srcDir, name)
    const destPath = joinPath(destDir, name)
    if (ASSET_EXTS.test(name)) {
      const ok = await copyFile(srcPath, destPath)
      if (stats) {
        if (ok) stats.copied++
        else stats.failed++
      }
    } else if (entry.isDir || (!name.includes('.') && name !== 'node_modules')) {
      await copyDirAssets(srcPath, destPath, stats)
    } else if (stats) {
      stats.skipped++
    }
  }
}

async function installFromLocal(absPath) {
  if (!absPath) throw new Error('未提供文件路径')
  if (!(await pathExists(absPath))) throw new Error('路径不存在：' + absPath)

  const isDir = await detectDirectory(absPath)
  if (isDir) {
    return await installFromLocalDir(absPath)
  }

  const sourceDir = dirname(absPath)

  if (/\.json$/i.test(absPath)) {
    const jsonText = await readText(absPath)
    let manifest
    try { manifest = JSON.parse(jsonText) } catch (e) { throw new Error('theme.json 解析失败：' + e.message) }
    const mainRel = manifest.main || 'style.css'
    const cssAbs = /^([a-zA-Z]:[\\\/]|\/)/.test(mainRel) ? mainRel : joinPath(sourceDir, mainRel)
    if (!(await pathExists(cssAbs))) throw new Error('main 指向的 css 不存在：' + cssAbs)
    const cssText = await readText(cssAbs)
    const result = await installTheme({ rawCss: cssText, manifest, sourceLabel: 'local:' + absPath })
    if (result) await copyThemeAssets(sourceDir, result.id)
    return result
  }

  const cssText = await readText(absPath)
  const fname = basename(absPath).replace(/\.css$/i, '')
  const meta = parseCssMeta(cssText)
  const result = await installTheme({
    rawCss: cssText,
    manifest: { name: meta.name || fname, id: meta.id || slugify(fname) },
    sourceLabel: 'local:' + absPath,
  })
  if (result) await copyThemeAssets(sourceDir, result.id)
  return result
}

// 从目录安装主题（支持单主题目录和包含多个主题的目录）
async function installFromLocalDir(dirPath) {
  // 1) 优先查找固定入口文件
  const fixedCandidates = ['theme.json', 'theme.css', 'style.css']
  for (const name of fixedCandidates) {
    const p = joinPath(dirPath, name)
    if (await pathExists(p)) {
      return await installFromLocal(p)
    }
  }

  // 2) 尝试列出目录内容，查找所有 .css 文件和含 theme.json 的子目录
  const entries = await listDirEntries(dirPath)

  if (entries && entries.length > 0) {
    const cssFiles = []
    const themeDirs = []

    for (const entry of entries) {
      const fullPath = joinPath(dirPath, entry.name || entry)
      const name = entry.name || entry

      // 检查是否为 .css 文件
      if (/\.css$/i.test(name)) {
        cssFiles.push(fullPath)
      }
      // 检查子目录是否含 theme.json
      if (entry.isDir || (!name.includes('.') && name !== '.' && name !== '..')) {
        const subJson = joinPath(fullPath, 'theme.json')
        if (await pathExists(subJson)) {
          themeDirs.push(fullPath)
        } else {
          // 也检查子目录中的 css
          for (const fallback of ['theme.css', 'style.css']) {
            if (await pathExists(joinPath(fullPath, fallback))) {
              themeDirs.push(fullPath)
              break
            }
          }
        }
      }
    }

    const allThemes = [...themeDirs, ...cssFiles]

    if (allThemes.length === 0) {
      throw new Error('目录中未找到任何主题文件（.css 或含 theme.json 的子目录）')
    }

    if (allThemes.length === 1) {
      return await installFromLocal(allThemes[0])
    }

    // 多个主题：批量安装
    const ok = await CTX.ui.confirm(
      '在目录中发现 ' + allThemes.length + ' 个主题，是否全部安装？\n'
      + allThemes.map(p => '  · ' + basename(p)).join('\n')
    )
    if (!ok) return null

    let lastInstalled = null
    for (const p of allThemes) {
      try {
        lastInstalled = await installFromLocal(p)
        CTX.ui.notice('已安装：' + (lastInstalled ? lastInstalled.name : basename(p)), 'ok')
      } catch (e) {
        CTX.ui.notice('跳过 ' + basename(p) + '：' + (e.message || String(e)), 'err', 3000)
      }
    }
    return lastInstalled
  }

  // 3) 无法列目录时，尝试常见文件名模式
  const guessNames = ['index.css', 'main.css', basename(dirPath) + '.css']
  for (const name of guessNames) {
    const p = joinPath(dirPath, name)
    if (await pathExists(p)) {
      return await installFromLocal(p)
    }
  }

  throw new Error('目录中未找到主题文件。请确保目录内有 theme.json、*.css 文件或含主题的子目录')
}

// 尝试列出目录内容（best-effort，依赖 Tauri 原生命令）
async function listDirEntries(dirPath) {
  // Tauri v2 fs plugin
  try {
    const entries = await CTX.invoke('plugin:fs|read_dir', { path: dirPath })
    if (Array.isArray(entries)) return entries
  } catch (e) {
    console.warn('[theme] listDirEntries plugin:fs|read_dir failed:', dirPath, e)
  }
  // Tauri v1 style
  try {
    const entries = await CTX.invoke('plugin:fs|readDir', { dir: dirPath, recursive: false })
    if (Array.isArray(entries)) return entries
  } catch (e) {
    console.warn('[theme] listDirEntries plugin:fs|readDir failed:', e)
  }
  // flymd 自有命令
  try {
    const entries = await CTX.invoke('flymd_read_dir', { path: dirPath })
    if (Array.isArray(entries)) return entries
  } catch (e) {
    console.warn('[theme] listDirEntries flymd_read_dir failed:', e)
  }
  return null
}

// 判断路径是否为目录（通过尝试读取子文件来推断）
async function detectDirectory(absPath) {
  // 如果路径有明确的文件扩展名，认为是文件
  const ext = basename(absPath).split('.').pop()
  if (/^(css|json|txt|md)$/i.test(ext) && basename(absPath).includes('.')) return false
  // 尝试在路径下查找 theme.json 或 style.css 来判断是否为目录
  for (const name of ['theme.json', 'theme.css', 'style.css']) {
    if (await pathExists(joinPath(absPath, name))) return true
  }
  // 兜底：尝试 invoke 判断
  try {
    const meta = await CTX.invoke('plugin:fs|metadata', { path: absPath })
    if (meta && meta.isDir) return true
    if (meta && meta.isFile) return false
  } catch {}
  // 如果路径末尾没有扩展名，倾向于认为是目录
  if (!basename(absPath).includes('.')) return true
  return false
}


// ============================================================
// 原生文件/目录选择器（best-effort）
// ============================================================

async function pickLocalThemeFile() {
  // 优先弹出目录选择器（选择整个主题目录）
  const dir = await pickDirectory()
  if (dir) return dir

  // 回退到文件选择器
  const filters = [
    { name: 'Theme', extensions: ['css', 'json'] },
    { name: 'CSS', extensions: ['css'] },
    { name: 'JSON', extensions: ['json'] },
  ]
  try {
    const r = await CTX.invoke('plugin:dialog|open', {
      options: { multiple: false, directory: false, filters },
    })
    if (typeof r === 'string') return r
    if (r && typeof r === 'object' && r.path) return r.path
    if (Array.isArray(r) && r.length > 0) return r[0]
  } catch {}
  try {
    const r = await CTX.invoke('flymd_pick_file', { extensions: ['css', 'json'] })
    if (typeof r === 'string') return r
  } catch {}
  return null
}

async function pickDirectory() {
  try {
    const r = await CTX.invoke('plugin:dialog|open', {
      options: { multiple: false, directory: true },
    })
    if (typeof r === 'string') return r
    if (r && typeof r === 'object' && r.path) return r.path
    if (Array.isArray(r) && r.length > 0) return r[0]
  } catch {}
  try {
    const r = await CTX.invoke('plugin:dialog|open_directory', {})
    if (typeof r === 'string') return r
  } catch {}
  return null
}

// ============================================================
// 顶栏菜单
// ============================================================

async function buildMenuChildren() {
  const idx = await loadIndex()
  const cur = await loadCurrentId()
  const ids = Object.keys(idx).sort()

  const children = [
    {
      label: '默认（无自定义主题）',
      onClick: async () => {
        await applyThemeById(null)
        CTX.ui.notice('已切换到默认主题', 'ok')
      },
    },
  ]

  for (const id of ids) {
    const meta = idx[id]
    children.push({
      label: meta.name || id,
      note: meta.version ? 'v' + meta.version : '',
      onClick: async () => {
        try {
          await applyThemeById(id)
          CTX.ui.notice('已应用：' + (meta.name || id), 'ok')
        } catch (e) {
          CTX.ui.notice('应用失败：' + (e && e.message ? e.message : String(e)), 'err')
        }
      },
    })
  }

  children.push(
    { type: 'divider' },
    { type: 'group', label: '安装' },
    { label: '来自 URL...', onClick: () => promptInstallUrl() },
    { label: '来自 GitHub...', onClick: () => promptInstallGithub() },
    { label: '来自本地目录/文件...', onClick: () => promptInstallLocal() },
    { type: 'divider' },
    { label: '管理主题...', onClick: () => openSettings(CTX) },
    {
      label: '打开主题目录',
      onClick: async () => {
        await ensureDir(THEMES_ROOT)
        const ok = await revealInExplorer(THEMES_ROOT)
        if (!ok) CTX.ui.notice('主题目录：' + THEMES_ROOT, 'ok', 4000)
      },
    },
  )

  return children
}

// ============================================================
// 菜单弹层观察器：在不重建菜单的前提下，给当前主题项打 ✓
// ============================================================
//
// flymd 的 addMenuItem 在 onClick 后立刻 remove+add 重建会导致下拉消失，
// 所以菜单注册一次就不动。当用户点开下拉时，弹层 DOM 临时出现在 body 下，
// 我们通过 MutationObserver 监听这次插入，找到属于本插件的弹层（用稀有
// 标签文本识别），再修改对应主题项的 textContent 加上 ✓。

const MENU_FINGERPRINTS = ['来自 GitHub...', '打开主题目录']
const MARKED_ATTR = 'data-fmtm-marked'
const CHECKED_ATTR = 'data-fmtm-checked'

function startMenuObserver() {
  if (menuObserver || typeof MutationObserver === 'undefined') return
  menuObserver = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node && node.nodeType === 1) {
          tryMarkOurMenu(node)
        }
      }
    }
  })
  menuObserver.observe(document.body, { childList: true, subtree: true })
}

function stopMenuObserver() {
  if (menuObserver) {
    try { menuObserver.disconnect() } catch {}
    menuObserver = null
  }
}

function tryMarkOurMenu(root) {
  if (!root || root.nodeType !== 1) return
  const text = root.textContent || ''
  for (const f of MENU_FINGERPRINTS) {
    if (!text.includes(f)) return
  }

  const syncedVer = root.getAttribute('data-fmtm-ver')
  if (syncedVer === String(menuVersion)) {
    return
  }
  root.setAttribute('data-fmtm-ver', String(menuVersion))
  root.setAttribute(MARKED_ATTR, '1')

  ;(async () => {
    try {
      await syncMenuThemeItems(root)
    } catch (e) {
      console.warn('[theme-manager] sync menu failed:', e)
    }
  })()
}

async function syncMenuThemeItems(container) {
  const idx = await loadIndex()
  const cur = cachedCurrentId || (await loadCurrentId())
  const ids = Object.keys(idx).sort()

  const DEFAULT_LABEL = '默认（无自定义主题）'

  // 找到所有可点击的菜单项元素
  const allItems = container.querySelectorAll('[class*="item"], [role="menuitem"], li, div')
  let itemEls = []
  const tw = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null)
  let tn
  const textToEl = new Map()
  while ((tn = tw.nextNode())) {
    const nv = (tn.nodeValue || '').trim().replace(/ ✓$/, '')
    if (!nv) continue
    const el = tn.parentElement
    if (el && !textToEl.has(nv)) textToEl.set(nv, el)
  }

  // 找到"默认"项的容器元素（作为模板和定位锚点）
  const defaultEl = textToEl.get(DEFAULT_LABEL)
  if (!defaultEl) return

  // 获取菜单项的容器层级：向上找到最近的包含多个兄弟的父元素
  let itemNode = defaultEl
  while (itemNode.parentElement && itemNode.parentElement !== container) {
    const siblings = itemNode.parentElement.children
    if (siblings.length > 1) break
    itemNode = itemNode.parentElement
  }
  const itemParent = itemNode.parentElement
  if (!itemParent) return

  // 收集当前 DOM 中的主题项（从"默认"之后到第一个分割线之前）
  const existingItems = []
  let foundDefault = false
  for (const child of Array.from(itemParent.children)) {
    if (child === itemNode || child.contains(defaultEl)) { foundDefault = true; continue }
    if (!foundDefault) continue
    const childText = (child.textContent || '').trim()
    if (!childText || child.querySelector('hr, [class*="divider"], [class*="separator"]') || child.getAttribute('role') === 'separator') break
    if (childText === '安装' || childText.startsWith('来自')) break
    existingItems.push(child)
  }

  // 计算需要添加和删除的主题
  const existingLabels = new Set(existingItems.map(el => (el.textContent || '').trim().replace(/ ✓$/, '').replace(/v[\d.]+$/, '').trim()))
  const wantedLabels = new Map(ids.map(id => [(idx[id].name || id), id]))

  // 删除不存在的主题项
  for (const el of existingItems) {
    const label = (el.textContent || '').trim().replace(/ ✓$/, '').replace(/v[\d.]+$/, '').trim()
    if (!wantedLabels.has(label)) {
      el.remove()
    }
  }

  // 添加新主题项
  let insertAfter = itemNode
  for (const child of Array.from(itemParent.children)) {
    if (child === itemNode || child.contains(defaultEl)) { insertAfter = child; continue }
    const ct = (child.textContent || '').trim().replace(/ ✓$/, '').replace(/v[\d.]+$/, '').trim()
    if (wantedLabels.has(ct)) { insertAfter = child; continue }
    break
  }

  for (const id of ids) {
    const name = idx[id].name || id
    if (existingLabels.has(name)) continue
    const newItem = itemNode.cloneNode(true)
    // 替换文本内容
    const ntw = document.createTreeWalker(newItem, NodeFilter.SHOW_TEXT, null)
    let firstText = null
    while ((firstText = ntw.nextNode())) {
      if ((firstText.nodeValue || '').trim()) { firstText.nodeValue = name; break }
    }
    // 添加点击事件
    newItem.style.cursor = 'pointer'
    newItem.addEventListener('click', async (e) => {
      e.stopPropagation()
      try {
        await applyThemeById(id)
        CTX.ui.notice('已应用：' + name, 'ok')
      } catch (err) {
        CTX.ui.notice('应用失败：' + (err.message || String(err)), 'err')
      }
    })
    insertAfter.after(newItem)
    insertAfter = newItem
  }

  // 给当前主题打 ✓
  const targetLabel = (cur && idx[cur]) ? (idx[cur].name || cur) : DEFAULT_LABEL
  markMenuItemByLabel(container, targetLabel)
}

function markMenuItemByLabel(container, label) {
  if (!container || !label) return
  const target = String(label).trim()
  if (!target) return

  // 用 SHOW_TEXT 走文本节点：自定义主题的菜单项含 note（v1.0.0），
  // label 通常被 flymd 渲染到独立的 span 里，按文本节点匹配最稳。
  // 把 ✓ 直接前置到文本节点 nodeValue，避免追加 span 在窄菜单里换行。
  const tw = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null)
  let tn
  while ((tn = tw.nextNode())) {
    const nv = tn.nodeValue || ''
    if (nv.trim() !== target) continue
    const parent = tn.parentElement
    if (!parent) continue
    if (parent.getAttribute(CHECKED_ATTR) === '1') return
    tn.nodeValue = nv + ' ✓'
    parent.setAttribute(CHECKED_ATTR, '1')
    return
  }
}

async function rebuildMenu() {
  // 防止并发重建
  if (rebuildingMenu) {
    console.warn('[theme-manager] rebuildMenu already in progress, skipping')
    return
  }
  rebuildingMenu = true

  try {
    // 构建新菜单
    const children = await buildMenuChildren()
    if (!children || !Array.isArray(children) || children.length === 0) {
      console.error('[theme-manager] buildMenuChildren returned empty or invalid data')
      // 即使出错也要添加一个基础菜单
      removeMenuItem = CTX.addMenuItem({
        label: '主题',
        title: '主题管理器',
        children: [
          { label: '管理主题...', onClick: () => openSettings(CTX) },
        ],
      })
      return
    }

    // 添加新菜单
    removeMenuItem = CTX.addMenuItem({
      label: '主题',
      title: '主题管理器',
      children,
    })
  } catch (e) {
    console.error('[theme-manager] rebuildMenu failed:', e)
    // 确保即使出错也有一个可用的菜单
    try {
      removeMenuItem = CTX.addMenuItem({
        label: '主题',
        title: '主题管理器',
        children: [
          { label: '管理主题...', onClick: () => openSettings(CTX) },
        ],
      })
    } catch (e2) {
      console.error('[theme-manager] Failed to add fallback menu:', e2)
    }
  } finally {
    rebuildingMenu = false
  }
}

// ============================================================
// 简易输入对话框（fallback 用 window.prompt）
// ============================================================

async function promptInstallUrl() {
  const v = await uiPrompt('输入主题 URL', '主题文件 URL（.css 或 theme.json）：')
  if (!v) return
  try {
    const m = await installFromUrl(v.trim())
    if (m) {
      CTX.ui.notice('已安装：' + m.name, 'ok')
      const ok = await CTX.ui.confirm('立即应用 "' + m.name + '" 吗？')
      if (ok) await applyThemeById(m.id)
      menuVersion++
    }
  } catch (e) {
    CTX.ui.notice('安装失败：' + (e && e.message ? e.message : String(e)), 'err', 4000)
  }
}

async function promptInstallGithub() {
  const v = await uiPrompt('从 GitHub 安装主题', '输入 user/repo 或 user/repo@branch 或完整 GitHub URL：')
  if (!v) return
  try {
    const m = await installFromGithub(v.trim())
    if (m) {
      CTX.ui.notice('已安装：' + m.name, 'ok')
      const ok = await CTX.ui.confirm('立即应用 "' + m.name + '" 吗？')
      if (ok) await applyThemeById(m.id)
      menuVersion++
    }
  } catch (e) {
    CTX.ui.notice('安装失败：' + (e && e.message ? e.message : String(e)), 'err', 4000)
  }
}

async function promptInstallLocal() {
  let p = await pickLocalThemeFile()
  if (!p) p = await uiPrompt('从本地安装主题', '请输入主题目录或文件的绝对路径：')
  if (!p) return
  try {
    const m = await installFromLocal(String(p).trim())
    if (m) {
      CTX.ui.notice('已安装：' + m.name, 'ok')
      const ok = await CTX.ui.confirm('立即应用 "' + m.name + '" 吗？')
      if (ok) await applyThemeById(m.id)
      menuVersion++
    }
  } catch (e) {
    CTX.ui.notice('安装失败：' + (e && e.message ? e.message : String(e)), 'err', 4000)
  }
}

// ============================================================
// 自建 prompt（flymd 没有 ui.prompt，用 modal 实现）
// ============================================================

function uiPrompt(title, label, defaultValue) {
  return new Promise((resolve) => {
    const old = document.getElementById('flymd-theme-prompt-overlay')
    if (old) old.remove()

    const overlay = document.createElement('div')
    overlay.id = 'flymd-theme-prompt-overlay'
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '100000',
      background: 'rgba(0,0,0,0.4)', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
    })
    const dlg = document.createElement('div')
    Object.assign(dlg.style, {
      width: '420px', maxWidth: '92vw', background: 'var(--bg, #fff)',
      color: 'var(--fg, #111)', borderRadius: '10px',
      boxShadow: '0 10px 40px rgba(0,0,0,0.25)', padding: '16px 18px',
      fontSize: '14px', fontFamily: 'inherit',
    })
    dlg.innerHTML = ''
      + '<div style="font-weight:600;font-size:15px;margin-bottom:10px">' + escHtml(title) + '</div>'
      + '<div style="margin-bottom:8px;color:#666">' + escHtml(label) + '</div>'
      + '<input id="ftp-input" type="text" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px" />'
      + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">'
      +   '<button id="ftp-cancel" style="padding:6px 14px;border:1px solid #ccc;background:#fafafa;border-radius:6px;cursor:pointer">取消</button>'
      +   '<button id="ftp-ok" style="padding:6px 14px;border:none;background:#3b82f6;color:#fff;border-radius:6px;cursor:pointer">确定</button>'
      + '</div>'
    overlay.appendChild(dlg)
    document.body.appendChild(overlay)

    const input = dlg.querySelector('#ftp-input')
    if (defaultValue) input.value = String(defaultValue)
    setTimeout(() => input.focus(), 0)
    const close = (val) => { overlay.remove(); resolve(val) }
    dlg.querySelector('#ftp-cancel').onclick = () => close(null)
    dlg.querySelector('#ftp-ok').onclick = () => close(input.value)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value)
      if (e.key === 'Escape') close(null)
    })
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null) })
  })
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// ============================================================
// 设置面板：主题管理 modal
// ============================================================

async function renderSettingsPanel() {
  const old = document.getElementById('flymd-theme-settings-overlay')
  if (old) old.remove()

  const overlay = document.createElement('div')
  overlay.id = 'flymd-theme-settings-overlay'
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '100000',
    background: 'rgba(0,0,0,0.4)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  })

  const dlg = document.createElement('div')
  Object.assign(dlg.style, {
    width: '640px', maxWidth: '95vw', maxHeight: '85vh',
    background: 'var(--bg, #fff)', color: 'var(--fg, #111)',
    borderRadius: '10px', boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    fontFamily: 'inherit', fontSize: '14px',
  })

  dlg.innerHTML = ''
    + '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(0,0,0,0.08)">'
    +   '<div style="font-weight:600;font-size:16px">主题管理</div>'
    +   '<button id="fts-close" style="background:none;border:none;font-size:20px;cursor:pointer;color:inherit">×</button>'
    + '</div>'
    + '<div id="fts-body" style="padding:14px 18px;overflow:auto;flex:1"></div>'

  overlay.appendChild(dlg)
  document.body.appendChild(overlay)

  dlg.querySelector('#fts-close').onclick = () => overlay.remove()
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })

  const body = dlg.querySelector('#fts-body')
  await fillSettingsBody(body, () => fillSettingsBody(body))
}

async function fillSettingsBody(body, refresh) {
  if (!refresh) refresh = () => fillSettingsBody(body, refresh)
  const idx = await loadIndex()
  const cur = await loadCurrentId()
  const ids = Object.keys(idx).sort()

  // 1) 当前主题下拉
  let html = ''
  html += '<div style="margin-bottom:14px">'
  html += '  <label style="display:block;margin-bottom:6px;color:#666">当前主题</label>'
  html += '  <select id="fts-current" style="width:100%;padding:8px 10px;border:1px solid #ccc;border-radius:6px;background:transparent;color:inherit;font-size:13px">'
  html += '    <option value="">默认（无自定义主题）' + (cur ? '' : '  ✓') + '</option>'
  for (const id of ids) {
    const m = idx[id]
    const sel = cur === id ? ' selected' : ''
    html += '    <option value="' + escHtml(id) + '"' + sel + '>' + escHtml(m.name || id) + '</option>'
  }
  html += '  </select>'
  html += '</div>'

  // 2) 已安装列表
  html += '<div style="margin-bottom:14px">'
  html += '  <div style="color:#666;margin-bottom:6px">已安装主题（' + ids.length + '）</div>'
  if (ids.length === 0) {
    html += '  <div style="padding:14px;border:1px dashed #ccc;border-radius:6px;color:#888;text-align:center">暂无主题，使用下方表单安装一个吧</div>'
  } else {
    html += '  <div style="display:flex;flex-direction:column;gap:8px">'
    for (const id of ids) {
      const m = idx[id]
      html += '<div style="border:1px solid rgba(0,0,0,0.08);border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:10px">'
      html += '  <div style="flex:1;min-width:0">'
      html += '    <div style="font-weight:600">' + escHtml(m.name || id)
        + (cur === id ? ' <span style="color:#10b981;font-weight:500;font-size:12px">[已应用]</span>' : '')
        + '</div>'
      html += '    <div style="color:#888;font-size:12px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
        + escHtml(id) + (m.version ? ' · v' + escHtml(m.version) : '')
        + (m.author ? ' · ' + escHtml(m.author) : '')
        + '</div>'
      if (m.description) {
        html += '    <div style="color:#666;font-size:12px;margin-top:4px">' + escHtml(m.description) + '</div>'
      }
      if (m.source) {
        html += '    <div style="color:#aaa;font-size:11px;margin-top:2px">来源：' + escHtml(m.source) + '</div>'
      }
      html += '  </div>'
      html += '  <div style="display:flex;gap:6px">'
      html += '    <button data-act="apply" data-id="' + escHtml(id) + '" style="padding:5px 10px;border:1px solid #3b82f6;color:#3b82f6;background:transparent;border-radius:5px;cursor:pointer;font-size:12px">应用</button>'
      html += '    <button data-act="open" data-id="' + escHtml(id) + '" style="padding:5px 10px;border:1px solid #ccc;background:transparent;border-radius:5px;cursor:pointer;font-size:12px;color:inherit">目录</button>'
      html += '    <button data-act="del"   data-id="' + escHtml(id) + '" style="padding:5px 10px;border:1px solid #ef4444;color:#ef4444;background:transparent;border-radius:5px;cursor:pointer;font-size:12px">删除</button>'
      html += '  </div>'
      html += '</div>'
    }
    html += '  </div>'
  }
  html += '</div>'

  // 3) 安装表单
  html += '<div style="border-top:1px solid rgba(0,0,0,0.08);padding-top:14px">'
  html += '  <div style="color:#666;margin-bottom:8px">安装新主题</div>'

  // URL
  html += '  <div style="display:flex;gap:6px;margin-bottom:8px">'
  html += '    <input id="fts-url" type="text" placeholder="https://example.com/theme.css 或 .../theme.json" style="flex:1;padding:8px 10px;border:1px solid #ccc;border-radius:6px;background:transparent;color:inherit;font-size:13px" />'
  html += '    <button id="fts-url-go" style="padding:6px 14px;border:none;background:#3b82f6;color:#fff;border-radius:6px;cursor:pointer">URL 安装</button>'
  html += '  </div>'

  // GitHub
  html += '  <div style="display:flex;gap:6px;margin-bottom:8px">'
  html += '    <input id="fts-gh" type="text" placeholder="user/repo 或 user/repo@branch" style="flex:1;padding:8px 10px;border:1px solid #ccc;border-radius:6px;background:transparent;color:inherit;font-size:13px" />'
  html += '    <button id="fts-gh-go" style="padding:6px 14px;border:none;background:#10b981;color:#fff;border-radius:6px;cursor:pointer">GitHub 安装</button>'
  html += '  </div>'

  // Local
  html += '  <div style="display:flex;gap:6px;margin-bottom:8px">'
  html += '    <input id="fts-local" type="text" placeholder="主题目录或文件的绝对路径" style="flex:1;padding:8px 10px;border:1px solid #ccc;border-radius:6px;background:transparent;color:inherit;font-size:13px" />'
  html += '    <button id="fts-local-pick" style="padding:6px 12px;border:1px solid #ccc;background:transparent;border-radius:6px;cursor:pointer;color:inherit">选择目录...</button>'
  html += '    <button id="fts-local-go"   style="padding:6px 14px;border:none;background:#8b5cf6;color:#fff;border-radius:6px;cursor:pointer">本地安装</button>'
  html += '  </div>'

  html += '  <div style="margin-top:10px;color:#888;font-size:12px">主题数据目录：' + escHtml(THEMES_ROOT) + '</div>'
  html += '</div>'


  body.innerHTML = html
  // 绑定事件
  const $ = (sel) => body.querySelector(sel)

  // 当前主题下拉
  $('#fts-current').addEventListener('change', async (e) => {
    const v = e.target.value || null
    try {
      await applyThemeById(v)
      CTX.ui.notice(v ? '已应用主题' : '已切回默认主题', 'ok')
      await refresh()
    } catch (err) {
      CTX.ui.notice('切换失败：' + (err.message || String(err)), 'err')
    }
  })

  // 列表项按钮（事件委托）
  body.querySelectorAll('button[data-act]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id')
      const act = btn.getAttribute('data-act')
      try {
        if (act === 'apply') {
          await applyThemeById(id)
          CTX.ui.notice('已应用', 'ok')
          await refresh()
        } else if (act === 'del') {
          const ok = await CTX.ui.confirm('确认删除主题 "' + id + '" 吗？')
          if (!ok) return
          await uninstallTheme(id)
          CTX.ui.notice('已删除', 'ok')
          menuVersion++
          await refresh()
        } else if (act === 'open') {
          const dir = buildThemeDir(id)
          await ensureDir(dir)
          const ok = await revealInExplorer(dir)
          if (!ok) CTX.ui.notice('目录：' + dir, 'ok', 4000)
        }
      } catch (err) {
        CTX.ui.notice('操作失败：' + (err.message || String(err)), 'err')
      }
    })
  })


  // 安装：URL
  const installFlow = async (fn, val) => {
    if (!val) return
    try {
      const m = await fn(val)
      if (m) {
        CTX.ui.notice('已安装：' + m.name, 'ok')
        const ok = await CTX.ui.confirm('立即应用 "' + m.name + '" 吗？')
        if (ok) await applyThemeById(m.id)
        menuVersion++
        await refresh()
      }
    } catch (err) {
      CTX.ui.notice('安装失败：' + (err.message || String(err)), 'err', 4000)
    }
  }

  $('#fts-url-go').addEventListener('click', () => installFlow(installFromUrl, $('#fts-url').value.trim()))
  $('#fts-gh-go').addEventListener('click', () => installFlow(installFromGithub, $('#fts-gh').value.trim()))
  $('#fts-local-go').addEventListener('click', () => installFlow(installFromLocal, $('#fts-local').value.trim()))
  $('#fts-local-pick').addEventListener('click', async () => {
    const p = await pickLocalThemeFile()
    if (p) $('#fts-local').value = p
  })
}

// ============================================================
// 生命周期导出
// ============================================================

export async function activate(context) {
  CTX = context
  try {
    THEMES_ROOT = await resolveThemesRoot()
  } catch (e) {
    THEMES_ROOT = ''
    console.warn('[theme-manager] 无法解析主题目录:', e)
  }

  // 注册菜单
  await rebuildMenu()

  // 启动菜单弹层观察器（用于动态打 ✓）
  try {
    cachedCurrentId = await loadCurrentId()
  } catch {}
  startMenuObserver()

  // 应用上次的主题
  try {
    const cur = await loadCurrentId()
    if (cur) await applyThemeById(cur)
  } catch (e) {
    console.warn('[theme-manager] 启动应用主题失败:', e)
  }

  // 监听 flymd 主题变更（仅做日志，宿主主题切换不影响我们注入的全局 CSS）
  if (typeof window !== 'undefined') {
    window.addEventListener('flymd:theme:changed', () => {
      // 主题偏好变了不需要重新注入 CSS
    })
  }
}

export function deactivate() {
  stopMenuObserver()
  if (typeof removeMenuItem === 'function') {
    try { removeMenuItem() } catch {}
    removeMenuItem = null
  }
  clearInjection()
  const tag = document.getElementById(STYLE_TAG_ID)
  if (tag) tag.remove()
  // overlay 清理
  const o1 = document.getElementById('flymd-theme-prompt-overlay')
  if (o1) o1.remove()
  const o2 = document.getElementById('flymd-theme-settings-overlay')
  if (o2) o2.remove()
  CTX = null
}

export async function openSettings(context) {
  if (context && !CTX) CTX = context
  if (!THEMES_ROOT) {
    try { THEMES_ROOT = await resolveThemesRoot() } catch {}
  }
  await renderSettingsPanel()
}




















