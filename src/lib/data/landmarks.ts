export type LandmarkCategory = 'cultura' | 'deporte' | 'parque' | 'entretenimiento' | 'gastronomia';
export type LandmarkTier = 'primary' | 'secondary';

export interface Landmark {
  id: string;
  name: string;
  category: LandmarkCategory;
  tier: LandmarkTier;
  coordinates: [number, number]; // [lng, lat]
  description: string;
  activities: string[];
  routeQueryName: string;
  /** Custom illustrative SVG path(s) — 24×24 viewBox, stroke-based. Falls back to CATEGORY_ICON if absent. */
  svg?: string;
  /** Optional gallery image URLs shown in the modal. */
  images?: string[];
  /**
   * Optional polygon defining the landmark's area on the map.
   * Array of [lng, lat] pairs forming a closed ring (first ≠ last is fine — auto-closed).
   * When present, a semi-transparent fill is drawn instead of/in addition to the point marker.
   */
  area?: [number, number][];
}

export const CATEGORY_COLOR: Record<LandmarkCategory, string> = {
  cultura: '#7C5CBF',
  deporte: '#DC2626',
  parque: '#16A34A',
  entretenimiento: '#D97706',
  gastronomia: '#EA580C',
};

export const CATEGORY_LABEL: Record<LandmarkCategory, string> = {
  cultura: 'Cultura',
  deporte: 'Deporte',
  parque: 'Parque',
  entretenimiento: 'Entretenimiento',
  gastronomia: 'Gastronomía',
};

// SVG inner content — 24×24 viewBox, stroke-based (no fill)
export const CATEGORY_ICON: Record<LandmarkCategory, string> = {
  cultura:
    '<path d="M2 22h20M4 11h16M12 2L2 11h20L12 2zM7 11v11M12 11v11M17 11v11"/>',
  deporte:
    '<rect x="2" y="7" width="20" height="13" rx="2"/><ellipse cx="12" cy="13.5" rx="5" ry="3"/>',
  parque:
    '<path d="M12 22v-7"/><path d="M6 15l6-13 6 13H6z"/>',
  entretenimiento:
    '<path d="M2 9a3 3 0 010 6v2a2 2 0 002 2h16a2 2 0 002-2v-2a3 3 0 010-6V7a2 2 0 00-2-2H4a2 2 0 00-2 2v2z"/><line x1="9" y1="4" x2="9" y2="20"/>',
  gastronomia:
    '<path d="M6 13.87A4 4 0 017.41 6a5.11 5.11 0 0111.14 0A4 4 0 0118 13.87V21H6v-7.13z"/><line x1="6" y1="17" x2="18" y2="17"/>',
};

