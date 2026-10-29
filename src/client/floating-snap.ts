/** 悬浮按钮组的贴边几何：纯函数，算吸附位置与排列方向（零 DOM 依赖）。 */

/** 贴边间距（父容器内缩） */
export const EDGE_GAP = 16

/** 吸附到哪条边 */
export type SnapEdge = 'left' | 'right' | 'top' | 'bottom'

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
    const edges: SnapEdge[] = ['left', 'right', 'top', 'bottom']
    let best = edges[0]
    for (const edge of edges) if (distances[edge] < distances[best]) best = edge
    return best
}

/** 吸附方向：左右边竖排，上下边横排 */
export function orientationOf(edge: SnapEdge): Orientation {
    return edge === 'left' || edge === 'right' ? 'vertical' : 'horizontal'
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
