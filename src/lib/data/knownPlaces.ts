// Known places in Monterrey area — coordinates resolved client-side
// so Gemini doesn't have to provide them (it fails with too many numeric params)

export const knownPlaces: Record<string, [number, number]> = {
  // ── Landmarks ──
  'macroplaza':             [-100.3099, 25.6692],
  'estadio bbva':           [-100.2430, 25.6697],
  'hospital metropolitano': [-100.2773, 25.7129],
  'parque fundidora':       [-100.2881, 25.6836],
  'centro de monterrey':    [-100.3161, 25.6866],
  'catedral de monterrey':  [-100.3103, 25.6689],
  'barrio antiguo':         [-100.3050, 25.6700],
  'paseo santa lucía':      [-100.3000, 25.6720],
  'arena monterrey':        [-100.3050, 25.6860],
  'central de autobuses':   [-100.3244, 25.6869],
  'aeropuerto monterrey':   [-100.1070, 25.7786],
  'palacio de gobierno':    [-100.3105, 25.6697],

  // ── Shopping / Commercial ──
  'galerías monterrey':     [-100.3540, 25.6670],
  'galerías valle oriente': [-100.3502, 25.6519],
  'fashion drive':          [-100.3398, 25.6470],
  'plaza la silla':         [-100.2350, 25.6450],
  'citadel':                [-100.2456, 25.6750],
  'plaza fiesta san agustín': [-100.3630, 25.6610],
  'paseo la fe':            [-100.2085, 25.6978],
  'plaza cumbres':          [-100.3798, 25.7506],

  // ── Universities ──
  'tecnológico de monterrey': [-100.2900, 25.6510],
  'tec de monterrey':       [-100.2900, 25.6510],
  'uanl':                   [-100.3083, 25.7244],
  'uanl méderos':           [-100.3996, 25.6427],
  'uanl fime':              [-100.3573, 25.7263],
  'udem':                   [-100.3597, 25.6605],
  'universidad regiomontana': [-100.3120, 25.6770],

  // ── Hospitals ──
  'hospital universitario': [-100.3480, 25.6890],
  'hospital san josé tec':  [-100.3048, 25.6547],
  'hospital ángeles':       [-100.3358, 25.6485],
  'christus muguerza':      [-100.3089, 25.6657],

  // ── Cultural / Parks ──
  'museo marco':            [-100.3104, 25.6665],
  'planetario alfa':        [-100.3680, 25.6549],
  'bioparque estrella':     [-100.2940, 25.6150],
  'parque niños héroes':    [-100.3380, 25.6840],

  // ── Neighborhoods / Municipal Centers ──
  'san pedro garza garcía': [-100.4020, 25.6590],
  'santa catarina':         [-100.4580, 25.6730],
  'guadalupe centro':       [-100.2590, 25.6770],
  'apodaca centro':         [-100.1880, 25.7810],
  'escobedo centro':        [-100.3150, 25.7910],
  'contry':                 [-100.3050, 25.6420],
  'cumbres':                [-100.3850, 25.7460],
  'san jerónimo':           [-100.4160, 25.6410],
  
  // Metro stations (same coords as in transitRoutes)
  'talleres':               [-100.36528, 25.75389],
  'san bernabé':            [-100.36167, 25.74833],
  'unidad modelo':          [-100.35500, 25.74194],
  'aztlán':                 [-100.34750, 25.73222],
  'penitenciaría':          [-100.34250, 25.72333],
  'alfonso reyes':          [-100.34250, 25.71611],
  'mitras':                 [-100.34250, 25.70556],
  'simón bolívar':          [-100.34250, 25.70556],
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
  'san nicolás':            [-100.29805, 25.75262],
  'anáhuac':                [-100.30250, 25.74028],
  'universidad':            [-100.30833, 25.72444],
  'niños héroes':           [-100.31111, 25.71722],
  'regina':                 [-100.31410, 25.70790],
  'general anaya':          [-100.31667, 25.69694],
  'alameda':                [-100.31833, 25.67694],
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

export function resolveCoordinates(name: string): [number, number] | null {
  const key = name.toLowerCase().trim();
  if (knownPlaces[key]) return knownPlaces[key];
  
  // Fuzzy match: check if the key is contained in any known place name
  for (const [placeName, coords] of Object.entries(knownPlaces)) {
    if (placeName.includes(key) || key.includes(placeName)) {
      return coords;
    }
  }
  return null;
}
