// Known places in Monterrey area — coordinates resolved client-side
// so Gemini doesn't have to provide them (it fails with too many numeric params)

export const knownPlaces: Record<string, [number, number]> = {
  // ── English aliases ──
  'airport':                    [-100.1070, 25.7786],
  'mty airport':                [-100.1070, 25.7786],
  'monterrey airport':          [-100.1070, 25.7786],
  'monterrey international airport': [-100.1070, 25.7786],
  'bbva stadium':               [-100.2443769, 25.6690987],
  'rayados stadium':            [-100.2443769, 25.6690987],
  'fundidora park':             [-100.2834486, 25.6789357],
  'downtown monterrey':         [-100.3161, 25.6866],
  'monterrey downtown':         [-100.3161, 25.6866],
  'monterrey cathedral':        [-100.3096008, 25.6655169],
  'bus terminal':               [-100.3244, 25.6869],
  'north bus terminal':         [-100.3244, 25.6869],
  'steel museum':               [-100.2828302, 25.6762887],
  'alfa planetarium':           [-100.3680, 25.6549],
  'alfa planetario':            [-100.3680, 25.6549],
  'tec de monterrey campus':    [-100.2900, 25.6510],
  'itesm campus':               [-100.2900, 25.6510],
  'university city':            [-100.3125685, 25.7259071],
  'huasteca park':              [-100.4508431, 25.6494791],
  'chipinque park':             [-100.3751, 25.6013],
  'marco museum':               [-100.3098090, 25.6645411],
  'government palace':          [-100.3092772, 25.6724347],
  'santa lucia walk':           [-100.3073008, 25.6715432],
  'santa lucia river walk':     [-100.3073008, 25.6715432],

  // ── Landmarks ──
  'macroplaza':             [-100.3099346, 25.6691153],
  'estadio bbva':           [-100.2443769, 25.6690987],
  'hospital metropolitano': [-100.2773, 25.7129],
  'parque fundidora':       [-100.2834486, 25.6789357],
  'centro de monterrey':    [-100.3161, 25.6866],
  'catedral de monterrey':  [-100.3096008, 25.6655169],
  'catedral metropolitana': [-100.3096008, 25.6655169],
  'barrio antiguo':         [-100.3069348, 25.6670144],
  'paseo santa lucía':      [-100.3073008, 25.6715432],
  'arena monterrey':        [-100.2883158, 25.6806457],
  'central de autobuses':   [-100.3244, 25.6869],
  'camionera norte':        [-100.3244, 25.6869],
  'aeropuerto monterrey':   [-100.1070, 25.7786],
  'aua':                    [-100.1070, 25.7786],
  'palacio de gobierno':    [-100.3092772, 25.6724347],
  'cerro de la silla':      [-100.2370, 25.6290],
  'obispado':               [-100.3456665, 25.6757368],
  'cerro del obispado':     [-100.3456665, 25.6757368],
  'museo obispado':         [-100.3456665, 25.6757368],
  'congreso del estado':    [-100.3012, 25.6703],
  'palacio federal':        [-100.3092, 25.6692],
  'explanada de los héroes': [-100.3099346, 25.6691153],
  'paseo san pedro':        [-100.4068, 25.6520],

  // ── Shopping / Commercial ──
  'galerías monterrey':     [-100.3540, 25.6670],
  'galerías valle oriente': [-100.3502, 25.6519],
  'fashion drive':          [-100.3398, 25.6470],
  'plaza la silla':         [-100.2350, 25.6450],
  'citadel':                [-100.2456, 25.6750],
  'plaza fiesta san agustín': [-100.3630, 25.6610],
  'paseo la fe':            [-100.2085, 25.6978],
  'plaza cumbres':          [-100.3798, 25.7506],
  'punto valle':            [-100.3851, 25.6342],
  'plaza mayor':            [-100.2275, 25.6748],
  'plaza mayor guadalupe':  [-100.2275, 25.6748],
  'antara fashion hall':    [-100.3495, 25.6928],
  'gran plaza apodaca':     [-100.1930, 25.7812],
  'plaza san pedro':        [-100.4073, 25.6618],
  'sendero cumbres':        [-100.3702, 25.7248],
  'plaza garza sada':       [-100.2882, 25.6318],
  'plaza del sol':          [-100.3810, 25.6660],
  'plaza satélite':         [-100.3498, 25.6938],
  'multiplaza':             [-100.2970, 25.7462],
  'centro comercial constitución': [-100.3285, 25.7240],

  // ── Universities ──
  'tecnológico de monterrey': [-100.2900, 25.6510],
  'tec de monterrey':       [-100.2900, 25.6510],
  'itesm':                  [-100.2900, 25.6510],
  'uanl':                   [-100.3125685, 25.7259071],
  'universidad autónoma de nuevo león': [-100.3125685, 25.7259071],
  'uanl ciudad universitaria': [-100.3125685, 25.7259071],
  'ciudad universitaria':   [-100.3125685, 25.7259071],
  'uanl méderos':           [-100.3996, 25.6427],
  'uanl fime':              [-100.3573, 25.7263],
  'udem':                   [-100.3597, 25.6605],
  'universidad de monterrey': [-100.3597, 25.6605],
  'universidad regiomontana': [-100.3120, 25.6770],
  'ur':                     [-100.3120, 25.6770],
  'uvm monterrey':          [-100.2780, 25.7198],
  'cetys monterrey':        [-100.3220, 25.7165],
  'uane':                   [-100.3234, 25.6770],

  // ── Hospitals ──
  'hospital universitario': [-100.3480, 25.6890],
  'hospital san josé tec':  [-100.3048, 25.6547],
  'hospital ángeles':       [-100.3358, 25.6485],
  'christus muguerza':      [-100.3089, 25.6657],
  'hospital civil de monterrey': [-100.3090, 25.6822],
  'hospital clinica nova':  [-100.2735, 25.7175],
  'hospital alta especialidad': [-100.3090, 25.6822],
  'hospital regional imss': [-100.3208, 25.6452],
  'imss monterrey':         [-100.3208, 25.6452],
  'issste monterrey':       [-100.3150, 25.6500],
  'cruz roja monterrey':    [-100.3240, 25.6755],

  // ── Cultural / Parks ──
  'museo marco':            [-100.3098090, 25.6645411],
  'planetario alfa':        [-100.3680, 25.6549],
  'bioparque estrella':     [-100.2940, 25.6150],
  'parque niños héroes':    [-100.3139355, 25.7132588],
  'museo del acero horno 3': [-100.2828302, 25.6762887],
  'horno 3':                [-100.2828302, 25.6762887],
  'museo de historia mexicana': [-100.3064063, 25.6716169],
  'teatro de la ciudad':    [-100.3091237, 25.6689235],
  'teatro monterrey':       [-100.3091237, 25.6689235],
  'cintermex':              [-100.2884085, 25.6778331],
  'centro de las artes':    [-100.2834232, 25.6774819],
  'parque la huasteca':     [-100.4508431, 25.6494791],
  'la huasteca':            [-100.4508431, 25.6494791],
  'chipinque':              [-100.3751, 25.6013],
  'parque chipinque':       [-100.3751, 25.6013],
  'paseo los leones':       [-100.4280, 25.6978],
  'lab cultural ciudadano': [-100.3091416, 25.6736048],
  'labnl':                  [-100.3091416, 25.6736048],

  // ── Neighborhoods / Municipal Centers ──
  'san pedro garza garcía': [-100.4020, 25.6590],
  'santa catarina':         [-100.4580, 25.6730],
  'guadalupe centro':       [-100.2590, 25.6770],
  'apodaca centro':         [-100.1880, 25.7810],
  'escobedo centro':        [-100.3150, 25.7910],
  'general escobedo':       [-100.3150, 25.7910],
  'contry':                 [-100.3050, 25.6420],
  'cumbres':                [-100.3850, 25.7460],
  'san jerónimo':           [-100.4160, 25.6410],
  'del valle':              [-100.3778, 25.6527],
  'lomas de san francisco': [-100.4240, 25.6355],
  'mirador':                [-100.3752, 25.6570],
  'colonia del mirador':    [-100.3752, 25.6570],
  'mitras centro':          [-100.3420, 25.7048],
  'colonia independencia':  [-100.3060, 25.6590],
  'colonia roma':           [-100.3090, 25.6640],
  'la fe guadalupe':        [-100.2100, 25.6988],
  'jardines de anahuac':    [-100.2810, 25.7460],
  'colonia estrella':       [-100.3255, 25.6835],
  'residencial san agustín': [-100.3630, 25.6470],
  'fuentes del valle':      [-100.3730, 25.6380],
  'garcia nuevo leon':      [-100.5870, 25.8130],
  'juárez nuevo leon':      [-100.4050, 25.6065],
  'san nicolás de los garza': [-100.2970, 25.7451],
  'san nicolás':            [-100.2970, 25.7451],

  // ── Northern Suburbs / Bus Route Coverage ──
  // (far from metro, served by Rutas 13, 220, 226, Unidad-Laredo)
  'bosques de las cumbres':   [-100.3740, 25.8400],
  'pedregal de cumbres':      [-100.3710, 25.8000],
  'paseo de cumbres':         [-100.3500, 25.8070],
  'las puentes':              [-100.3580, 25.8220],
  'las puentes escobedo':     [-100.3580, 25.8220],
  'hacienda los morales':     [-100.3830, 25.8550],
  'alianza real':             [-100.2770, 25.8290],
  'ute escobedo':             [-100.2770, 25.8290],
  'la unidad monterrey':      [-100.4176, 25.7989],
  'mitras poniente':          [-100.4100, 25.7920],
  'linda vista':              [-100.3930, 25.8100],
  'linda vista escobedo':     [-100.3930, 25.8100],
  'privadas de anáhuac':      [-100.2920, 25.7750],
  'anáhuac san nicolás':      [-100.2750, 25.7390],
  'cerradas de cumbres':      [-100.3650, 25.7850],
  'puerta de hierro':         [-100.3480, 25.7900],
  'fracc. los girasoles':     [-100.3300, 25.8100],
  'villa de san miguel':      [-100.3050, 25.8050],
  'ciudad solidaridad':       [-100.3200, 25.8300],
  'urbivilla del rey':        [-100.2990, 25.8180],
  'plaza sendero escobedo':   [-100.3150, 25.7950],
  'heb cumbres':              [-100.3720, 25.7550],
  'heb linda vista':          [-100.3900, 25.7930],
  'walmart cumbres':          [-100.3790, 25.7620],
  'parque aztlán':            [-100.3480, 25.7320],

  // ── South / Contry / Tec area (Ruta 1 southern territory) ──
  'contry la silla':          [-100.2800, 25.6350],
  'colonia buenos aires':     [-100.2950, 25.6550],
  'satelite':                 [-100.3498, 25.6938],
  'col. roma':                [-100.3090, 25.6640],
  'col. obrera':              [-100.2976, 25.6784],

  // ── Additional metro-adjacent popular spots ──
  'mercado juárez':           [-100.3138123, 25.6764345],
  'mercado juarez':           [-100.3138123, 25.6764345],
  'plaza morelos':            [-100.3060, 25.6745],
  'alameda mariano escobedo': [-100.3211091, 25.6760467],
  'alameda':                  [-100.3211091, 25.6760467],
  'soriana mitras':           [-100.3530, 25.7080],
  'soriana lincoln':          [-100.3720, 25.7260],
  'parque clouthier':         [-100.3270, 25.6530],
  'hospital canseco':         [-100.3100, 25.6860],

  // Metro stations (same coords as in transitRoutes)
  'talleres':               [-100.36528, 25.75389],
  'san bernabé':            [-100.36167, 25.74833],
  'unidad modelo':          [-100.35500, 25.74194],
  'aztlán':                 [-100.34750, 25.73222],
  'penitenciaría':          [-100.34250, 25.72333],
  'alfonso reyes':          [-100.34250, 25.71611],
  'mitras':                 [-100.34250, 25.70556],
  'simón bolívar':          [-100.3432070, 25.6986855],
  'hospital':               [-100.34417, 25.69194],
  'edison':                 [-100.33361, 25.68694],
  'central':                [-100.32444, 25.68694],
  'cuauhtémoc':             [-100.31694, 25.68611],
  'del golfo':              [-100.30663, 25.68512],
  'félix u. gómez':         [-100.29667, 25.68389],
  'parque fundidora metro': [-100.28806, 25.68361],
  'y griega':               [-100.27933, 25.68332],
  'eloy cavazos':           [-100.26417, 25.68000],
  'lerdo de tejada':        [-100.25278, 25.67972],
  'exposición':             [-100.24556, 25.67944],
  'sendero':                [-100.29278, 25.76861],
  'santiago tapia':         [-100.29568, 25.75926],
  'san nicolás metro':      [-100.29805, 25.75262],
  'anáhuac':                [-100.30250, 25.74028],
  'universidad':            [-100.30833, 25.72444],
  'niños héroes':           [-100.31111, 25.71722],
  'regina':                 [-100.31410, 25.70790],
  'general anaya':          [-100.31667, 25.69694],
  'alameda metro':          [-100.31833, 25.67694],
  'fundadores':             [-100.31970, 25.67267],
  'padre mier':             [-100.31544, 25.66888],
  'zaragoza':               [-100.31028, 25.66778],
  'gral. i. zaragoza':      [-100.31028, 25.66778],
  'general i. zaragoza':    [-100.31028, 25.66778],
  'ruiz cortines':          [-100.2866477, 25.7053915],
  'los ángeles':            [-100.2835807, 25.7073161],
  'moderna':                [-100.2948623, 25.6990452],
  'metalúrgicos':           [-100.296021, 25.689965],
  'colonia obrera':         [-100.297599, 25.678355],
  'santa lucía':            [-100.298538, 25.671483],
  'lincoln':                [-100.37039, 25.72513],
  'rangel frías':           [-100.34444, 25.71427],
  'valle soleado':          [-100.18731, 25.72461],
};

function normalizeAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function resolveCoordinates(name: string): [number, number] | null {
  const key = name.toLowerCase().trim();
  if (knownPlaces[key]) return knownPlaces[key];

  // Accent-insensitive exact match
  const keyNorm = normalizeAccents(key);
  for (const [placeName, coords] of Object.entries(knownPlaces)) {
    if (normalizeAccents(placeName) === keyNorm) return coords;
  }

  // Fuzzy match: every significant word in query must exist as a complete word in place name
  // Filter out stopwords (articles, prepositions) - words <= 2 chars
  const keyWords = keyNorm.split(/\s+/).filter(w => w.length > 2);
  if (keyWords.length > 0) {
    for (const [placeName, coords] of Object.entries(knownPlaces)) {
      const placeWords = normalizeAccents(placeName).split(/\s+/);
      const allWordsMatch = keyWords.every(kw => placeWords.some(pw => pw === kw));
      if (allWordsMatch) {
        return coords;
      }
    }
  }
  return null;
}
