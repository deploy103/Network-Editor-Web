create table if not exists users (
  id text primary key,
  name text not null check (length(name) between 1 and 80),
  username text not null unique check (length(username) between 3 and 40),
  email text not null unique check (position('@' in email) > 1),
  birth_date date not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id text primary key,
  owner_id text not null references users(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_owner_updated_idx on projects(owner_id, updated_at desc);
create unique index if not exists users_username_lower_idx on users(lower(username));
create unique index if not exists users_email_lower_idx on users(lower(email));
