-- 0003_create_fastpath.down.sql
-- 只删 RPC 与 create_key（回滚后旧代码用 Redis 幂等，仍可工作）

drop function if exists messages.create_conversation_fast(text, text, text, text, text, text, text, text, text);
drop index if exists messages.conversations_create_key_uniq;
alter table messages.conversations drop column if exists create_key;
