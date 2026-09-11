/**
 * 源码阅读器 —— 这个 lab 最"教学"的一块。
 *
 * 源文件通过 Vite 的 ?raw 在**构建期**被当成字符串塞进来，
 * 也就是说你在页面上读到的，就是硬盘上那份真代码，永远不存在
 * "文档和实现不一致"的问题。配合章节卡片上的说明，可以边看画面边读实现。
 */
const rawModules = {
  ...import.meta.glob('../chapters/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../core/*.ts', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>

/** 把 '../chapters/01-empty-world.ts' 规整成章节里写的 'src/chapters/01-empty-world.ts' */
const SOURCES: Record<string, string> = {}
for (const [path, source] of Object.entries(rawModules)) {
  SOURCES[path.replace(/^\.\.\//, 'src/')] = source
}

export interface SourceViewerHandle {
  /** 换章时更新可选文件，但不强行打开面板 */
  show(files: string[]): void
  /** 打开面板并定位到某个文件 */
  open(file?: string): void
  setVisible(visible: boolean): void
  toggle(): boolean
  readonly visible: boolean
  dispose(): void
}

// ---------------------------------------------------------------- 高亮

const KEYWORDS = new Set([
  'import', 'from', 'export', 'const', 'let', 'var', 'function', 'return', 'class', 'extends',
  'new', 'this', 'if', 'else', 'for', 'of', 'in', 'while', 'do', 'switch', 'case', 'break',
  'continue', 'typeof', 'instanceof', 'type', 'interface', 'enum', 'implements', 'public',
  'private', 'readonly', 'static', 'as', 'async', 'await', 'try', 'catch', 'finally', 'throw',
  'void', 'null', 'undefined', 'true', 'false', 'number', 'string', 'boolean', 'any', 'never',
  'unknown', 'default', 'super', 'yield', 'delete', 'declare', 'get', 'set',
])

type TokenKind = 'plain' | 'comment' | 'string' | 'keyword' | 'number' | 'type'
interface Token {
  text: string
  kind: TokenKind
}

/**
 * 极简高亮：只认注释 / 字符串 / 关键字 / 数字。
 * 注释状态要跨行传递（中文注释经常写成多行块注释），所以用 state 记着。
 */
function tokenizeLine(line: string, state: { block: boolean }): Token[] {
  const tokens: Token[] = []
  let plain = ''
  let index = 0

  const flush = (): void => {
    if (plain) {
      tokens.push({ text: plain, kind: 'plain' })
      plain = ''
    }
  }

  while (index < line.length) {
    // 还在块注释里
    if (state.block) {
      const end = line.indexOf('*/', index)
      if (end === -1) {
        tokens.push({ text: line.slice(index), kind: 'comment' })
        return tokens
      }
      tokens.push({ text: line.slice(index, end + 2), kind: 'comment' })
      state.block = false
      index = end + 2
      continue
    }

    const pair = line.slice(index, index + 2)

    if (pair === '//') {
      flush()
      tokens.push({ text: line.slice(index), kind: 'comment' })
      return tokens
    }

    if (pair === '/*') {
      flush()
      state.block = true
      index += 2
      continue
    }

    const char = line[index]

    // 字符串 / 模板串
    if (char === "'" || char === '"' || char === '`') {
      flush()
      let cursor = index + 1
      while (cursor < line.length) {
        if (line[cursor] === '\\') {
          cursor += 2
          continue
        }
        if (line[cursor] === char) {
          cursor += 1
          break
        }
        cursor += 1
      }
      tokens.push({ text: line.slice(index, cursor), kind: 'string' })
      index = cursor
      continue
    }

    // 标识符（含属性访问，整体当一个普通 token，读起来更干净）
    if (/[A-Za-z_$]/.test(char)) {
      let cursor = index
      while (cursor < line.length && /[A-Za-z0-9_$.]/.test(line[cursor])) cursor += 1

      const word = line.slice(index, cursor)
      if (word.includes('.')) {
        plain += word
      } else if (KEYWORDS.has(word)) {
        flush()
        tokens.push({ text: word, kind: 'keyword' })
      } else if (/^[A-Z]/.test(word)) {
        // 大写开头的多是类名 / 常量
        flush()
        tokens.push({ text: word, kind: 'type' })
      } else {
        plain += word
      }

      index = cursor
      continue
    }

    // 数字
    if (/[0-9]/.test(char)) {
      let cursor = index
      while (cursor < line.length && /[0-9a-fA-FxX._]/.test(line[cursor])) cursor += 1
      flush()
      tokens.push({ text: line.slice(index, cursor), kind: 'number' })
      index = cursor
      continue
    }

    plain += char
    index += 1
  }

  flush()
  return tokens
}

// ---------------------------------------------------------------- 组件

export function createSourceViewer(root: HTMLElement): SourceViewerHandle {
  const tabsEl = root.querySelector('#source-tabs') as HTMLElement
  const bodyEl = root.querySelector('#source-body') as HTMLElement
  const closeBtn = root.querySelector('#source-close') as HTMLButtonElement

  let files: string[] = []
  let visible = false

  function renderSource(source: string): void {
    const lines = source.split('\n')
    const state = { block: false }
    const fragment = document.createDocumentFragment()

    lines.forEach((line, lineIndex) => {
      const row = document.createElement('div')
      row.className = 'src-line'

      const number = document.createElement('span')
      number.className = 'src-no'
      number.textContent = String(lineIndex + 1)

      const code = document.createElement('span')
      code.className = 'src-code'

      for (const token of tokenizeLine(line, state)) {
        if (token.kind === 'plain') {
          code.appendChild(document.createTextNode(token.text))
        } else {
          const span = document.createElement('span')
          span.className = `tk-${token.kind}`
          span.textContent = token.text
          code.appendChild(span)
        }
      }

      if (code.childNodes.length === 0) code.textContent = ' '
      row.append(number, code)
      fragment.appendChild(row)
    })

    bodyEl.replaceChildren(fragment)
    bodyEl.scrollTop = 0
  }

  function selectFile(file: string): void {
    if (!files.includes(file)) return

    const source = SOURCES[file]
    if (source === undefined) {
      bodyEl.replaceChildren()
      const notice = document.createElement('p')
      notice.className = 'src-missing'
      notice.textContent = `读不到 ${file}（只有 src/chapters 与 src/core 下的文件会被内联）`
      bodyEl.appendChild(notice)
    } else {
      renderSource(source)
    }

    for (const button of tabsEl.querySelectorAll('button')) {
      button.classList.toggle('is-current', button.dataset.file === file)
    }
  }

  function buildTabs(): void {
    tabsEl.replaceChildren(
      ...files.map((file) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'source-tab'
        button.dataset.file = file
        // 只显示文件名，路径太长会把标签栏撑爆
        button.textContent = file.split('/').pop() ?? file
        button.title = file
        button.addEventListener('click', () => selectFile(file))
        return button
      }),
    )
  }

  function setVisible(next: boolean): void {
    visible = next
    root.classList.toggle('is-open', next)
    root.setAttribute('aria-hidden', String(!next))
    document.body.classList.toggle('has-source', next)
  }

  const handleClose = (): void => setVisible(false)
  closeBtn.addEventListener('click', handleClose)

  return {
    show(nextFiles: string[]) {
      files = [...new Set(nextFiles)]
      buildTabs()
      if (files.length > 0) selectFile(files[0])
    },
    open(file?: string) {
      setVisible(true)
      selectFile(file && files.includes(file) ? file : files[0] ?? '')
      // 面板刚展开时宽度还在动，等一帧再量高度更稳
      requestAnimationFrame(() => bodyEl.scrollTop = 0)
    },
    setVisible,
    toggle() {
      setVisible(!visible)
      return visible
    },
    get visible() {
      return visible
    },
    dispose() {
      closeBtn.removeEventListener('click', handleClose)
      tabsEl.replaceChildren()
      bodyEl.replaceChildren()
    },
  }
}
