-- طلباتي: تهيئة قاعدة البيانات ورفع المرفقات الخاص.
-- يمكن تشغيل هذا الملف على قاعدة سبق إنشاؤها بالنسخة الأولى.
-- احتفظ بسياسات RLS؛ لا تستخدم مفتاح service_role في الواجهة أبدًا.

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  client_name text not null check (char_length(client_name) between 2 and 100),
  contact text check (contact is null or char_length(contact) <= 80),
  type text not null check (type in ('social','identity','ad','print','other')),
  title text not null check (char_length(title) between 3 and 120),
  details text not null check (char_length(details) between 5 and 3000),
  due_date date,
  urgency text not null default 'normal' check (urgency in ('normal','urgent')),
  reference_url text,
  status text not null default 'new' check (status in ('new','progress','done')),
  completed_at timestamptz
);

-- حقول النسخة الثانية (غير مدمرة للبيانات القديمة).
alter table public.tasks add column if not exists formats text[] not null default '{}'::text[];
alter table public.tasks add column if not exists priority text not null default 'medium' check(priority in ('low','medium','high'));
alter table public.tasks add column if not exists reference_path text;
alter table public.tasks add column if not exists reference_name text;
create index if not exists tasks_created_at_idx on public.tasks(created_at desc);
create index if not exists tasks_status_due_date_idx on public.tasks(status,due_date);

alter table public.admins enable row level security;
alter table public.tasks enable row level security;
revoke all on public.admins from anon,authenticated;
revoke all on public.tasks from anon,authenticated;
grant select on public.admins to authenticated;
grant insert on public.tasks to anon;
grant select,insert,update,delete on public.tasks to authenticated;

-- DROP/CREATE حتى يمكن إعادة تشغيل ملف التفعيل دون تكرار السياسات.
drop policy if exists "admins can view their own membership" on public.admins;
create policy "admins can view their own membership" on public.admins for select to authenticated using (user_id=(select auth.uid()));
drop policy if exists "visitors can send new requests" on public.tasks;
create policy "visitors can send new requests" on public.tasks for insert to anon with check (
 status='new' and completed_at is null
 and (reference_path is null or (reference_path like (id::text || '/reference.%')))
 and (cardinality(formats)=0 or (type='social' and formats <@ array['post','story']::text[]))
);
drop policy if exists "admins can see all tasks" on public.tasks;
create policy "admins can see all tasks" on public.tasks for select to authenticated using (exists(select 1 from public.admins a where a.user_id=(select auth.uid())));
drop policy if exists "admins can create tasks" on public.tasks;
create policy "admins can create tasks" on public.tasks for insert to authenticated with check (exists(select 1 from public.admins a where a.user_id=(select auth.uid())));
drop policy if exists "admins can update tasks" on public.tasks;
create policy "admins can update tasks" on public.tasks for update to authenticated using (exists(select 1 from public.admins a where a.user_id=(select auth.uid()))) with check (exists(select 1 from public.admins a where a.user_id=(select auth.uid())));
drop policy if exists "admins can delete tasks" on public.tasks;
create policy "admins can delete tasks" on public.tasks for delete to authenticated using (exists(select 1 from public.admins a where a.user_id=(select auth.uid())));

-- مرفقات خاصة: لا يوجد عرض عام للملفات، المدير ينشئ روابط موقعة مؤقتة.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('design-references','design-references',false,15728640,
 array['image/png','image/jpeg','image/webp','image/gif','application/pdf','application/zip','application/x-zip-compressed','application/octet-stream'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- دالة تتحقق من أن المرفق يخص طلبًا حديثًا ومساره المسجل مطابق.
-- لأن الزائر المجهول لا يمكنه قراءة جدول المهام بفضل سياسات RLS.
create or replace function public.can_upload_design_reference(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists (
  select 1 from public.tasks t
  where t.reference_path = p_path and t.created_at > now()-interval '15 minutes'
 );
$$;
revoke all on function public.can_upload_design_reference(text) from public;
grant execute on function public.can_upload_design_reference(text) to anon,authenticated;

drop policy if exists "visitors upload only requested reference" on storage.objects;
create policy "visitors upload only requested reference"
on storage.objects for insert to anon,authenticated
with check (bucket_id='design-references' and public.can_upload_design_reference(name));

drop policy if exists "only admins can access references" on storage.objects;
create policy "only admins can access references"
on storage.objects for select to authenticated
using (bucket_id='design-references' and exists (select 1 from public.admins a where a.user_id=(select auth.uid())));

drop policy if exists "admins can remove references" on storage.objects;
create policy "admins can remove references"
on storage.objects for delete to authenticated
using (bucket_id='design-references' and exists (select 1 from public.admins a where a.user_id=(select auth.uid())));

-- بعد إنشاء مستخدم المدير من Authentication > Users، نفذ سطرًا مستقلاً بالقيمة الحقيقية:
-- insert into public.admins(user_id) values ('ضع-user-uid-هنا');
