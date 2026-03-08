import { createClient } from '@supabase/supabase-js';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { embed } from 'ai';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load variables from .env
dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabaseAdmin = createClient(
  process.env.PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY || ''
);

const MTY_LOCATIONS = [
  {
    name: "Parque Fundidora",
    category: "poi",
    description: "Un parque urbano gigante en el corazón de Monterrey. Ideal para caminar, eventos y conecta con Cintermex y Paseo Santa Lucía.",
    metadata: { "cost": "Gratis", "metro_station": "Parque Fundidora (L1)" }
  },
  {
    name: "Ruta 220 Provisiones",
    category: "route",
    description: "Ruta de transporte urbano que conecta Escobedo con el Centro de Monterrey, bajando por Universidad y Pino Suárez.",
    metadata: { "cost": "$15.00 MXN", "payment": "Urbani, Me Muevo, Efectivo" }
  },
  {
    name: "Macroplaza",
    category: "poi",
    description: "La plaza principal de Monterrey, rodeada por el Palacio de Gobierno, el Museo de Historia Mexicana y MARCO. Excelente punto de transbordo.",
    metadata: { "cost": "Gratis", "metro_station": "Zaragoza (L2)" }
  },
  {
    name: "Estación Universidad",
    category: "station",
    description: "Estación de la Línea 2 del metro, ubicada afuera de la UANL (Universidad Autónoma de Nuevo León). Tiene mucha afluencia de estudiantes.",
    metadata: { "lines": ["Línea 2"], "transfers": ["Transmetro San Nicolás"] }
  },
  {
    name: "Hospital Santa Lucía",
    category: "poi",
    description: "Hospital oftalmológico ubicado en el centro de Monterrey, cerca de la avenida Cuauhtémoc y Juan Ignacio Ramón.",
    metadata: { "metro_station": "Alameda (L2) o Fundadores (L2)" }
  },
  {
    name: "Pabellón M",
    category: "poi",
    description: "Auditorio y edificio corporativo en el centro de Monterrey por Avenida Constitución y Juárez.",
    metadata: { "metro_station": "Padre Mier (L2) a 5 cuadras" }
  }
];

async function seed() {
  console.log("Starting seed script for RegioRuta Locations RAG...");
  
  if (!process.env.GEMINI_API_KEY) {
    console.error("Missing GEMINI_API_KEY in .env");
    return;
  }

  for (const loc of MTY_LOCATIONS) {
    console.log(`Processing ${loc.name}...`);
    try {
      // 1. Generate text embedding using Gemini
      const textToEmbed = `${loc.name}. ${loc.description} Categoría: ${loc.category}`;
      const google = createGoogleGenerativeAI({
        apiKey: process.env.GEMINI_API_KEY || ''
      });
      
      const { embedding } = await embed({
        model: google.textEmbeddingModel('text-embedding-004'),
        value: textToEmbed,
      });

      // 2. Insert into Supabase
      const { error } = await supabaseAdmin
        .from('locations_rag')
        .insert({
          name: loc.name,
          description: loc.description,
          category: loc.category,
          metadata: loc.metadata,
          embedding: embedding
        });

      if (error) {
        console.error(`Error inserting ${loc.name}:`, error.message);
      } else {
        console.log(`✅ Inserted ${loc.name} successfully.`);
      }
    } catch (e) {
      console.error(`Error processing embedding for ${loc.name}:`, e);
    }
  }

  console.log("Seed script completed!");
}

seed();
