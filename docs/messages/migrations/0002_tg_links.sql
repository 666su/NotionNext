-- 0002_tg_links.sql —— Telegram 双向通道映射（Phase 7）
--
-- 目的：
--   1) 站点推送访客私信到 TG 后，记住「这条 TG 消息 → 哪个会话」，
--      你「回复」那条消息时就能定点写回访客。
--   2) 记录已处理的 update_id，避免 Telegram 重投导致重复入库。
--
-- 约束沿用 0001：只给 service_role，RLS 全开且零策略（anon/authenticated 无任何权限）。

create table if not exists messages.tg_links (
  id                bigserial primary key,
  tg_chat_id        bigint      not null,
  tg_message_id     bigint      not null,
  conversation_id   text        not null references messages.conversations (id) on delete cascade,
  source_message_id text        references messages.messages (id) on delete set null,
  kind              text        not null default 'notify',
  created_at        timestamptz not null default now(),
  constraint tg_links_chat_msg_key unique (tg_chat_id, tg_message_id)
);

comment on table messages.tg_links is 'TG 通知消息与私信会话的映射，用于把 TG 里的"回复"路由回对应会话';
comment on column messages.tg_links.source_message_id is '触发这次通知的访客消息（可空，会话创建时也可能触发）';
comment on column messages.tg_links.kind is 'notify = 访客消息通知；后续可扩展 summary/reminder';

create index if not exists tg_links_conversation_idx
  on messages.tg_links (conversation_id, created_at desc);

create index if not exists tg_links_chat_idx
  on messages.tg_links (tg_chat_id, created_at desc);

create table if not exists messages.tg_updates (
  update_id  bigint      primary key,
  handled_at timestamptz not null default now(),
  note       text
);

comment on table messages.tg_updates is '已处理的 Telegram update_id，保证 webhook 重投时不重复写入';

alter table messages.tg_links   enable row level security;
alter table messages.tg_updates enable row level security;

revoke all on messages.tg_links   from anon, authenticated;
revoke all on messages.tg_updates from anon, authenticated;

grant all on messages.tg_links   to service_role;
grant all on messages.tg_updates to service_role;
grant usage, select on all sequences in schema messages to service_role;
