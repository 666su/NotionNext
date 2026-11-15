-- =============================================================================
-- Jason Blog Messages · 0001 初始化
--
-- 目标：在现有 Supabase 项目内创建**独立 schema** `messages`，与 public 零耦合。
-- 影响面：只新增 `messages` schema 内的对象；不修改 public 下任何表、索引、策略。
-- 回滚：见同名 .down.sql（drop schema messages cascade）。
--
-- 权限模型：
--   * service_role 读写在服务端（Vercel Function）完成，绕过 RLS；
--   * anon / authenticated **不加任何 policy** → 即使拿到 anon key 也读不到一行；
--   * 显式 revoke 掉 public/anon/authenticated 的 schema 使用权限。
-- =============================================================================

create schema if not exists messages;

-- ---------------------------------------------------------------------------
-- 会话
-- ---------------------------------------------------------------------------
create table if not exists messages.conversations (
  id                text primary key,
  visitor_name      text not null,
  visitor_email     text,
  token_hash        text not null,
  status            text not null default 'unread'
                    check (status in ('unread','read','processing','resolved','archived','spam')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_message_at   timestamptz,
  last_visitor_at   timestamptz,
  last_admin_at     timestamptz,
  message_count     integer not null default 0,
  unread_count      integer not null default 0,
  resolved_at       timestamptz,
  archived_at       timestamptz,
  spam_at           timestamptz,
  deleted_at        timestamptz,
  first_path        text,
  meta              jsonb not null default '{}'::jsonb,
  constraint conversations_name_len   check (char_length(visitor_name) between 1 and 40),
  constraint conversations_email_len  check (visitor_email is null or char_length(visitor_email) <= 254),
  constraint conversations_token_hash check (char_length(token_hash) >= 32)
);

comment on table messages.conversations is '访客私信会话；token_hash = HMAC-SHA256(access_token, MESSAGE_TOKEN_SECRET)';

create index if not exists conversations_inbox_idx
  on messages.conversations (last_message_at desc nulls last)
  where deleted_at is null;

create index if not exists conversations_status_idx
  on messages.conversations (status)
  where deleted_at is null;

create index if not exists conversations_created_idx
  on messages.conversations (created_at desc);

-- 仅用于「spam 30 天后清理」的后台巡检
create index if not exists conversations_spam_idx
  on messages.conversations (spam_at)
  where status = 'spam' and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 消息
-- ---------------------------------------------------------------------------
create table if not exists messages.messages (
  id                text primary key,
  conversation_id   text not null
                    references messages.conversations(id) on delete cascade,
  sender            text not null check (sender in ('visitor','admin')),
  content           text not null,
  created_at        timestamptz not null default now(),
  read_at           timestamptz,
  client_request_id text,
  constraint messages_content_len check (char_length(content) between 1 and 5000)
);

comment on table messages.messages is '私信正文；只存纯文本，前端以文本节点渲染';

create index if not exists messages_conv_created_idx
  on messages.messages (conversation_id, created_at);

create index if not exists messages_created_idx
  on messages.messages (created_at desc);

-- 幂等：同一会话内 client_request_id 唯一（NULL 不参与唯一约束）
create unique index if not exists messages_idem_idx
  on messages.messages (conversation_id, client_request_id)
  where client_request_id is not null;

-- 未读消息快速定位（标记已读时用）
create index if not exists messages_unread_idx
  on messages.messages (conversation_id)
  where read_at is null and sender = 'visitor';

-- ---------------------------------------------------------------------------
-- 凭证兑换 / 访问审计（不含 token、不含明文 IP）
-- ---------------------------------------------------------------------------
create table if not exists messages.access_logs (
  id              bigint generated always as identity primary key,
  conversation_id text,
  action          text not null,
  result          text not null,
  ip_hash         text,
  created_at      timestamptz not null default now()
);

comment on table messages.access_logs is '只记 cid/动作/结果/ip 哈希前缀/时间；90 天保留';

create index if not exists access_logs_created_idx
  on messages.access_logs (created_at desc);

create index if not exists access_logs_conv_idx
  on messages.access_logs (conversation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 迁移台账
-- ---------------------------------------------------------------------------
create table if not exists messages.schema_migrations (
  version    text primary key,
  checksum   text not null,
  applied_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at 自动维护
-- ---------------------------------------------------------------------------
create or replace function messages.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists conversations_touch_updated_at on messages.conversations;
create trigger conversations_touch_updated_at
  before update on messages.conversations
  for each row execute function messages.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 权限：只给 service_role；anon / authenticated 一律无策略
-- ---------------------------------------------------------------------------
alter table messages.conversations      enable row level security;
alter table messages.messages           enable row level security;
alter table messages.access_logs        enable row level security;
alter table messages.schema_migrations  enable row level security;

revoke all on schema messages from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema messages from anon';
    execute 'revoke all on all tables in schema messages from anon';
    execute 'revoke all on all sequences in schema messages from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema messages from authenticated';
    execute 'revoke all on all tables in schema messages from authenticated';
    execute 'revoke all on all sequences in schema messages from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema messages to service_role';
    execute 'grant select, insert, update, delete on all tables in schema messages to service_role';
    execute 'grant usage, select on all sequences in schema messages to service_role';
  end if;
end;
$$;

-- 迁移台账由 scripts/messages-db.mjs 在成功后写入（version + checksum），此处不硬编码。
