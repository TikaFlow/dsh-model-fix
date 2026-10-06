// 测试入口：依次执行各模块用例并汇总退出码
import { run as runCatalog } from '@test/catalog.test'
import { run as runClientModel } from '@test/client-model.test'
import { run as runCompat } from '@test/compat.test'
import { run as runConfig } from '@test/config.test'
import { run as runEffort } from '@test/effort.test'
import { run as runFix } from '@test/fix.test'
import { run as runGuard } from '@test/guard.test'
import { run as runLookup } from '@test/lookup.test'
import { run as runMigrate } from '@test/migrate.test'
import { run as runPrune } from '@test/prune.test'
import { run as runReset } from '@test/reset.test'
import { run as runRestore } from '@test/restore.test'
import { run as runRpcRoute } from '@test/rpc-route.test'
import { run as runVerify } from '@test/verify.test'
import { section, summary } from '@test/helper'

section('catalog.test.ts')
runCatalog()
section('client-model.test.ts')
runClientModel()
section('compat.test.ts')
runCompat()
section('config.test.ts')
runConfig()
section('effort.test.ts')
runEffort()
section('guard.test.ts')
runGuard()
section('lookup.test.ts')
runLookup()
section('migrate.test.ts')
runMigrate()
section('prune.test.ts')
runPrune()
section('reset.test.ts')
runReset()
section('restore.test.ts')
runRestore()
section('verify.test.ts')
await runVerify()
section('rpc-route.test.ts')
await runRpcRoute()
section('fix.test.ts')
await runFix()
summary()
