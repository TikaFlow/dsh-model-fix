// 测试入口：依次执行各模块用例并汇总退出码
import { run as runCatalog } from './catalog.test'
import { run as runClientModel } from './client-model.test'
import { run as runCompat } from './compat.test'
import { run as runConfig } from './config.test'
import { run as runGuard } from './guard.test'
import { run as runLookup } from './lookup.test'
import { run as runMigrate } from './migrate.test'
import { run as runReset } from './reset.test'
import { run as runRestore } from './restore.test'
import { summary } from './helper'

runCatalog()
runClientModel()
runCompat()
runConfig()
runGuard()
runLookup()
runMigrate()
runReset()
runRestore()
summary()
