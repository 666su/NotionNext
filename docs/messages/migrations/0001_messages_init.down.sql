-- =============================================================================
-- Jason Blog Messages · 0001 回滚（DOWN）
--
-- 作用域：只删除 `messages` schema 及其全部对象。
-- 对 public schema、既有业务表、既有策略**没有任何影响**。
--
-- ⚠️ 会连带删除已存私信数据（不可恢复）。执行前先导出：
--      node scripts/messages-db.mjs export --target=prod
-- =============================================================================

drop schema if exists messages cascade;
