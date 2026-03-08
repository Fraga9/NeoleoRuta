import { createClient } from '@supabase/supabase-js';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { embed } from 'ai';
import { env } from '$env/dynamic/private';

// This file is used in the backend to manage database operations securely
export const supabaseAdmin = createClient(
  process.env.PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY || 'no-key-found'
);

// Helper to generate text embeddings for RAG
export async function getEmbedding(text: string) {
  const google = createGoogleGenerativeAI({
      apiKey: env.GEMINI_API_KEY || '',
  });
  const { embedding } = await embed({
    model: google.textEmbeddingModel('gemini-embedding-001'),
    value: text,
  });
  return embedding;
}
