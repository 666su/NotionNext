-- 0002_tg_links.down.sql —— 回滚 Telegram 双向通道映射
--
-- 只删本迁移新增的两张表；0001 的会话与消息数据不受影响。
-- 注意：回滚后 webhook 仍可能被调用，因此应用侧需同时删除路由或停用 webhook。

drop table if exists messages.tg_updates;
drop table if exists messages.tg_links;
