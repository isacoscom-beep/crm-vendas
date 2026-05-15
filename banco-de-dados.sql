-- ============================================================
-- CRM VENDAS — Criação das tabelas no Supabase
-- Cole este SQL no Supabase > SQL Editor > New Query
-- ============================================================

-- CLIENTES
create table if not exists clientes (
  id uuid default gen_random_uuid() primary key,
  nome text not null,
  whatsapp text unique,
  email text,
  cidade text,
  rota text,
  canal text default 'WhatsApp',
  status text default 'Ativo',
  ultimo_pedido date,
  obs text,
  criado_em timestamptz default now()
);

-- PEDIDOS
create table if not exists pedidos (
  id uuid default gen_random_uuid() primary key,
  id_externo text unique,
  cliente_id uuid references clientes(id),
  cliente_nome text,
  canal text,
  valor numeric(10,2) default 0,
  status text default 'Processando',
  criado_em timestamptz default now()
);

-- OPORTUNIDADES (Pipeline)
create table if not exists oportunidades (
  id uuid default gen_random_uuid() primary key,
  nome text not null,
  cliente_id uuid references clientes(id),
  valor numeric(10,2) default 0,
  etapa text default 'Prospecção',
  canal text,
  obs text,
  criado_em timestamptz default now()
);

-- ROTAS DIÁRIAS (geradas automaticamente pela expedição)
create table if not exists rotas_diarias (
  id uuid default gen_random_uuid() primary key,
  mensagem_original text,
  cidades text[],
  data_entrega date,
  clientes_notificados int default 0,
  criado_em timestamptz default now()
);

-- CONVERSAS WHATSAPP
create table if not exists conversas (
  id uuid default gen_random_uuid() primary key,
  whatsapp text unique,
  cliente_id uuid references clientes(id),
  ultima_mensagem text,
  status text default 'Recebido',
  atualizado_em timestamptz default now()
);

-- ATIVIDADES (log de eventos)
create table if not exists atividades (
  id uuid default gen_random_uuid() primary key,
  tipo text,
  descricao text,
  criado_em timestamptz default now()
);

-- Habilitar acesso público (necessário para o CRM funcionar)
alter table clientes enable row level security;
alter table pedidos enable row level security;
alter table oportunidades enable row level security;
alter table rotas_diarias enable row level security;
alter table conversas enable row level security;
alter table atividades enable row level security;

create policy "Acesso total" on clientes for all using (true);
create policy "Acesso total" on pedidos for all using (true);
create policy "Acesso total" on oportunidades for all using (true);
create policy "Acesso total" on rotas_diarias for all using (true);
create policy "Acesso total" on conversas for all using (true);
create policy "Acesso total" on atividades for all using (true);
