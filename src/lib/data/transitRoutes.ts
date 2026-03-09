export type RouteId =
  | 'metro-1' | 'metro-2' | 'metro-3' | 'ecovia'
  // Bus routes (IDA = outbound, VUELTA = return)
  | 'ruta-1-central-ida' | 'ruta-1-central-vuelta'
  | 'ruta-13-c4-ida' | 'ruta-13-c4-vuelta'
  | 'ruta-220-pedregal-ida' | 'ruta-220-pedregal-vuelta'
  | 'ruta-226-bosques-ida' | 'ruta-226-bosques-vuelta'
  | 'ruta-unidad-laredo-ida' | 'ruta-unidad-laredo-vuelta';

export interface Station {
  name: string;
  coordinates: [number, number]; // [lng, lat]
  transfer?: RouteId[];          // Lines that connect here
}

export interface TransitRoute {
  line: GeoJSON.FeatureCollection;
  stations: Station[];
  color: string;
  label: string;
}

import { busRoutes } from './busRoutesGenerated';

const coreRoutes: Record<string, TransitRoute> = {
  'metro-1': {
    color: '#E5A52B',
    label: 'Metro Línea 1',
    line: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { name: 'Metro Línea 1', color: '#E5A52B' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-100.36528, 25.75389],
            [-100.36167, 25.74833],
            [-100.35500, 25.74194],
            [-100.34750, 25.73222],
            [-100.34250, 25.72333],
            [-100.34250, 25.71611],
            [-100.34250, 25.70556],
            [-100.34250, 25.70556],
            [-100.34417, 25.69194],
            [-100.33361, 25.68694],
            [-100.32444, 25.68694],
            [-100.31694, 25.68611],
            [-100.30663, 25.68512],
            [-100.29667, 25.68389],
            [-100.28806, 25.68361],
            [-100.27933, 25.68332],
            [-100.26417, 25.68000],
            [-100.25278, 25.67972],
            [-100.24556, 25.67944],
          ]
        }
      }]
    },
    stations: [
      { name: 'Talleres',         coordinates: [-100.36528, 25.75389] },
      { name: 'San Bernabé',      coordinates: [-100.36167, 25.74833] },
      { name: 'Unidad Modelo',    coordinates: [-100.35500, 25.74194] },
      { name: 'Aztlán',           coordinates: [-100.34750, 25.73222] },
      { name: 'Penitenciaría',    coordinates: [-100.34250, 25.72333] },
      { name: 'Alfonso Reyes',    coordinates: [-100.34250, 25.71611] },
      { name: 'Mitras',           coordinates: [-100.34250, 25.70556] },
      { name: 'Simón Bolívar',    coordinates: [-100.34250, 25.70556] },
      { name: 'Hospital',         coordinates: [-100.34417, 25.69194] },
      { name: 'Edison',           coordinates: [-100.33361, 25.68694] },
      { name: 'Central',          coordinates: [-100.32444, 25.68694] },
      { name: 'Cuauhtémoc',       coordinates: [-100.31694, 25.68611], transfer: ['metro-2'] },
      { name: 'Del Golfo',        coordinates: [-100.30663, 25.68512] },
      { name: 'Félix U. Gómez',   coordinates: [-100.29667, 25.68389], transfer: ['metro-3'] },
      { name: 'Parque Fundidora', coordinates: [-100.28806, 25.68361] },
      { name: 'Y Griega',         coordinates: [-100.27933, 25.68332] },
      { name: 'Eloy Cavazos',     coordinates: [-100.26417, 25.68000] },
      { name: 'Lerdo de Tejada',  coordinates: [-100.25278, 25.67972] },
      { name: 'Exposición',       coordinates: [-100.24556, 25.67944] },
    ]
  },

  'metro-2': {
    color: '#3A913F',
    label: 'Metro Línea 2',
    line: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { name: 'Metro Línea 2', color: '#3A913F' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-100.29278, 25.76861],
            [-100.29568, 25.75926],
            [-100.29805, 25.75262],
            [-100.30250, 25.74028],
            [-100.30833, 25.72444],
            [-100.31111, 25.71722],
            [-100.31410, 25.70790],
            [-100.31667, 25.69694],
            [-100.31694, 25.68611],
            [-100.31833, 25.67694],
            [-100.31970, 25.67267],
            [-100.31544, 25.66888],
            [-100.31028, 25.66778],
          ]
        }
      }]
    },
    stations: [
      { name: 'Sendero',            coordinates: [-100.29278, 25.76861] },
      { name: 'Santiago Tapia',      coordinates: [-100.29568, 25.75926] },
      { name: 'San Nicolás',         coordinates: [-100.29805, 25.75262] },
      { name: 'Anáhuac',             coordinates: [-100.30250, 25.74028] },
      { name: 'Universidad',         coordinates: [-100.30833, 25.72444] },
      { name: 'Niños Héroes',        coordinates: [-100.31111, 25.71722] },
      { name: 'Regina',              coordinates: [-100.31410, 25.70790] },
      { name: 'General Anaya',       coordinates: [-100.31667, 25.69694] },
      { name: 'Cuauhtémoc',          coordinates: [-100.31694, 25.68611], transfer: ['metro-1'] },
      { name: 'Alameda',             coordinates: [-100.31833, 25.67694] },
      { name: 'Fundadores',          coordinates: [-100.31970, 25.67267] },
      { name: 'Padre Mier',          coordinates: [-100.31544, 25.66888] },
      { name: 'Gral. I. Zaragoza',   coordinates: [-100.31028, 25.66778], transfer: ['metro-3'] },
    ]
  },

  'metro-3': {
    color: '#D44A1E',
    label: 'Metro Línea 3',
    line: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { name: 'Metro Línea 3', color: '#D44A1E' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-100.2772839, 25.7128591],
            [-100.2866477, 25.7053915],
            [-100.2835807, 25.7073161],
            [-100.2948623, 25.6990452],
            [-100.296021,  25.689965],
            [-100.29667,   25.68389],
            [-100.297599,  25.678355],
            [-100.298538,  25.671483],
            [-100.31028,   25.66778],
          ]
        }
      }]
    },
    stations: [
      { name: 'Hospital Metropolitano', coordinates: [-100.2772839, 25.7128591] },
      { name: 'Ruiz Cortines',          coordinates: [-100.2866477, 25.7053915] },
      { name: 'Los Ángeles',            coordinates: [-100.2835807, 25.7073161] },
      { name: 'Moderna',                coordinates: [-100.2948623, 25.6990452] },
      { name: 'Metalúrgicos',           coordinates: [-100.296021,  25.689965] },
      { name: 'Félix U. Gómez',         coordinates: [-100.29667,   25.68389], transfer: ['metro-1'] },
      { name: 'Colonia Obrera',          coordinates: [-100.297599,  25.678355] },
      { name: 'Santa Lucía',            coordinates: [-100.298538,  25.671483] },
      { name: 'Gral. I. Zaragoza',      coordinates: [-100.31028,   25.66778], transfer: ['metro-2'] },
    ]
  },

  'ecovia': {
    color: '#B61F34',
    label: 'Ecovía',
    line: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { name: 'Ecovía', color: '#B61F34' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-100.421266, 25.769230], // Lincoln
            [-100.407573, 25.763399], // Astros
            [-100.402578, 25.759777], // Cumbres
            [-100.397400, 25.756060], // Plumbago
            [-100.392201, 25.752295], // Plutarco Elías Calles
            [-100.387572, 25.748944], // Embotelladora
            [-100.381387, 25.742571], // Panteón Municipal
            [-100.378175, 25.738978], // Cardenal
            [-100.373218, 25.733439], // Valle Verde
            [-100.369982, 25.729829], // Cardiología
            [-100.366670, 25.726162], // Santa Cecilia
            [-100.362000, 25.722500], // Villa Mitras (estimada)
            [-100.357306, 25.719186], // Rangel Frías
            [-100.353849, 25.716975], // Tránsito
            [-100.346749, 25.712277], // Laredo
            [-100.343420, 25.710071], // Rodrigo Gómez
            [-100.342401, 25.706313], // Mitras
            [-100.337762, 25.704670], // Celulosa
            [-100.332830, 25.704562], // 20 de Noviembre
            [-100.322154, 25.704370], // Hidalgo
            [-100.318883, 25.704303], // Bella Vista
            [-100.313560, 25.707910], // Regina
            [-100.309466, 25.704116], // Asarco
            [-100.296928, 25.703921], // Cementos
            [-100.288869, 25.703753], // Ruiz Cortines
            [-100.284001, 25.703679], // Clínica 15
            [-100.278658, 25.703597], // Coyoacán
            [-100.269407, 25.703461], // Churubusco
            [-100.260575, 25.703273], // Vidriera
            [-100.254319, 25.703170], // Adolfo Prieto
            [-100.247648, 25.703060], // Las Américas
            [-100.239086, 25.702914], // Central de Carga
            [-100.230405, 25.702759], // Tauro
            [-100.223559, 25.702563], // Miguel Alemán
            [-100.217468, 25.703017], // Calle Nueva
            [-100.208341, 25.704677], // La Zanja
            [-100.200589, 25.707374], // Aceros
            [-100.194430, 25.708810], // Guadalajara
            [-100.187989, 25.709028], // San Miguel
            [-100.166208, 25.705515], // Valle Fértil
            [-100.158342, 25.703437], // Valle Soleado
          ]
        }
      }]
    },
    stations: [
      { name: 'Lincoln',               coordinates: [-100.421266, 25.769230] },
      { name: 'Astros',                coordinates: [-100.407573, 25.763399] },
      { name: 'Cumbres',               coordinates: [-100.402578, 25.759777] },
      { name: 'Plumbago',              coordinates: [-100.397400, 25.756060] },
      { name: 'Plutarco Elías Calles', coordinates: [-100.392201, 25.752295] },
      { name: 'Embotelladora',         coordinates: [-100.387572, 25.748944] },
      { name: 'Panteón Municipal',     coordinates: [-100.381387, 25.742571] },
      { name: 'Cardenal',              coordinates: [-100.378175, 25.738978] },
      { name: 'Valle Verde',           coordinates: [-100.373218, 25.733439] },
      { name: 'Cardiología',           coordinates: [-100.369982, 25.729829] },
      { name: 'Santa Cecilia',         coordinates: [-100.366670, 25.726162] },
      { name: 'Villa Mitras',          coordinates: [-100.362000, 25.722500] },
      { name: 'Rangel Frías',          coordinates: [-100.357306, 25.719186] },
      { name: 'Tránsito',              coordinates: [-100.353849, 25.716975] },
      { name: 'Laredo',                coordinates: [-100.346749, 25.712277] },
      { name: 'Rodrigo Gómez',         coordinates: [-100.343420, 25.710071] },
      { name: 'Mitras',                coordinates: [-100.342401, 25.706313], transfer: ['metro-1'] },
      { name: 'Celulosa',              coordinates: [-100.337762, 25.704670] },
      { name: '20 de Noviembre',       coordinates: [-100.332830, 25.704562] },
      { name: 'Hidalgo',               coordinates: [-100.322154, 25.704370] },
      { name: 'Bella Vista',           coordinates: [-100.318883, 25.704303] },
      { name: 'Regina',                coordinates: [-100.313560, 25.707910], transfer: ['metro-2'] },
      { name: 'Asarco',                coordinates: [-100.309466, 25.704116] },
      { name: 'Cementos',              coordinates: [-100.296928, 25.703921] },
      { name: 'Ruiz Cortines',         coordinates: [-100.288869, 25.703753], transfer: ['metro-3'] },
      { name: 'Clínica 15',            coordinates: [-100.284001, 25.703679] },
      { name: 'Coyoacán',              coordinates: [-100.278658, 25.703597] },
      { name: 'Churubusco',            coordinates: [-100.269407, 25.703461] },
      { name: 'Vidriera',              coordinates: [-100.260575, 25.703273] },
      { name: 'Adolfo Prieto',         coordinates: [-100.254319, 25.703170] },
      { name: 'Las Américas',          coordinates: [-100.247648, 25.703060] },
      { name: 'Central de Carga',      coordinates: [-100.239086, 25.702914] },
      { name: 'Tauro',                 coordinates: [-100.230405, 25.702759] },
      { name: 'Miguel Alemán',         coordinates: [-100.223559, 25.702563] },
      { name: 'Calle Nueva',           coordinates: [-100.217468, 25.703017] },
      { name: 'La Zanja',              coordinates: [-100.208341, 25.704677] },
      { name: 'Aceros',                coordinates: [-100.200589, 25.707374] },
      { name: 'Guadalajara',           coordinates: [-100.194430, 25.708810] },
      { name: 'San Miguel',            coordinates: [-100.187989, 25.709028] },
      { name: 'Valle Fértil',          coordinates: [-100.166208, 25.705515] },
      { name: 'Valle Soleado',         coordinates: [-100.158342, 25.703437] },
    ]
  },

  // Bus routes (auto-generated from KML files)
  ...busRoutes,
};

export const transitRoutes = coreRoutes as Record<RouteId, TransitRoute>;
