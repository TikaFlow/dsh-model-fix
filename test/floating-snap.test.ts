// src/client/floating-snap.ts 边值与持久化记录用例：只认真实边与非负像素偏移，任一字段非法整条作废
import { SNAP_EDGES, edgeRecordChanged, nearestEdge, parseEdge, parseEdgeRecord } from '@/client/floating-snap'
import { check, stable } from '@test/helper'

/** 四条边等距时取左（同距离按 left → right → top → bottom），顺带验证合法边全集的顺序 */
const EVEN = { left: 10, right: 10, top: 10, bottom: 10 }

export function run(): void {
    check('parseEdge 真实边原样返回',
        SNAP_EDGES.every((edge) => parseEdge(edge) === edge), SNAP_EDGES)
    check('parseEdge 缺失值回落 null', parseEdge(null) === null)
    check('parseEdge 非法值回落 null',
        parseEdge('') === null && parseEdge('Left') === null && parseEdge('diagonal') === null
        && parseEdge(' left') === null && parseEdge('left ') === null)
    check('nearestEdge 等距取左', nearestEdge(EVEN) === 'left')

    check('parseEdgeRecord 合法记录原样返回',
        stable(parseEdgeRecord('{"edge":"right","offset":120.5}')) === stable({ edge: 'right', offset: 120.5 }),
        parseEdgeRecord('{"edge":"right","offset":120.5}'))
    check('parseEdgeRecord 四条边均可读',
        SNAP_EDGES.every((edge) => parseEdgeRecord(JSON.stringify({ edge, offset: 100 }))?.edge === edge))
    check('parseEdgeRecord 像素 0 与较大正值均合法',
        parseEdgeRecord('{"edge":"top","offset":0}')?.offset === 0
        && parseEdgeRecord('{"edge":"bottom","offset":9999}')?.offset === 9999)
    check('parseEdgeRecord 非法 edge 整条作废',
        parseEdgeRecord('{"edge":"diagonal","offset":100}') === null
        && parseEdgeRecord('{"edge":null,"offset":100}') === null
        && parseEdgeRecord('{"offset":100}') === null)
    check('parseEdgeRecord 非法 offset 整条作废',
        parseEdgeRecord('{"edge":"left","offset":-1}') === null
        && parseEdgeRecord('{"edge":"left","offset":"100"}') === null
        && parseEdgeRecord('{"edge":"left","offset":null}') === null
        && parseEdgeRecord('{"edge":"left"}') === null)
    check('parseEdgeRecord 非 JSON 旧值按缺失处理',
        parseEdgeRecord('right') === null && parseEdgeRecord('"right"') === null)
    check('parseEdgeRecord 缺失值回落 null',
        parseEdgeRecord(null) === null && parseEdgeRecord('') === null && parseEdgeRecord('null') === null)

    check('edgeRecordChanged 同边不同像素需写回',
        edgeRecordChanged({ edge: 'right', offset: 100 }, { edge: 'right', offset: 160 }))
    check('edgeRecordChanged 记录相同不写回',
        !edgeRecordChanged({ edge: 'left', offset: 42 }, { edge: 'left', offset: 42 })
        && !edgeRecordChanged({ edge: 'top', offset: 42 }, { edge: 'top', offset: 42 }))
    check('edgeRecordChanged 无旧记录需写回',
        edgeRecordChanged(null, { edge: 'left', offset: 0 }))
}
