import fs from 'fs';
import path from 'path';

/**
 * Script to generate base KML files for major Monterrey bus routes.
 * These can be imported into Google My Maps to easily draw the actual street routes,
 * then exported back as final KMLs for the app to consume.
 */

const ROUTES = [
  { id: 'ruta-207', name: 'Ruta 207 Escobedo - Centro', color: '#ff0000' },
  { id: 'ruta-214', name: 'Ruta 214 Guadalupe - San Pedro', color: '#00ff00' },
  { id: 'ruta-223', name: 'Ruta 223 Las Huertas - Centro', color: '#0000ff' },
  { id: 'transmetro-sendero', name: 'Transmetro Sendero - Apodaca', color: '#ff8800' },
  { id: 'transmetro-talleres', name: 'Transmetro Talleres - Cabezada', color: '#ff8800' },
];

function generateKmlTemplate(routeParam: { id: string, name: string, color: string }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${routeParam.name}</name>
    <description>Plantilla para dibujar la ruta en Google My Maps</description>
    <Style id="lineStyle">
      <LineStyle>
        <color>ff${routeParam.color.replace('#', '')}</color>
        <width>4</width>
      </LineStyle>
    </Style>
    <Placemark>
      <name>Trayecto Directo</name>
      <styleUrl>#lineStyle</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
          <!-- Reemplaza esto trazando la línea en Google My Maps -->
          -100.3161,25.6866,0
          -100.3100,25.6900,0
        </coordinates>
      </LineString>
    </Placemark>
    <Folder>
      <name>Paradas Principales</name>
      <Placemark>
        <name>Terminal Origen</name>
        <Point><coordinates>-100.3161,25.6866,0</coordinates></Point>
      </Placemark>
      <Placemark>
        <name>Terminal Destino</name>
        <Point><coordinates>-100.3100,25.6900,0</coordinates></Point>
      </Placemark>
    </Folder>
  </Document>
</kml>`;
}

const OUT_DIR = path.join(process.cwd(), 'static', 'kml', 'templates');

// Ensure directory exists
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

// Generate files
console.log('Generating KML templates...');
for (const route of ROUTES) {
  const kml = generateKmlTemplate(route);
  const filePath = path.join(OUT_DIR, `${route.id}.kml`);
  fs.writeFileSync(filePath, kml);
  console.log(`✅ Created ${filePath}`);
}

console.log('\n¡Listo! Puedes importar estos archivos .kml en Google My Maps (mymaps.google.com).');
console.log('Una vez que traces la ruta real por las calles, exporta el KML final y guárdalo en /static/kml/');