export const landmarks: Landmark[] = [
  // ── PRIMARY (visible from zoom 10+) ──
  {
    id: 'macroplaza',
    name: 'Macroplaza',
    category: 'cultura',
    tier: 'primary',
    coordinates: [-100.3099346, 25.6691153],
    description: 'Una de las plazas cívicas más grandes del mundo. Corazón histórico de Monterrey, rodeada de monumentos, museos y el icónico Faro del Comercio.',
    activities: ['Faro del Comercio (mirador nocturno)', 'Fuente de Neptuno', 'Museo de Historia Mexicana', 'Palacio de Gobierno', 'Catedral Metropolitana'],
    routeQueryName: 'Macroplaza',
    svg: '<rect x="10" y="2" width="4" height="20" rx="0.5"/><line x1="10" y1="8" x2="14" y2="8"/><line x1="10" y1="13" x2="14" y2="13"/><line x1="7" y1="22" x2="17" y2="22"/>',
    images: [
      'https://dynamic-media-cdn.tripadvisor.com/media/photo-o/16/4b/ec/c2/img-20190129-100003-largejpg.jpg?w=900&h=500&s=1',
      'https://visitmexico.com/media/usercontent/6886d1143a52d-Macroplaza-01-(1)-(1)_gmxdot_jpg',
      'https://img.freepik.com/fotos-premium/mexico-monterrey-landmark-macroplaza-gran-plaza-plaza-centro-historico-ciudad_451699-3716.jpg',
    ],
  },
  {
    id: 'estadio-bbva',
    name: 'Estadio BBVA',
    category: 'deporte',
    tier: 'primary',
    coordinates: [-100.2443769, 25.6690987],
    description: 'Casa de los Rayados de Monterrey. Uno de los estadios más modernos de América Latina, con capacidad para más de 53,000 aficionados.',
    activities: ['Ver partidos de Rayados', 'Tour oficial del estadio', 'Museo Rayados', 'Zona comercial y gastronomía'],
    routeQueryName: 'Estadio BBVA',
    // Cancha de fútbol vista aérea — estadio exterior, campo interior con líneas reglamentarias
    svg: '<rect x="2" y="4" width="20" height="16" rx="6"/><rect x="5" y="7" width="14" height="10"/><line x1="12" y1="7" x2="12" y2="17"/><circle cx="12" cy="12" r="2"/><rect x="5" y="9.5" width="3" height="5"/><rect x="16" y="9.5" width="3" height="5"/>',
  },
  {
    id: 'parque-fundidora',
    name: 'Parque Fundidora',
    category: 'parque',
    tier: 'primary',
    coordinates: [-100.2834486, 25.6789357],
    description: 'Antiguo complejo siderúrgico convertido en parque urbano. Hogar del Horno 3, el Centro de las Artes y uno de los pulmones verdes más queridos de Monterrey.',
    activities: ['Museo del Acero Horno 3', 'Centro de las Artes', 'Pista de hielo (temporada)', 'Ciclismo y senderismo', 'Eventos culturales y conciertos'],
    routeQueryName: 'Parque Fundidora',
    // Alto horno industrial — torre cónica con base ancha y chimeneas
    svg: '<path d="M8 22V10l4-8 4 8v12H8z"/><line x1="6" y1="22" x2="18" y2="22"/><line x1="8" y1="15" x2="16" y2="15"/><line x1="9" y1="19" x2="15" y2="19"/>',
    // Polygon covering the full Fundidora park grounds (adjust vertices as needed)
    area: [
      [-100.2832534, 25.6822531],
      [-100.2796578, 25.6826167],
      [-100.2795110, 25.6811815],
      [-100.2777725, 25.6813097],
      [-100.2773962, 25.6761470],
      [-100.2828109, 25.6746962],
      [-100.2869922, 25.6734526],
      [-100.2901073, 25.6757325],
      [-100.2895219, 25.6797082],
      [-100.2904836, 25.6816112]
    ],
  },
  {
    id: 'barrio-antiguo',
    name: 'Barrio Antiguo',
    category: 'entretenimiento',
    tier: 'primary',
    coordinates: [-100.3069348, 25.6670144],
    description: 'El barrio más bohemio y vibrante de Monterrey. Calles empedradas, galerías de arte, bares y vida nocturna que mezclan lo histórico con lo contemporáneo.',
    activities: ['Bares y cantinas históricas', 'Galerías de arte independiente', 'Cafeterías de especialidad', 'Mercado del Barrio', 'Música en vivo los fines de semana'],
    routeQueryName: 'Barrio Antiguo',
    // Portal colonial con arco de medio punto y puerta doble
    svg: '<path d="M4 22V11a8 8 0 0116 0v11"/><line x1="4" y1="22" x2="20" y2="22"/><path d="M10 22v-6a2 2 0 014 0v6"/><line x1="12" y1="3" x2="12" y2="5"/>',
    // Polygon covering Barrio Antiguo — roughly between Hidalgo, Pino Suárez, Padre Mier and Colón
    area: [
      [-100.3086968, 25.6684567],
      [-100.3043232, 25.6675947],
      [-100.3049225, 25.6653536],
      [-100.3090921, 25.6657788]
    ],
  },
  {
    id: 'obispado',
    name: 'Cerro del Obispado',
    category: 'cultura',
    tier: 'primary',
    coordinates: [-100.3456665, 25.6757368],
    description: 'Antiguo palacio episcopal del siglo XVIII convertido en museo regional. Ofrece una de las vistas panorámicas más espectaculares de la ciudad.',
    activities: ['Museo Regional de Nuevo León', 'Mirador panorámico de Monterrey', 'Jardines y senderos del cerro', 'Fotografía urbana y arquitectónica'],
    routeQueryName: 'Obispado',
    // Asta de bandera sobre el cerro — mástil, bandera ondeando, silueta de loma
    svg: '<line x1="10" y1="2" x2="10" y2="16"/><path d="M10 3l9 3.5-9 3.5z"/><path d="M2 22c0-6 3-9 8-9s8 3 8 9"/>',
  },
  {
    id: 'alameda',
    name: 'Alameda Mariano Escobedo',
    category: 'parque',
    tier: 'primary',
    coordinates: [-100.3211091, 25.6760467],
    description: 'El parque urbano más antiguo de Monterrey. Un espacio verde icónico en el corazón de la ciudad con lago, feria y ambiente familiar.',
    activities: ['Lago con lanchas de remo', 'Feria permanente y juegos', 'Puestos de comida típica', 'Caminar y ejercitarse', 'Zona de descanso y jardines'],
    routeQueryName: 'Alameda Mariano Escobedo',
    // Tres pinos — árbol central más alto, dos laterales más bajos, línea de suelo
    svg: '<path d="M4 17l3-8 3 8z"/><line x1="7" y1="17" x2="7" y2="21"/><path d="M8 17L12 4L16 17z"/><line x1="12" y1="17" x2="12" y2="21"/><path d="M14 17l3-8 3 8z"/><line x1="17" y1="17" x2="17" y2="21"/><line x1="2" y1="21" x2="22" y2="21"/>',
  },
  {
    id: 'horno3',
    name: 'Museo del Acero Horno 3',
    category: 'cultura',
    tier: 'primary',
    coordinates: [-100.2828302, 25.6762887],
    description: 'Museo interactivo instalado en el antiguo alto horno de la Fundidora. Una experiencia única que cuenta la historia industrial y humana de Monterrey.',
    activities: ['Tour del alto horno histórico', 'Exposiciones interactivas de ciencia', 'Telecabina con vistas al parque', 'Tirolesa y actividades extremas', 'Experiencias 4D'],
    routeQueryName: 'Museo del Acero Horno 3',
    // Alto horno con estructura de soporte y depósito esférico
    svg: '<path d="M9 22v-9a3 3 0 016 0v9"/><path d="M7 22V14l-2-4h14l-2 4v8"/><line x1="5" y1="22" x2="19" y2="22"/><circle cx="12" cy="7" r="3"/>',
  },
  {
    id: 'museo-marco',
    name: 'Museo MARCO',
    category: 'cultura',
    tier: 'primary',
    coordinates: [-100.3098090, 25.6645411],
    description: 'Museo de Arte Contemporáneo de Monterrey. Uno de los recintos de arte moderno más importantes de América Latina, con colecciones permanentes e internacionales.',
    activities: ['Arte contemporáneo latinoamericano', 'Exposiciones internacionales rotativas', 'Café del museo', 'Tienda de arte y diseño', 'Eventos y talleres culturales'],
    routeQueryName: 'Museo Marco',
    // Paloma en vuelo — Lucide bird icon (MIT), referencia escultura Juan Soriano en MARCO
    svg: '<path d="M16 7h.01"/><path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20"/><path d="m20 7 2 .5-2 .5"/><path d="M7 18a6 6 0 0 0 3.84-10.61"/>',
  },
  {
    id: 'cintermex',
    name: 'Cintermex',
    category: 'entretenimiento',
    tier: 'primary',
    coordinates: [-100.2884085, 25.6778331],
    description: 'Centro Internacional de Negocios de Monterrey. Principal recinto para exposiciones, convenciones y eventos de talla internacional en el norte del país.',
    activities: ['Exposiciones y ferias comerciales', 'Conciertos y eventos masivos', 'Foro Cintermex', 'Zona de restaurantes y cafeterías'],
    routeQueryName: 'Cintermex',
    // Logo Cintermex — triángulo con esfera interior y tres líneas de latitud curveadas
    svg: '<path d="M12 2L2 22h20z"/><circle cx="12" cy="15" r="7"/><path d="M6 11Q12 15 18 11"/><path d="M5 15Q12 19.5 19 15"/><path d="M6 19Q12 22.5 18 19"/>',
  },

  // ── SECONDARY (visible desde zoom 13+) ──
  {
    id: 'catedral',
    name: 'Catedral Metropolitana',
    category: 'cultura',
    tier: 'secondary',
    coordinates: [-100.3096008, 25.6655169],
    description: 'La catedral más importante de Nuevo León, cuya construcción abarca del siglo XVII al XX. Símbolo arquitectónico del centro histórico de Monterrey.',
    activities: ['Visita religiosa', 'Tours de arquitectura colonial', 'Fotografía histórica', 'Misas y eventos religiosos'],
    routeQueryName: 'Catedral de Monterrey',
  },
  {
    id: 'mercado-juarez',
    name: 'Mercado Juárez',
    category: 'gastronomia',
    tier: 'secondary',
    coordinates: [-100.3138123, 25.6764345],
    description: 'El mercado más tradicional de Monterrey. Sabores auténticos de la cocina regiomontana: cabrito, machacado, gorditas, dulces y artesanías.',
    activities: ['Cabrito al pastor', 'Machacado con huevo', 'Gorditas de cuajada', 'Dulces típicos norteños', 'Artesanías de Nuevo León'],
    routeQueryName: 'Mercado Juárez',
  },
  {
    id: 'paseo-santa-lucia',
    name: 'Paseo Santa Lucía',
    category: 'parque',
    tier: 'secondary',
    coordinates: [-100.3073008, 25.6715432],
    description: 'Canal peatonal de 2.5 km que conecta la Macroplaza con el Parque Fundidora. Ideal para paseos a pie, en barca o en bicicleta junto al río.',
    activities: ['Paseo en barca por el canal', 'Caminata y ciclovía peatonal', 'Restaurantes y terrazas', 'Esculturas y arte público', 'Fotografía del paisaje urbano'],
    routeQueryName: 'Paseo Santa Lucía',
    // Canal con arco de puente — agua ondulante y puente peatonal característico
    svg: '<path d="M2 12Q7 8 12 12Q17 16 22 12"/><path d="M2 17Q7 13 12 17Q17 21 22 17"/><line x1="8" y1="10" x2="8" y2="19"/><line x1="16" y1="10" x2="16" y2="19"/><path d="M8 10Q12 6 16 10"/>',
  },
  {
    id: 'museo-historia',
    name: 'Museo de Historia Mexicana',
    category: 'cultura',
    tier: 'secondary',
    coordinates: [-100.3064063, 25.6716169],
    description: 'Recorrido cronológico por la historia de México desde la prehistoria hasta el siglo XX. Colecciones permanentes y exposiciones temporales de alto nivel.',
    activities: ['Recorrido por la historia de México', 'Exposiciones temporales', 'Recorridos guiados y educativos', 'Actividades para niños y familias'],
    routeQueryName: 'Museo de Historia Mexicana',
  },
  {
    id: 'arena-monterrey',
    name: 'Arena Monterrey',
    category: 'entretenimiento',
    tier: 'secondary',
    coordinates: [-100.2883158, 25.6806457],
    description: 'El recinto de espectáculos más importante del norte de México. Conciertos internacionales, eventos deportivos y espectáculos de toda índole.',
    activities: ['Conciertos internacionales', 'Eventos de box y lucha libre', 'Shows y espectáculos en vivo', 'Basquetbol y eventos deportivos'],
    routeQueryName: 'Arena Monterrey',
  },
  {
    id: 'teatro-ciudad',
    name: 'Teatro de la Ciudad',
    category: 'entretenimiento',
    tier: 'secondary',
    coordinates: [-100.3091237, 25.6689235],
    description: 'Principal teatro de Monterrey para artes escénicas, danza y espectáculos culturales. Sede histórica de las bellas artes en el centro de la ciudad.',
    activities: ['Obras de teatro y teatro infantil', 'Danza contemporánea y ballet', 'Conciertos de música clásica', 'Espectáculos culturales de temporada'],
    routeQueryName: 'Teatro de la Ciudad',
  },
  {
    id: 'centro-artes',
    name: 'Centro de las Artes',
    category: 'cultura',
    tier: 'secondary',
    coordinates: [-100.2834232, 25.6774819],
    description: 'Complejo cultural dentro del Parque Fundidora. Talleres, exposiciones y presentaciones artísticas en un ambiente de arquitectura industrial reconvertida.',
    activities: ['Talleres de artes visuales', 'Exposiciones de arte', 'Foro al aire libre', 'Residencias artísticas', 'Cineclubs y proyecciones'],
    routeQueryName: 'Centro de las Artes',
  },
  {
    id: 'parque-ninos-heroes',
    name: 'Parque Niños Héroes',
    category: 'parque',
    tier: 'secondary',
    coordinates: [-100.3139355, 25.7132588],
    description: 'Uno de los parques metropolitanos más grandes de Monterrey. Amplio espacio recreativo y deportivo para toda la familia en la zona norte del municipio.',
    activities: ['Canchas deportivas múltiples', 'Área de juegos infantiles', 'Ciclovía y senderos', 'Área de picnic y asadores', 'Espacio para mascotas'],
    routeQueryName: 'Parque Niños Héroes',
  },
  {
    id: 'palacio-gobierno',
    name: 'Palacio de Gobierno',
    category: 'cultura',
    tier: 'secondary',
    coordinates: [-100.3092772, 25.6724347],
    description: 'Sede del Poder Ejecutivo del Estado de Nuevo León. Arquitectura neoclásica del siglo XIX con impresionantes murales históricos en su interior.',
    activities: ['Tours arquitectónicos gratuitos', 'Murales históricos de Jorge González Camarena', 'Fotografía de fachada neoclásica'],
    routeQueryName: 'Palacio de Gobierno',
  },
  {
    id: 'huasteca',
    name: 'Parque La Huasteca',
    category: 'parque',
    tier: 'secondary',
    coordinates: [-100.4508431, 25.6494791],
    description: 'Cañón natural espectacular en Santa Catarina con paredes de roca de hasta 300 metros. Uno de los destinos de ecoturismo y escalada más impresionantes del norte del país.',
    activities: ['Escalada en roca (rutas de todos los niveles)', 'Senderismo y trekking', 'Rappel y actividades extremas', 'Fotografía de paisaje natural', 'Picnic en áreas naturales'],
    routeQueryName: 'Parque La Huasteca',
  },
  {
    id: 'labnl',
    name: 'Lab Cultural Ciudadano',
    category: 'cultura',
    tier: 'secondary',
    coordinates: [-100.3091416, 25.6736048],
    description: 'Espacio cultural y de encuentro ciudadano ubicado en el corazón de Monterrey. Ofrece exposiciones, talleres, conferencias y actividades para todas las edades en un ambiente moderno y accesible.',
    activities: ['Exposiciones de arte', 'Talleres creativos', 'Conferencias y charlas', 'Eventos culturales', 'Actividades para niños y familias'],
    routeQueryName: 'Lab Cultural Ciudadano',
  },
  {
    id: 'ciudad-universitaria',
    name: 'Ciudad Universitaria',
    category: 'cultura',
    tier: 'secondary',
    coordinates: [-100.3125685, 25.7259071],
    description: 'Campus principal de la Universidad Autónoma de Nuevo León (UANL). Centro académico, cultural y deportivo con arquitectura moderna y amplios espacios verdes.',
    activities: ['Paseos por el campus', 'Caminata y ciclovía peatonal', 'Restaurantes y terrazas', 'Esculturas y arte público', 'Fotografía del paisaje urbano'],
    routeQueryName: 'Ciudad Universitaria',
    // "U" con serifs — letra universitaria clásica
    svg: '<path d="M7 4v12a5 5 0 0010 0V4"/><line x1="4" y1="4" x2="10" y2="4"/><line x1="14" y1="4" x2="20" y2="4"/>',
  },
];
