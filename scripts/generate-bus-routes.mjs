/**
 * generate-bus-routes.mjs
 *
 * Reads KML files from static/kml/, extracts IDA/VUELTA coordinates,
 * generates bus stops (distance-based + transfer-forced), and outputs
 * a TypeScript data module at src/lib/data/busRoutesGenerated.ts.
 *
 * Run: node scripts/generate-bus-routes.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Configuration ──

const STOP_INTERVAL_METERS = 800;      // Place a stop every ~800m
const TRANSFER_RADIUS_METERS = 300;    // Force a stop if route passes within 300m of metro/ecovia
const DEDUP_RADIUS_METERS = 200;       // Don't place two stops within 200m of each other

const KML_DIR = path.join(__dirname, '..', 'static', 'kml');
const OUT_FILE = path.join(__dirname, '..', 'src', 'lib', 'data', 'busRoutesGenerated.ts');

// Route definitions: filename → route IDs, colors, labels
const ROUTE_DEFS = [
  {
    file: 'Ruta 1 Central.kml',
    idaId: 'ruta-1-central-ida',
    vueltaId: 'ruta-1-central-vuelta',
    idaColor: '#006064',
    vueltaColor: '#F57C00',
    label: 'Ruta 1 Central',
    shortName: 'R1',
  },
  {
    file: 'Ruta 13 C4.kml',
    idaId: 'ruta-13-c4-ida',
    vueltaId: 'ruta-13-c4-vuelta',
    idaColor: '#097138',
    vueltaColor: '#87CEAC',
    label: 'Ruta 13 C4',
    shortName: 'R13',
  },
  {
    file: 'Ruta 220 Pedregal.kml',
    idaId: 'ruta-220-pedregal-ida',
    vueltaId: 'ruta-220-pedregal-vuelta',
    idaColor: '#0288D1',
    vueltaColor: '#BDBDBD',
    label: 'Ruta 220 Pedregal',
    shortName: 'R220',
  },
  {
    file: 'Ruta 226 Bosques.kml',
    idaId: 'ruta-226-bosques-ida',
    vueltaId: 'ruta-226-bosques-vuelta',
    idaColor: '#C2185B',
    vueltaColor: '#F48FB1',
    label: 'Ruta 226 Bosques',
    shortName: 'R226',
  },
  {
    file: 'Ruta La Unidad - Laredo - UTE.kml',
    idaId: 'ruta-unidad-laredo-ida',
    vueltaId: 'ruta-unidad-laredo-vuelta',
    idaColor: '#9C27B0',
    vueltaColor: '#CE93D8',
    label: 'Ruta La Unidad-Laredo-UTE',
    shortName: 'RU',
  },
];

// All metro/ecovia stations for transfer detection
// Extracted from src/lib/data/transitRoutes.ts
const TRANSIT_STATIONS = [
  // metro-1
  { name: 'Talleres',         coords: [-100.36528, 25.75389], routeId: 'metro-1' },
  { name: 'San Bernabé',      coords: [-100.36167, 25.74833], routeId: 'metro-1' },
  { name: 'Unidad Modelo',    coords: [-100.35500, 25.74194], routeId: 'metro-1' },
  { name: 'Aztlán',           coords: [-100.34750, 25.73222], routeId: 'metro-1' },
  { name: 'Penitenciaría',    coords: [-100.34250, 25.72333], routeId: 'metro-1' },
  { name: 'Alfonso Reyes',    coords: [-100.34250, 25.71611], routeId: 'metro-1' },
  { name: 'Mitras',           coords: [-100.34250, 25.70556], routeId: 'metro-1' },
  { name: 'Simón Bolívar',    coords: [-100.34250, 25.70556], routeId: 'metro-1' },
  { name: 'Hospital',         coords: [-100.34417, 25.69194], routeId: 'metro-1' },
  { name: 'Edison',           coords: [-100.33361, 25.68694], routeId: 'metro-1' },
  { name: 'Central',          coords: [-100.32444, 25.68694], routeId: 'metro-1' },
  { name: 'Cuauhtémoc',       coords: [-100.31694, 25.68611], routeId: 'metro-1' },
  { name: 'Del Golfo',        coords: [-100.30663, 25.68512], routeId: 'metro-1' },
  { name: 'Félix U. Gómez',   coords: [-100.29667, 25.68389], routeId: 'metro-1' },
  { name: 'Parque Fundidora', coords: [-100.28806, 25.68361], routeId: 'metro-1' },
  { name: 'Y Griega',         coords: [-100.27933, 25.68332], routeId: 'metro-1' },
  { name: 'Eloy Cavazos',     coords: [-100.26417, 25.68000], routeId: 'metro-1' },
  { name: 'Lerdo de Tejada',  coords: [-100.25278, 25.67972], routeId: 'metro-1' },
  { name: 'Exposición',       coords: [-100.24556, 25.67944], routeId: 'metro-1' },
  // metro-2
  { name: 'Sendero',            coords: [-100.29278, 25.76861], routeId: 'metro-2' },
  { name: 'Santiago Tapia',      coords: [-100.29568, 25.75926], routeId: 'metro-2' },
  { name: 'San Nicolás',         coords: [-100.29805, 25.75262], routeId: 'metro-2' },
  { name: 'Anáhuac',             coords: [-100.30250, 25.74028], routeId: 'metro-2' },
  { name: 'Universidad',         coords: [-100.30833, 25.72444], routeId: 'metro-2' },
  { name: 'Niños Héroes',        coords: [-100.31111, 25.71722], routeId: 'metro-2' },
  { name: 'Regina',              coords: [-100.31410, 25.70790], routeId: 'metro-2' },
  { name: 'General Anaya',       coords: [-100.31667, 25.69694], routeId: 'metro-2' },
  { name: 'Cuauhtémoc',          coords: [-100.31694, 25.68611], routeId: 'metro-2' },
  { name: 'Alameda',             coords: [-100.31833, 25.67694], routeId: 'metro-2' },
  { name: 'Fundadores',          coords: [-100.31970, 25.67267], routeId: 'metro-2' },
  { name: 'Padre Mier',          coords: [-100.31544, 25.66888], routeId: 'metro-2' },
  { name: 'Gral. I. Zaragoza',   coords: [-100.31028, 25.66778], routeId: 'metro-2' },
  // metro-3
  { name: 'Hospital Metropolitano', coords: [-100.2772839, 25.7128591], routeId: 'metro-3' },
  { name: 'Ruiz Cortines',          coords: [-100.2866477, 25.7053915], routeId: 'metro-3' },
  { name: 'Los Ángeles',            coords: [-100.2835807, 25.7073161], routeId: 'metro-3' },
  { name: 'Moderna',                coords: [-100.2948623, 25.6990452], routeId: 'metro-3' },
  { name: 'Metalúrgicos',           coords: [-100.296021,  25.689965],  routeId: 'metro-3' },
  { name: 'Félix U. Gómez',         coords: [-100.29667,   25.68389],   routeId: 'metro-3' },
  { name: 'Colonia Obrera',          coords: [-100.297599,  25.678355],  routeId: 'metro-3' },
  { name: 'Santa Lucía',            coords: [-100.298538,  25.671483],  routeId: 'metro-3' },
  { name: 'Gral. I. Zaragoza',      coords: [-100.31028,   25.66778],   routeId: 'metro-3' },
  // ecovia
  { name: 'Lincoln',               coords: [-100.421266, 25.769230], routeId: 'ecovia' },
  { name: 'Astros',                coords: [-100.407573, 25.763399], routeId: 'ecovia' },
  { name: 'Cumbres',               coords: [-100.402578, 25.759777], routeId: 'ecovia' },
  { name: 'Plumbago',              coords: [-100.397400, 25.756060], routeId: 'ecovia' },
  { name: 'Plutarco Elías Calles', coords: [-100.392201, 25.752295], routeId: 'ecovia' },
  { name: 'Embotelladora',         coords: [-100.387572, 25.748944], routeId: 'ecovia' },
  { name: 'Panteón Municipal',     coords: [-100.381387, 25.742571], routeId: 'ecovia' },
  { name: 'Cardenal',              coords: [-100.378175, 25.738978], routeId: 'ecovia' },
  { name: 'Valle Verde',           coords: [-100.373218, 25.733439], routeId: 'ecovia' },
  { name: 'Cardiología',           coords: [-100.369982, 25.729829], routeId: 'ecovia' },
  { name: 'Santa Cecilia',         coords: [-100.366670, 25.726162], routeId: 'ecovia' },
  { name: 'Villa Mitras',          coords: [-100.362000, 25.722500], routeId: 'ecovia' },
  { name: 'Rangel Frías',          coords: [-100.357306, 25.719186], routeId: 'ecovia' },
  { name: 'Tránsito',              coords: [-100.353849, 25.716975], routeId: 'ecovia' },
  { name: 'Laredo',                coords: [-100.346749, 25.712277], routeId: 'ecovia' },
  { name: 'Rodrigo Gómez',         coords: [-100.343420, 25.710071], routeId: 'ecovia' },
  { name: 'Mitras',                coords: [-100.342401, 25.706313], routeId: 'ecovia' },
  { name: 'Celulosa',              coords: [-100.337762, 25.704670], routeId: 'ecovia' },
  { name: '20 de Noviembre',       coords: [-100.332830, 25.704562], routeId: 'ecovia' },
  { name: 'Hidalgo',               coords: [-100.322154, 25.704370], routeId: 'ecovia' },
  { name: 'Bella Vista',           coords: [-100.318883, 25.704303], routeId: 'ecovia' },
  { name: 'Regina',                coords: [-100.313560, 25.707910], routeId: 'ecovia' },
  { name: 'Asarco',                coords: [-100.309466, 25.704116], routeId: 'ecovia' },
  { name: 'Cementos',              coords: [-100.296928, 25.703921], routeId: 'ecovia' },
  { name: 'Ruiz Cortines',         coords: [-100.288869, 25.703753], routeId: 'ecovia' },
  { name: 'Clínica 15',            coords: [-100.284001, 25.703679], routeId: 'ecovia' },
  { name: 'Coyoacán',              coords: [-100.278658, 25.703597], routeId: 'ecovia' },
  { name: 'Churubusco',            coords: [-100.269407, 25.703461], routeId: 'ecovia' },
  { name: 'Vidriera',              coords: [-100.260575, 25.703273], routeId: 'ecovia' },
  { name: 'Adolfo Prieto',         coords: [-100.254319, 25.703170], routeId: 'ecovia' },
  { name: 'Las Américas',          coords: [-100.247648, 25.703060], routeId: 'ecovia' },
  { name: 'Central de Carga',      coords: [-100.239086, 25.702914], routeId: 'ecovia' },
  { name: 'Tauro',                 coords: [-100.230405, 25.702759], routeId: 'ecovia' },
  { name: 'Miguel Alemán',         coords: [-100.223559, 25.702563], routeId: 'ecovia' },
  { name: 'Calle Nueva',           coords: [-100.217468, 25.703017], routeId: 'ecovia' },
  { name: 'La Zanja',              coords: [-100.208341, 25.704677], routeId: 'ecovia' },
  { name: 'Aceros',                coords: [-100.200589, 25.707374], routeId: 'ecovia' },
  { name: 'Guadalajara',           coords: [-100.194430, 25.708810], routeId: 'ecovia' },
  { name: 'San Miguel',            coords: [-100.187989, 25.709028], routeId: 'ecovia' },
  { name: 'Valle Fértil',          coords: [-100.166208, 25.705515], routeId: 'ecovia' },
  { name: 'Valle Soleado',         coords: [-100.158342, 25.703437], routeId: 'ecovia' },
];

// ── Haversine ──

function haversine(c1, c2) {
  const R = 6371000;
  const [lng1, lat1] = c1;
  const [lng2, lat2] = c2;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── KML Parser ──

function parseKml(xmlText) {
  // Extract all placemarks with name and coordinates
  const placemarks = [];
  const pmRegex = /<Placemark>([\s\S]*?)<\/Placemark>/g;
  let match;
  while ((match = pmRegex.exec(xmlText)) !== null) {
    const block = match[1];
    const nameMatch = block.match(/<name>(.*?)<\/name>/);
    const coordMatch = block.match(/<coordinates>([\s\S]*?)<\/coordinates>/);
    if (nameMatch && coordMatch) {
      const name = nameMatch[1].trim();
      const coordsText = coordMatch[1].trim();
      const coords = coordsText
        .split(/\s+/)
        .filter(s => s.length > 0)
        .map(s => {
          const [lng, lat] = s.split(',').map(Number);
          return [lng, lat];
        })
        .filter(c => !isNaN(c[0]) && !isNaN(c[1]));
      placemarks.push({ name, coords });
    }
  }

  // Identify IDA and VUELTA
  let ida = null;
  let vuelta = null;
  for (const pm of placemarks) {
    const upper = pm.name.toUpperCase();
    if (upper.includes('IDA') || upper.includes('VÍA 1') || upper.includes('VIA 1')) {
      ida = pm.coords;
    } else if (upper.includes('VUELTA') || upper.includes('VÍA 2') || upper.includes('VIA 2')) {
      vuelta = pm.coords;
    }
  }

  // Fallback: if only one placemark or names don't match, use order
  if (!ida && !vuelta && placemarks.length >= 2) {
    ida = placemarks[0].coords;
    vuelta = placemarks[1].coords;
  } else if (!ida && !vuelta && placemarks.length === 1) {
    ida = placemarks[0].coords;
    vuelta = placemarks[0].coords;
  }

  return { ida: ida || [], vuelta: vuelta || [] };
}

// ── Bus Stop Generator ──

/**
 * Find the closest point on the linestring to a given station.
 * Returns { index, distance, coord }.
 */
