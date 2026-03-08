-- Habilitar extensión pgvector para el RAG
create extension if not exists vector
with
  schema extensions;

-- Tabla para almacenar los lugares y rutas de Monterrey
create table locations_rag (
  id uuid primary key default gen_random_uuid(),
  name text not null, -- Ej. "Fundidora", "Ruta 220"
  description text, -- Descripción rica para el LLM
  category text, -- 'poi' (Punto de interés), 'route' (Ruta), 'station' (Estación de metro)
  embedding extensions.vector(768), -- Asumiendo embeddings de Gemini (por defecto text-embedding-004 es 768 dimensiones)
  metadata jsonb -- Extra info como horarios, costo, etc.
);

-- Habilitar RLS (Row Level Security) para poder consultar desde el frontend si el anon_key se expone
alter table locations_rag enable row level security;

-- Política de lectura pública: Cualquiera puede consultar locaciones
create policy "Locations are viewable by everyone" on locations_rag
  for select using (true);

-- Función para buscar lugares similares (Vector Similarity Search)
create or replace function match_locations (
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  name text,
  description text,
  category text,
  metadata jsonb,
  similarity float
)
language sql
as $$
  select
    locations_rag.id,
    locations_rag.name,
    locations_rag.description,
    locations_rag.category,
    locations_rag.metadata,
    1 - (locations_rag.embedding <=> query_embedding) as similarity
  from locations_rag
  where 1 - (locations_rag.embedding <=> query_embedding) > match_threshold
  order by locations_rag.embedding <=> query_embedding
  limit match_count;
$$;
