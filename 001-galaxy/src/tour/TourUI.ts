import { TOUR_STEPS, type TourStep } from './steps'
import type { Tour } from './Tour'

export interface TourUIHandle {
  /** 更新说明卡片 */
  setStep(index: number, step: TourStep): void
  /** 更新播放/暂停按钮图标 */
  setPlaying(playing: boolean): void
  /** 更新本步停留进度条 0~1 */
  setProgress(progress: number): void
  /** 淡出并隐藏整个覆盖层 */
  hide(): void
  /** 重新显示（重播演示时用） */
  show(): void
  dispose(): void
}

interface Elements {
  root: HTMLElement
  indexEl: HTMLElement
  totalEl: HTMLElement
  timerEl: HTMLElement
  titleEl: HTMLElement
  descEl: HTMLElement
  filesEl: HTMLElement
  dotsEl: HTMLElement
  prevBtn: HTMLButtonElement
  nextBtn: HTMLButtonElement
  playBtn: HTMLButtonElement
  skipBtn: HTMLButtonElement
}

function query(): Elements {
  return {
    root: document.getElementById('tour') as HTMLElement,
    indexEl: document.getElementById('tour-index') as HTMLElement,
    totalEl: document.getElementById('tour-total') as HTMLElement,
    timerEl: document.getElementById('tour-timer') as HTMLElement,
    titleEl: document.getElementById('tour-title') as HTMLElement,
    descEl: document.getElementById('tour-desc') as HTMLElement,
    filesEl: document.getElementById('tour-files') as HTMLElement,
    dotsEl: document.getElementById('tour-dots') as HTMLElement,
    prevBtn: document.getElementById('tour-prev') as HTMLButtonElement,
    nextBtn: document.getElementById('tour-next') as HTMLButtonElement,
    playBtn: document.getElementById('tour-play') as HTMLButtonElement,
    skipBtn: document.getElementById('tour-skip') as HTMLButtonElement,
  }
}

export function createTourUI(tour: Tour): TourUIHandle {
  const el = query()
  const dots: HTMLButtonElement[] = []

  el.totalEl.textContent = String(TOUR_STEPS.length)

  // 进度点：每个点代表一步，点击直接跳转
  for (let i = 0; i < TOUR_STEPS.length; i++) {
    const dot = document.createElement('button')
    dot.className = 'tour-dot'
    dot.type = 'button'
    dot.title = `第 ${i + 1} 步 · ${TOUR_STEPS[i].title}`
    dot.addEventListener('click', () => tour.goto(i))
    el.dotsEl.appendChild(dot)
    dots.push(dot)
  }

  el.prevBtn.addEventListener('click', () => tour.prev())
  el.nextBtn.addEventListener('click', () => tour.next())
  el.playBtn.addEventListener('click', () => tour.togglePlay())
  el.skipBtn.addEventListener('click', () => tour.finish())

  const setStep = (index: number, step: TourStep): void => {
    el.indexEl.textContent = String(index + 1).padStart(2, '0')
    el.titleEl.textContent = step.title
    el.descEl.textContent = step.desc

    el.filesEl.replaceChildren(
      ...step.files.map((file) => {
        const li = document.createElement('li')
        li.textContent = file
        return li
      }),
    )

    dots.forEach((dot, i) => {
      dot.classList.toggle('is-current', i === index)
      dot.classList.toggle('is-done', i < index)
    })

    el.prevBtn.disabled = index === 0

    // 触发卡片重播入场动画
    el.titleEl.classList.remove('is-enter')
    void el.titleEl.offsetWidth
    el.titleEl.classList.add('is-enter')
    el.descEl.classList.remove('is-enter')
    void el.descEl.offsetWidth
    el.descEl.classList.add('is-enter')
  }

  const setPlaying = (playing: boolean): void => {
    el.playBtn.textContent = playing ? '❚❚' : '▶'
    el.playBtn.title = playing ? '暂停 (Space)' : '播放 (Space)'
  }

  const setProgress = (progress: number): void => {
    el.timerEl.style.transform = `scaleX(${progress})`
  }

  const hide = (): void => {
    el.root.classList.add('is-hidden')
  }

  const show = (): void => {
    el.root.classList.remove('is-hidden')
  }

  const dispose = (): void => {
    el.dotsEl.replaceChildren()
    dots.length = 0
  }

  return { setStep, setPlaying, setProgress, hide, show, dispose }
}