function findClosestPoint(lineCoords, stationCoord) {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < lineCoords.length; i++) {
    const d = haversine(lineCoords[i], stationCoord);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return { index: bestIdx, distance: bestDist, coord: lineCoords[bestIdx] };
}

/**
 * Generate stops along a linestring.
 *
 * 1. Distance-based: every ~800m
 * 2. Transfer-forced: wherever route passes within 300m of a metro/ecovia station
 * 3. Dedup: merge stops within 200m
 */
function generateStops(lineCoords, shortName, direction, busRouteId) {
  if (lineCoords.length === 0) return [];

  // Pass 1: Find transfer points (route passes near metro/ecovia stations)
  const transferStops = [];
  const seenStations = new Set(); // Avoid duplicate transfers to same station

  for (const station of TRANSIT_STATIONS) {
    const closest = findClosestPoint(lineCoords, station.coords);
    if (closest.distance <= TRANSFER_RADIUS_METERS) {
      // Deduplicate: same station name on different lines (e.g., Cuauhtémoc on metro-1 and metro-2)
      // We want ONE bus stop that transfers to ALL matching lines
      const key = station.name;
      if (seenStations.has(key)) {
        // Add this routeId to the existing transfer stop
        const existing = transferStops.find(t => t.name === station.name);
        if (existing && !existing.transferTo.includes(station.routeId)) {
          existing.transferTo.push(station.routeId);
        }
        continue;
      }
      seenStations.add(key);

      transferStops.push({
        index: closest.index,
        coord: closest.coord,
        name: station.name,       // Use EXACT metro/ecovia station name for Pass 3 matching
        transferTo: [station.routeId],
        isTransfer: true,
      });
    }
  }

  // Pass 2: Distance-based stops along the linestring
  const distanceStops = [];
  let accumulated = 0;
  let stopNum = 1;

  // Always place a stop at the start (terminal)
  distanceStops.push({
    index: 0,
    coord: lineCoords[0],
    name: `${shortName} ${direction} T1`,
    transferTo: [],
    isTransfer: false,
  });

  for (let i = 1; i < lineCoords.length; i++) {
    accumulated += haversine(lineCoords[i - 1], lineCoords[i]);
    if (accumulated >= STOP_INTERVAL_METERS) {
      distanceStops.push({
        index: i,
        coord: lineCoords[i],
        name: `${shortName} ${direction} P${stopNum}`,
        transferTo: [],
        isTransfer: false,
      });
      stopNum++;
      accumulated = 0;
    }
  }

  // Always place a stop at the end (terminal)
  const lastIdx = lineCoords.length - 1;
  const lastStop = distanceStops[distanceStops.length - 1];
  if (!lastStop || lastStop.index !== lastIdx) {
    distanceStops.push({
      index: lastIdx,
      coord: lineCoords[lastIdx],
      name: `${shortName} ${direction} T2`,
      transferTo: [],
      isTransfer: false,
    });
  }

  // Pass 3: Merge — transfer stops take priority, remove distance stops too close to transfers
  const allStops = [...transferStops, ...distanceStops];

  // Sort by position along the linestring
  allStops.sort((a, b) => a.index - b.index);

  // Dedup: remove distance-based stops that are within DEDUP_RADIUS of a transfer stop
  const finalStops = [];
  for (const stop of allStops) {
    if (stop.isTransfer) {
      // Transfer stops always survive — but remove any nearby non-transfer stops already added
      // (check backwards)
      while (
        finalStops.length > 0 &&
        !finalStops[finalStops.length - 1].isTransfer &&
        haversine(finalStops[finalStops.length - 1].coord, stop.coord) < DEDUP_RADIUS_METERS
      ) {
        finalStops.pop();
      }
      finalStops.push(stop);
    } else {
      // Distance stop — skip if too close to last stop (transfer or not)
      if (finalStops.length > 0) {
        const prev = finalStops[finalStops.length - 1];
        if (haversine(prev.coord, stop.coord) < DEDUP_RADIUS_METERS) {
          continue;
        }
      }
      finalStops.push(stop);
    }
  }

  return finalStops;
}

