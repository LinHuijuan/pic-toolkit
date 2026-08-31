/**
 * 把底部操作栏的真实高度写回 --bottom-bar-h。
 *
 * toast 容器挂在 body 上、用 fixed 定位，只能靠这个变量躲开底栏。而底栏有几颗按钮、
 * 系统字号开多大、有没有安全区都会改变它的高度（同一份样式下实测 74px ~ 95px），
 * 写死一个数猜错一点，toast 就整条钻到栏底下。
 */
const VAR = '--bottom-bar-h'

let mutationObserver: MutationObserver | null = null
let resizeObserver: ResizeObserver | null = null
let observed: HTMLElement | null = null

function applyHeight(el: HTMLElement | null) {
  // offsetHeight 不受视图切换的 transform 影响，getBoundingClientRect 会被缩放污染
  const px = el ? `${el.offsetHeight}px` : '0px'
  document.documentElement.style.setProperty(VAR, px)
}

function attach(bar: HTMLElement | null) {
  if (bar === observed) return
  observed = bar
  resizeObserver?.disconnect()
  if (!bar) {
    applyHeight(null)
    return
  }
  resizeObserver = new ResizeObserver(() => applyHeight(bar))
  resizeObserver.observe(bar)
  applyHeight(bar)
}

function currentBar() {
  return document.querySelector<HTMLElement>('.bottom-bar')
}

/** 视图切换、以及"选完图底栏才出现"都会增删 .bottom-bar，所以要持续观察 DOM */
export function trackBottomBarHeight() {
  if (mutationObserver) return
  let queued = false
  mutationObserver = new MutationObserver(() => {
    if (queued) return
    queued = true
    // 不用 rAF 节流：页面不被合成时（后台标签页）rAF 可以一直不触发，
    // 高度就会被永久丢在 0px。setTimeout 不依赖帧调度，一定会跑。
    setTimeout(() => {
      queued = false
      attach(currentBar())
    }, 0)
  })
  mutationObserver.observe(document.getElementById('app') ?? document.body, {
    childList: true,
    subtree: true,
  })
  attach(currentBar())
}

export function stopTrackingBottomBarHeight() {
  mutationObserver?.disconnect()
  resizeObserver?.disconnect()
  mutationObserver = null
  resizeObserver = null
  observed = null
}
