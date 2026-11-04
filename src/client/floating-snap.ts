/** 悬浮按钮组的贴边几何与边值：纯函数，算吸附位置与排列方向、校验边值与持久化记录（零 DOM 依赖）。 */

/** 贴边间距（父容器内缩） */
export const EDGE_GAP = 12

/** 吸附到哪条边 */
export type SnapEdge = 'left' | 'right' | 'top' | 'bottom'

/** 合法边值 */
export const SNAP_EDGES: readonly SnapEdge[] = ['left', 'right', 'top', 'bottom']

/** 持久化的吸附记录：边 + 沿线像素偏移（左/右贴边记 y，上/下贴边记 x） */
export interface EdgeRecord {
    readonly edge: SnapEdge
    readonly offset: number
}

/** 边值校验：只认上表中的真实边，其余一律返回 null，由调用方回落默认边 */
export function parseEdge(raw: string | null): SnapEdge | null {
    return SNAP_EDGES.find((edge) => edge === raw) ?? null
}

/** 记录校验：任一字段非法即整条作废（不保留半条）；非 JSON 的旧值按缺失处理 */
export function parseEdgeRecord(raw: string | null): EdgeRecord | null {
    if (raw === null) return null
    let stored: unknown
    try {
        stored = JSON.parse(raw)
    } catch {
        return null
    }
    if (typeof stored !== 'object' || stored === null) return null
    const { edge, offset } = stored as EdgeRecord
    const parsedEdge = parseEdge(typeof edge === 'string' ? edge : null)
    if (parsedEdge === null) return null
    if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) return null
    return { edge: parsedEdge, offset } as EdgeRecord
}

/** 记录是否变化：边或沿线像素任一不同即需写回；无旧记录视为变化 */
export function edgeRecordChanged(previous: EdgeRecord | null, next: EdgeRecord): boolean {
    return previous === null || previous.edge !== next.edge || previous.offset !== next.offset
}

/** 排列方向：左右边竖排，上下边横排 */
export type Orientation = 'vertical' | 'horizontal'

/** 容器相对父容器的位置与尺寸 */
export interface Geometry {
    readonly offsetX: number
    readonly offsetY: number
    readonly width: number
    readonly height: number
    readonly parentWidth: number
    readonly parentHeight: number
}

/** 四边距离：容器边到父容器对应边的距离；容器超出父容器范围时该边记 0 */
export function edgeDistances(geometry: Geometry): Record<SnapEdge, number> {
    const { offsetX, offsetY, width, height, parentWidth, parentHeight } = geometry
    return {
        left: offsetX,
        right: parentWidth - offsetX - width,
        top: offsetY,
        bottom: parentHeight - offsetY - height,
    }
}

/** 最近边：距离最小者；同距离按 left → right → top → bottom */
export function nearestEdge(distances: Record<SnapEdge, number>): SnapEdge {
    let best = SNAP_EDGES[0]
    for (const edge of SNAP_EDGES) if (distances[edge] < distances[best]) best = edge
    return best
}

/** 吸附方向是否纵向 */
export function isVertical(edge: SnapEdge): boolean {
    return edge === 'left' || edge === 'right'
}

/** Tooltip 朝向：贴着哪条边就朝那一侧的外方 */
export function tooltipSideOf(edge: SnapEdge): 'right' | 'left' | 'bottom' | 'top' {
    if (edge === 'left') return 'right'
    if (edge === 'right') return 'left'
    if (edge === 'top') return 'bottom'
    return 'top'
}

/** 自由轴夹取：留出 gap 边距；父容器比容器还小时取 gap */
export function clampOffset(offset: number, size: number, parentSize: number): number {
    const max = parentSize - size - EDGE_GAP
    if (max < EDGE_GAP) return EDGE_GAP
    if (offset < EDGE_GAP) return EDGE_GAP
    return offset > max ? max : offset
}

/** 吸附位置：吸附轴贴边（gap），自由轴保留松手位置并夹取 */
export function snappedOffset(edge: SnapEdge, geometry: Geometry): { x: number; y: number } {
    const { offsetX, offsetY, width, height, parentWidth, parentHeight } = geometry
    if (edge === 'left') return { x: EDGE_GAP, y: clampOffset(offsetY, height, parentHeight) }
    if (edge === 'right') return { x: parentWidth - width - EDGE_GAP, y: clampOffset(offsetY, height, parentHeight) }
    if (edge === 'top') return { x: clampOffset(offsetX, width, parentWidth), y: EDGE_GAP }
    return { x: clampOffset(offsetX, width, parentWidth), y: parentHeight - height - EDGE_GAP }
}