// ── Main ──

console.log('=== Bus Route Generator ===\n');

const routeEntries = [];
let totalStops = 0;
let totalTransfers = 0;

for (const def of ROUTE_DEFS) {
  const kmlPath = path.join(KML_DIR, def.file);
  if (!fs.existsSync(kmlPath)) {
    console.warn(`⚠️  KML not found: ${def.file}`);
    continue;
  }

  const xml = fs.readFileSync(kmlPath, 'utf-8');
  const { ida, vuelta } = parseKml(xml);

  console.log(`📄 ${def.file}`);
  console.log(`   IDA: ${ida.length} coords, VUELTA: ${vuelta.length} coords`);

  // Generate stops for IDA
  const idaStops = generateStops(ida, def.shortName, 'I', def.idaId);
  const idaTransfers = idaStops.filter(s => s.isTransfer);
  console.log(`   IDA stops: ${idaStops.length} (${idaTransfers.length} transfers)`);
  for (const t of idaTransfers) {
    console.log(`     ↔ ${t.name} → [${t.transferTo.join(', ')}]`);
  }

  // Generate stops for VUELTA
  const vueltaStops = generateStops(vuelta, def.shortName, 'V', def.vueltaId);
  const vueltaTransfers = vueltaStops.filter(s => s.isTransfer);
  console.log(`   VUELTA stops: ${vueltaStops.length} (${vueltaTransfers.length} transfers)`);
  for (const t of vueltaTransfers) {
    console.log(`     ↔ ${t.name} → [${t.transferTo.join(', ')}]`);
  }

  totalStops += idaStops.length + vueltaStops.length;
  totalTransfers += idaTransfers.length + vueltaTransfers.length;

  routeEntries.push({
    routeId: def.idaId,
    color: def.idaColor,
    label: `${def.label} (IDA)`,
    lineCoords: ida,
    stops: idaStops,
  });

  routeEntries.push({
    routeId: def.vueltaId,
    color: def.vueltaColor,
    label: `${def.label} (VUELTA)`,
    lineCoords: vuelta,
    stops: vueltaStops,
  });

  console.log('');
}

