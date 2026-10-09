function plainInline(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\*([^*\s][^*]*)\*/g, '$1')
    .replace(/(^|[^\p{L}\p{N}_])_([^_\s][^_]*)_(?=[^\p{L}\p{N}_]|$)/gu, '$1$2')
}

// 采纳进卡片和写入脑共用的纯文本：去掉标题井号、加粗斜体、行内代码、链接网址、无序列表符号和代码围栏。有序列表的序号是看得见的字，保留。
// 页面和 server/http.mjs 都引用这一份，所以写成浏览器和 Node 都能直接跑的 .mjs。
export function stripMarkdown(text) {
  const out = []
  let fenced = false
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) {
      out.push(line)
      continue
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) continue
    let rest = line
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/\s+#+\s*$/, '')
      .replace(/^\s*>\s?/, '')
      .replace(/^(\s*)[-*+]\s+(\[[ xX]\]\s+)?/, '$1')
    rest = plainInline(rest)
    out.push(rest)
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
