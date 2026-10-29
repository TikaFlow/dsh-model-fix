/** 宿主版本比较（跨半共享）：`a.b.c` + 可选 `-<alpha|rc>.N`，阶段序 alpha < rc < 正式版；解析失败返回 undefined */

import type { Context } from '@deepseek-ai/cordis'

/** 宿主 `pluginPackages` 服务面（按契约复制：该包只服务 CLI 启动、传递依赖大，故不装 devDep，也不单列文件） */
interface HostPluginPackages {
    packageOf: (specifier: string, parentURL: string) => { readonly version: string | undefined } | undefined
}

/** 版本号所在的宿主包 */
const HOST_VERSION_PACKAGE = '@deepseek-ai/dsh-app-boot'

/** 读宿主版本号；服务缺席或读不到返回 undefined */
export function hostVersionNow(ctx: Context): string | undefined {
    const packages = ctx.get('pluginPackages') as HostPluginPackages | undefined
    if (packages === undefined) return undefined
    try {
        const version = packages.packageOf(HOST_VERSION_PACKAGE, ctx.baseUrl ?? import.meta.url)?.version
        return typeof version === 'string' && version.length > 0 ? version : undefined
    } catch {
        return undefined
    }
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|rc)\.(\d+))?$/

const STAGE_RANK: Readonly<Record<string, number>> = { alpha: 0, rc: 1 }
const STABLE_RANK = 2

export interface HostVersion {
    readonly major: number
    readonly minor: number
    readonly patch: number
    readonly stageRank: number
    readonly revision: number
}

export function parseHostVersion(version: string): HostVersion | undefined {
    const match = VERSION_PATTERN.exec(version)
    if (match === null) return undefined
    const [, major, minor, patch, stage, revision] = match
    return {
        major: Number(major),
        minor: Number(minor),
        patch: Number(patch),
        stageRank: stage === undefined ? STABLE_RANK : STAGE_RANK[stage] ?? STABLE_RANK,
        revision: revision === undefined ? 0 : Number(revision),
    }
}

/** 比较两个宿主版本；任一侧非法返回 undefined */
export function compareHostVersion(a: string, b: string): number | undefined {
    const left = parseHostVersion(a)
    const right = parseHostVersion(b)
    if (left === undefined || right === undefined) return undefined
    return left.major - right.major
        || left.minor - right.minor
        || left.patch - right.patch
        || left.stageRank - right.stageRank
        || left.revision - right.revision
}
