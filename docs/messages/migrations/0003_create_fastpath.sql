-- 0003_create_fastpath.sql —— 创建会话的"一次往返"路径（Phase 8）
--
-- 问题：createConversation 原本是
--   ① Redis 幂等查询 ② INSERT conversations ③ INSERT messages ④ Redis 写幂等
-- 四条串行网络往返，在 Vercel 上叠加后把"发私信"拖到 3s+。
--
-- 做法：
--   ① conversations 增加 create_key（= hash(ip + client_request_id)），唯一索引兜住并发重复；
--   ② 一个 plpgsql 函数把「建会话 + 写首条消息 + 幂等判定」合并成一次往返。
--
-- 兼容性：旧代码（若回滚）不写 create_key，唯一索引是部分索引（create_key is not null），不受影响。

alter table messages.conversations
  add column if not exists create_key text;

comment on column messages.conversations.create_key is '创建幂等键 = sha256(ipHash|client_request_id)，用于替代 Redis 去重';

create unique index if not exists conversations_create_key_uniq
  on messages.conversations (create_key)
  where create_key is not null;

create or replace function messages.create_conversation_fast(
  p_id            text,
  p_name          text,
  p_email         text,
  p_token_hash    text,
  p_create_key    text,
  p_first_path    text,
  p_message_id    text,
  p_content       text,
  p_client_request_id text
) returns table (conv_id text, is_duplicate boolean)
language plpgsql
security definer
as $$
declare
  existing_id text;
begin
  -- 幂等命中：同一来源重复提交（含并发）
  if p_create_key is not null then
    select c.id into existing_id
      from messages.conversations c
     where c.create_key = p_create_key
     limit 1;
    if existing_id is not null then
      return query select existing_id, true;
      return;
    end if;
  end if;

  begin
    insert into messages.conversations (
      id, visitor_name, visitor_email, token_hash, status,
      created_at, updated_at, last_message_at, last_visitor_at,
      message_count, unread_count, first_path, create_key
    ) values (
      p_id, p_name, p_email, p_token_hash, 'unread',
      now(), now(), now(), now(),
      1, 1, p_first_path, p_create_key
    );
  exception when unique_violation then
    -- 并发下另一条请求先插入成功 → 回读它的 id
    select c.id into existing_id
      from messages.conversations c
     where c.create_key = p_create_key
     limit 1;
    return query select existing_id, true;
    return;
  end;

  insert into messages.messages (
    id, conversation_id, sender, content, created_at, client_request_id
  ) values (
    p_message_id, p_id, 'visitor', p_content, now(), p_client_request_id
  );

  return query select p_id, false;
end;
$$;

revoke all on function messages.create_conversation_fast(text, text, text, text, text, text, text, text, text) from public;
grant execute on function messages.create_conversation_fast(text, text, text, text, text, text, text, text, text) to service_role;
