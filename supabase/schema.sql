-- SiarnoWatch v0.2 database schema for Supabase
-- Run this entire file once in Supabase -> SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  bio text not null default '' check (char_length(bio) <= 160),
  avatar_text text not null default '?' check (char_length(avatar_text) between 1 and 3),
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_uq
  on public.profiles (lower(username));

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 280),
  created_at timestamptz not null default now()
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists posts_author_id_idx on public.posts (author_id);

create table if not exists public.likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.likes enable row level security;
alter table public.follows enable row level security;

-- Public reading
create policy "profiles are public"
  on public.profiles for select
  to anon, authenticated
  using (true);

create policy "posts are public"
  on public.posts for select
  to anon, authenticated
  using (true);

create policy "likes are public"
  on public.likes for select
  to anon, authenticated
  using (true);

create policy "follows are public"
  on public.follows for select
  to anon, authenticated
  using (true);

-- Profiles: users may change only their own profile.
create policy "users update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Posts: authenticated users may create/delete only their own posts.
create policy "users create own posts"
  on public.posts for insert
  to authenticated
  with check (auth.uid() = author_id);

create policy "users delete own posts"
  on public.posts for delete
  to authenticated
  using (auth.uid() = author_id);

-- Likes
create policy "users create own likes"
  on public.likes for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "users delete own likes"
  on public.likes for delete
  to authenticated
  using (auth.uid() = user_id);

-- Follows
create policy "users create own follows"
  on public.follows for insert
  to authenticated
  with check (auth.uid() = follower_id);

create policy "users delete own follows"
  on public.follows for delete
  to authenticated
  using (auth.uid() = follower_id);

-- Automatically create a public profile when an Auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  requested_username text;
  requested_display_name text;
begin
  requested_username := coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), 'user_' || substr(replace(new.id::text, '-', ''), 1, 8));
  requested_display_name := coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), requested_username);

  insert into public.profiles (id, username, display_name, avatar_text)
  values (
    new.id,
    requested_username,
    requested_display_name,
    upper(substr(requested_username, 1, 2))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
