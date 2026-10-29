/** 悬浮按钮组容器：内容区（AppFrame 中心列）内可拖拽、松手贴边的一组悬浮按钮。 */

import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { TIP_MAX_WIDTH } from '@/client/card-styles'
import type { FloatingButton } from '@/client/floating-button'
import { PLUGIN_NAME } from '@/shared/constants'
import { EDGE_GAP, clampOffset, edgeDistances, nearestEdge, orientationOf, snappedOffset, tooltipSideOf, type SnapEdge } from '@/client/floating-snap'

const CONTAINER_ID = 'tikaflow-model-fix-floating-buttons'
const CONTAINER_CLASS = CONTAINER_ID
const BUTTON_CLASS = 'tikaflow-model-fix-floating-button'
const BUTTON_ID_PREFIX = 'tikaflow-model-fix-floating-button-'
const STYLE_ID = 'tikaflow-model-fix-floating-buttons-css'

const BUTTON_GAP = 8

/** 拖拽位移超过该值才算拖拽，否则让按钮照常出 click */
const DRAG_THRESHOLD = 4

/** 按钮数值照宿主 `ui-chat` 的 `.toBottom` */
const STYLE_TEXT = [
    `.${CONTAINER_CLASS}{position:absolute;left:${EDGE_GAP}px;top:50%;transform:translateY(-50%);z-index:999;display:flex;flex-direction:column-reverse;align-items:center;gap:${BUTTON_GAP}px}`,
    `.${CONTAINER_CLASS}.dragging{cursor:grabbing;user-select:none}`,
    `.${BUTTON_CLASS}{display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:34px;height:34px;padding:0;border:0;border-radius:100px;corner-shape:round;--dsw-elevation-stroke-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary,#0f1115);background:var(--dsw-alias-button-floating-fill,#fff);box-shadow:var(--dsw-elevation-panel);cursor:pointer}`,
    `.${BUTTON_CLASS}:hover{background:var(--dsw-alias-button-floating-hover,#f5f6f7)}`,
    `.${BUTTON_CLASS}:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,rgb(65,118,230)));outline-offset:2px}`,
].join('\n')

/** 调用顺序 = 渲染顺序 */
interface FloatingButtonGroup {
    addButton(button: FloatingButton): void
}

/** 幂等注入：宿主 HMR 按 data-plugin 摘旧节点，故只同步内容不重建 */
function ensureStyles(): void {
    if (typeof document === 'undefined') return
    let tag = document.getElementById(STYLE_ID)
    if (tag === null) {
        tag = document.createElement('style')
        tag.id = STYLE_ID
        tag.dataset.plugin = PLUGIN_NAME
        document.head.appendChild(tag)
    }
    if (tag.textContent !== STYLE_TEXT) tag.textContent = STYLE_TEXT
}

/** 宿主 CSS Module 类名随构建 hash 变化，故按 slot 锚点定位中心列 */
function centerColumn(): HTMLElement | null {
    const parent = document.querySelector('[data-slot="main"]')?.parentElement
    return parent instanceof HTMLElement ? parent : null
}

/** Tooltip 的方向。宿主 `0.2.1-rc.3` 起才支持 `left`；不支持时宿主按自身默认方向退化。
 * devDep 类型基线（0.2.1-rc.2）无 `left`，故按宿主的 prop 类型断言（运行时值原样传下去）*/
type TooltipSide = 'right' | 'left' | 'bottom' | 'top'

/** `active` 为假即不渲染，不占位不留 gap */
function FloatingButtonItem(props: { button: FloatingButton; side: TooltipSide }): ReactNode {
    const state = useSyncExternalStore(props.button.subscribe, props.button.getSnapshot)
    if (!state.active) return null
    return (
        <Tooltip label={state.title} side={props.side as 'right' | 'bottom' | 'top'} portal maxWidth={TIP_MAX_WIDTH}>
            <button
                type="button"
                id={`${BUTTON_ID_PREFIX}${props.button.id}`}
                className={BUTTON_CLASS}
                aria-label={state.title}
                onClick={state.onClick}
            >
                {state.icon}
            </button>
        </Tooltip>
    )
}