console.log(`\n📊 Total: ${routeEntries.length} routes, ${totalStops} stops, ${totalTransfers} transfer points\n`);

// ── Generate TypeScript ──

function formatCoord(c) {
  return `[${c[0].toFixed(6)}, ${c[1].toFixed(6)}]`;
}

function formatStation(stop, busRouteId) {
  const transfer = stop.transferTo.length > 0
    ? `, transfer: [${stop.transferTo.map(r => `'${r}'`).join(', ')}] as RouteId[]`
    : '';
  return `      { name: '${stop.name.replace(/'/g, "\\'")}', coordinates: ${formatCoord(stop.coord)}${transfer} },`;
}

let ts = `/**
 * AUTO-GENERATED by scripts/generate-bus-routes.mjs
 * Do not edit manually. Re-run the script to regenerate.
 *
 * Generated: ${new Date().toISOString()}
 * Routes: ${routeEntries.length}
 * Total stops: ${totalStops}
 * Transfer points: ${totalTransfers}
 */

import type { RouteId, TransitRoute } from './transitRoutes';

export const busRoutes: Partial<Record<RouteId, TransitRoute>> = {\n`;

for (const entry of routeEntries) {
  // Build GeoJSON line coordinates (use full KML coords, truncated to 6 decimals)
  const lineCoords = entry.lineCoords
    .map(c => `          ${formatCoord(c)}`)
    .join(',\n');

  // Build stations
  const stationLines = entry.stops
    .map(s => formatStation(s, entry.routeId))
    .join('\n');

  ts += `  '${entry.routeId}': {
    color: '${entry.color}',
    label: '${entry.label}',
    line: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { name: '${entry.label}', color: '${entry.color}' },
        geometry: {
          type: 'LineString',
          coordinates: [
${lineCoords}
          ]
        }
      }]
    },
    stations: [
${stationLines}
    ]
  },

`;
}

ts += `};\n`;

fs.writeFileSync(OUT_FILE, ts, 'utf-8');
console.log(`✅ Generated ${OUT_FILE}`);
console.log(`   File size: ${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB`);