function FloatingButtons(props: { buttons: readonly FloatingButton[]; side: TooltipSide }): ReactNode {
    return (
        <>
            {props.buttons.map((button) => (
                <FloatingButtonItem key={button.id} button={button} side={props.side} />
            ))}
        </>
    )
}

/**
 * 装上悬浮按钮组：容器常驻到插件卸载，按钮由 `addButton` 逐枚加入。
 * 中心列缺定位上下文，就地补一条 inline `position: relative`（宿主只由 className 渲染该元素，inline
 * 不被覆盖，卸载时还原原值）。
 */
export function applyFloatingButtons(ctx: ClientContext): FloatingButtonGroup {
    let buttons: readonly FloatingButton[] = []
    let root: { render(node: ReactNode): void; unmount(): void } | null = null
    let container: HTMLElement | null = null
    /** 中心列原 inline position 值（空串 = 原本没有） */
    let columnPosition = ''
    let column: HTMLElement | null = null
    /** 当前吸附的边（null = 默认居中位） */
    let currentEdge: SnapEdge | null = null
    /** Tooltip 方向：贴着容器所在的那一侧朝外，贴左边则朝右 */
    let tooltipSide: TooltipSide = 'right'

    const render = (): void => {
        try {
            root?.render(<FloatingButtons buttons={buttons} side={tooltipSide} />)
        } catch (error) {
            // 渲染抛错会清空整棵子树且无痕迹
            ctx.logger.error(`${PLUGIN_NAME}: 悬浮按钮组渲染失败：${String(error)}`)
        }
        // 条目增减会改容器尺寸 ⇒ 重新夹取当前位置
        requestAnimationFrame(() => { if (column !== null) applyCurrentPosition() })
    }

    const addButton = (button: FloatingButton): void => {
        buttons = [...buttons, button]
        render()
    }

    const ensureColumnContext = (target: HTMLElement): void => {
        if (column === target) return
        column = target
        columnPosition = target.style.position
        target.style.position = 'relative'
    }

    const restoreColumnContext = (): void => {
        if (column === null) return
        // 置空串即移除该 inline 声明
        column.style.position = columnPosition
        column = null
        columnPosition = ''
    }
    ctx.effect(function* () {
        yield restoreColumnContext
    }, `${PLUGIN_NAME}: 悬浮按钮组 宿主列样式复原`)

    const mount = (): void => {
        if (container !== null) return
        const target = centerColumn()
        if (target === null) return
        ensureStyles()
        ensureColumnContext(target)
        container = document.createElement('div')
        container.id = CONTAINER_ID
        container.className = CONTAINER_CLASS
        target.appendChild(container)
        root = createRoot(container)
        render()
        container.addEventListener('pointerdown', onPointerDown)
        // 拖拽松手那一次 click 不该触发按钮：捕获阶段拦掉，拦完即失效
        container.addEventListener('click', (event) => {
            if (!suppressClick) return
            suppressClick = false
            event.preventDefault()
            event.stopPropagation()
        }, true)
        applyDefaultPosition(target)
        // React 渲染是异步的，此刻容器高度可能还是 0 ⇒ 下一帧按真实尺寸再摆一次
        requestAnimationFrame(() => { if (column === target) applyDefaultPosition(target) })
    }

    /** 容器相对父容器的当前几何 */
    const geometryOf = (target: HTMLElement): { offsetX: number; offsetY: number; width: number; height: number; parentWidth: number; parentHeight: number } | null => {
        if (container === null) return null
        const parent = target.getBoundingClientRect()
        const own = container.getBoundingClientRect()
        return {
            offsetX: own.left - parent.left,
            offsetY: own.top - parent.top,
            width: own.width,
            height: own.height,
            parentWidth: parent.width,
            parentHeight: parent.height,
        }
    }

    /** 写容器位置（像素坐标，覆盖 CSS 的居中默认值） */
    const place = (x: number, y: number): void => {
        if (container === null) return
        container.style.left = `${x}px`
        container.style.top = `${y}px`
        container.style.transform = 'none'
    }

    /** 默认位置：左边 16px、纵向居中 */
    const applyDefaultPosition = (target: HTMLElement): void => {
        const geometry = geometryOf(target)
        if (geometry === null) return
        place(EDGE_GAP, clampOffset((geometry.parentHeight - geometry.height) / 2, geometry.height, geometry.parentHeight))
    }

    /** 重新贴回当前边（尺寸或父容器变了都要重算） */
    const applyCurrentPosition = (): void => {
        if (column === null) return
        if (currentEdge === null) {
            applyDefaultPosition(column)
            return
        }
        const geometry = geometryOf(column)
        if (geometry === null) return
        const snapped = snappedOffset(currentEdge, geometry)
        place(snapped.x, snapped.y)
    }

    /** 拖拽状态 */
    let dragging = false
    let dragMoved = false
    /** 拖拽松手后的那一次 click 要拦掉 */
    let suppressClick = false
    let dragStartX = 0
    let dragStartY = 0
    let dragOffsetX = 0
    let dragOffsetY = 0

    const onPointerDown = (event: PointerEvent): void => {
        if (container === null || column === null) return
        if (event.button !== 0) return
        const geometry = geometryOf(column)
        if (geometry === null) return
        dragging = true
        dragMoved = false
        suppressClick = false
        dragStartX = event.clientX
        dragStartY = event.clientY
        dragOffsetX = geometry.offsetX
        dragOffsetY = geometry.offsetY
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
        window.addEventListener('pointercancel', onPointerCancel)
    }

    const onPointerMove = (event: PointerEvent): void => {
        if (!dragging || container === null || column === null) return
        const dx = event.clientX - dragStartX
        const dy = event.clientY - dragStartY
        if (!dragMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        if (!dragMoved) {
            dragMoved = true
            container.classList.add('dragging')
        }
        const geometry = geometryOf(column)
        if (geometry === null) return
        place(
            clampOffset(dragOffsetX + dx, geometry.width, geometry.parentWidth),
            clampOffset(dragOffsetY + dy, geometry.height, geometry.parentHeight))
    }

    const endDrag = (): void => {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerCancel)
        dragging = false
    }

    const onPointerCancel = (): void => {
        endDrag()
    }

    const onPointerUp = (): void => {
        if (!dragging) return
        const moved = dragMoved
        endDrag()
        if (!moved || container === null || column === null) return
        suppressClick = true
        container.classList.remove('dragging')
        const geometry = geometryOf(column)
        if (geometry === null) return
        const edge = nearestEdge(edgeDistances(geometry))
        currentEdge = edge
        tooltipSide = tooltipSideOf(edge)
        container.style.flexDirection = orientationOf(edge) === 'vertical' ? 'column-reverse' : 'row'
        // 方向变了容器尺寸也变，重量一次再定吸附位置
        const after = geometryOf(column)
        if (after === null) return
        const snapped = snappedOffset(edge, after)
        place(snapped.x, snapped.y)
        render()
    }

    // 中心列属宿主 React 树，宿主重挂即换节点 ⇒ 容器跟着搬（React 根随节点走，不重建）
    const NO_FRAME = 0
    let scheduled = NO_FRAME
    const sync = (): void => {
        scheduled = NO_FRAME
        const target = centerColumn()
        if (target === null) return
        if (column !== target) {
            restoreColumnContext()
            ensureColumnContext(target)
        }
        if (container === null) {
            mount()
            return
        }
        if (container.parentElement !== target) target.appendChild(container)
    }
    ctx.effect(function* () {
        // 合并到下一帧只跑一次：逐个 mutation 各跑一次全树查询代价过高
        const observer = new MutationObserver(() => {
            if (scheduled !== NO_FRAME) return
            scheduled = requestAnimationFrame(sync)
        })
        yield () => observer.disconnect()
        observer.observe(document.body, { childList: true, subtree: true })

        mount()
        // 父容器尺寸变了（窗口缩放）要重新贴边
        const resize = new ResizeObserver(() => { applyCurrentPosition() })
        if (column !== null) resize.observe(column)
        const disposer = () => {
            // 已排未跑的帧须取消：sync 会在 disconnect 之后跑 mount，重建出已卸载的容器
            if (scheduled !== NO_FRAME) cancelAnimationFrame(scheduled)
            scheduled = NO_FRAME
            resize.disconnect()
            endDrag()
            root?.unmount()
            root = null
            container?.remove()
            container = null
        }
        yield disposer
    }, `${PLUGIN_NAME}: 悬浮按钮组 挂载`)

    return { addButton }
}
