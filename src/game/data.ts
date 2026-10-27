import type { BiomeDef, BiomeId, ControlPoint, Course, Difficulty, FeatureKind, Vec2 } from "./types";

export const BIOMES: BiomeDef[] = [
  {
    id: "north-ural", name: "Северный Урал", region: "Горная тайга", subtitle: "Скалы • ели • крутые склоны",
    description: "Холодная тайга у подножия хребта. Читай горизонтали, используй скалы и не теряй высоту на крутых склонах.",
    seed: 1107, sky: 0x9cbbc2, fog: 0xadc3bd, ground: 0x294b3b, groundLight: 0x58705a,
    trees: 0x3b5b49, treeDark: 0x2a493b, treeLight: 0x58785a, rock: 0x78817d, accent: "#b9e0cc",
    terrainAmplitude: 19, treeDensity: 2450, rockDensity: 240, marshiness: 0.2, terrainDifficulty: 5, fatigue: 1.5, vegetationDensity: 1.8,
  },
  {
    id: "south-ural", name: "Южный Урал", region: "Берёзовые холмы", subtitle: "Поляны • холмы • ручьи",
    description: "Светлый берёзовый лес и широкие поляны. Дальние холмы помогают держать азимут, но тропы часто уводят в сторону.",
    seed: 2219, sky: 0xb8d4d2, fog: 0xc5d3b6, ground: 0x597346, groundLight: 0x82965b,
    trees: 0x537845, treeDark: 0x315b3e, treeLight: 0x8da65a, rock: 0x8d8b78, accent: "#e3dda0",
    terrainAmplitude: 11, treeDensity: 980, rockDensity: 125, marshiness: 0.1, terrainDifficulty: 2, fatigue: 1, vegetationDensity: 1.1,
  },
  {
    id: "ladoga", name: "Приладожье", region: "Карельские скалы", subtitle: "Гранит • озёра • сосны",
    description: "Сосновый лес на гранитных выходах. Озёра надёжно ограничивают маршрут, а скальные гряды задают направление.",
    seed: 3371, sky: 0x9fbfc8, fog: 0xaabfba, ground: 0x3c5942, groundLight: 0x6d7a55,
    trees: 0x35523b, treeDark: 0x203d32, treeLight: 0x64734a, rock: 0x92958e, accent: "#add8e4",
    terrainAmplitude: 7, treeDensity: 520, rockDensity: 145, marshiness: 0.25, terrainDifficulty: 1, fatigue: 0.85, vegetationDensity: 0.9,
  },
  {
    id: "bog", name: "Ленобласть", region: "Болотный массив", subtitle: "Мхи • островки • мелколесье",
    description: "Сложная болотистая местность под Петербургом. Островки и лесные границы важнее троп, а прямой путь не всегда быстрый.",
    seed: 4483, sky: 0xa8b7b0, fog: 0x9eada0, ground: 0x475640, groundLight: 0x788064,
    trees: 0x3e513a, treeDark: 0x263c31, treeLight: 0x69714b, rock: 0x737a70, accent: "#b7d6c4",
    terrainAmplitude: 4.8, treeDensity: 1750, rockDensity: 70, marshiness: 0.95, terrainDifficulty: 4, fatigue: 1.35, vegetationDensity: 1.6,
  },
  {
    id: "mixed", name: "Средняя полоса", region: "Смешанный лес", subtitle: "Овраги • поляны • тропы",
    description: "Разнообразный лес с оврагами, полянами и густыми участками. Хорошая карта для выбора между тропой и азимутом.",
    seed: 5591, sky: 0xb1c9bd, fog: 0xb7c5ac, ground: 0x3f6243, groundLight: 0x758557,
    trees: 0x3e673f, treeDark: 0x244631, treeLight: 0x79954e, rock: 0x808579, accent: "#d5d99b",
    terrainAmplitude: 9.5, treeDensity: 1850, rockDensity: 145, marshiness: 0.35, terrainDifficulty: 3, fatigue: 1.1, vegetationDensity: 1.45,
  },
  {
    id: "recreation", name: "База отдыха", region: "Лесные коттеджи", subtitle: "Домики • веранды • узкие тропы",
    description: "Уютная лесная база с бревенчатыми домиками, верандами и тропами между корпусами. Хорошая местность для быстрой, но спокойной дистанции.",
    seed: 6121, sky: 0xb4cbbd, fog: 0xbdc9b2, ground: 0x4b6746, groundLight: 0x81905f,
    trees: 0x42633f, treeDark: 0x294733, treeLight: 0x7b9053, rock: 0x85877b, accent: "#e1c08d",
    terrainAmplitude: 2.8, treeDensity: 680, rockDensity: 45, marshiness: 0.15, terrainDifficulty: 2, fatigue: 0.9, vegetationDensity: 0.9,
  },
  {
    id: "slyudorudnik", name: "Слюдорудник", region: "Средний Урал • Кыштым", subtitle: "Скалы • папоротник • горная тайга",
    description: "Крутые лесистые склоны Слюдяной горы, скальные выходы, отвалы и заросли папоротника. Читай лощины и не теряй высоту на каменных перевалах.",
    seed: 6947, sky: 0x91abb0, fog: 0x9eafa4, ground: 0x304d38, groundLight: 0x687951,
    trees: 0x35533d, treeDark: 0x203e30, treeLight: 0x597548, rock: 0x858b88, accent: "#c0d6b0",
    terrainAmplitude: 22, treeDensity: 2650, rockDensity: 290, marshiness: 0.25, terrainDifficulty: 5, fatigue: 1.55, vegetationDensity: 1.9,
  },
  {
    id: "mine", name: "Штольня", region: "Слюдорудник • подземелье", subtitle: "Темнота • рельсы • что-то живое",
    description: "Заброшенная слюдяная выработка: блестящие стены, деревянная крепь, рельсы и тупиковые штреки. L — фонарик. В темноте лучше не стоять на месте.",
    seed: 7717, sky: 0x050807, fog: 0x070b09, ground: 0x242a27, groundLight: 0x4a5049,
    trees: 0x26352c, treeDark: 0x15251d, treeLight: 0x3b4e3d, rock: 0x626b69, accent: "#e4bd78",
    terrainAmplitude: 1.2, treeDensity: 0, rockDensity: 180, marshiness: 0, mine: true, terrainDifficulty: 5, fatigue: 1.3, vegetationDensity: 0,
  },
  {
    id: "city", name: "Городской спринт", region: "Центральные кварталы", subtitle: "Многоэтажки • трафик • переходы",
    description: "Быстрая дистанция среди многоэтажек, дворов и живого трафика. Читай углы зданий, используй переходы и не выбегай на проезжую часть.",
    seed: 6607, sky: 0xb7c9d1, fog: 0xc1c9c4, ground: 0x6c7b61, groundLight: 0x8b957b,
    trees: 0x4d7048, treeDark: 0x34583a, treeLight: 0x7d9558, rock: 0x8e918b, accent: "#f0c88d",
    terrainAmplitude: 0.8, treeDensity: 190, rockDensity: 15, marshiness: 0.05, urban: true, terrainDifficulty: 2, fatigue: 0.9, vegetationDensity: 0.55,
  },
  {
    id: "tutorial", name: "Школа азимута", region: "Учебная поляна", subtitle: "Карта • компас • первая отметка",
    description: "Короткая учебная дистанция. Подсказки появляются по ходу и знакомят с управлением без перегруза.",
    seed: 101, sky: 0xb6d3ca, fog: 0xc3d3bd, ground: 0x4f714b, groundLight: 0x849561,
    trees: 0x456e45, treeDark: 0x2b5038, treeLight: 0x7f9b55, rock: 0x8a8d7f, accent: "#f2b36e",
    terrainAmplitude: 3, treeDensity: 260, rockDensity: 38, marshiness: 0.1, tutorial: true, terrainDifficulty: 1, fatigue: 0.75, vegetationDensity: 0.7,
  },
];

const p = (x: number, z: number, code: number, feature: FeatureKind, description: string): ControlPoint => ({ x, z, code, feature, description });

const NATURE_COURSES: Record<Difficulty, Omit<Course, "difficulty" | "label" | "nominalLength">> = {
  M12: {
    start: { x: -132, z: 112 }, finish: { x: 137, z: -102 },
    controls: [
      p(-91, 73, 31, "trail", "Перекрёсток троп"),
      p(-41, 46, 34, "rock", "Большой камень"),
      p(1, 31, 37, "tree", "Отдельно стоящее дерево"),
      p(52, 11, 41, "trail", "Изгиб тропы"),
      p(116, -59, 43, "hill", "Подножие холма"),
    ],
  },
  M16: {
    start: { x: -132, z: 112 }, finish: { x: 126, z: -116 },
    controls: [
      p(-86, 105, 31, "tree", "Северный край поляны"),
      p(-31, 61, 34, "rock", "Камень, 2 м"),
      p(25, 86, 37, "hill", "Вершина холма"),
      p(76, 37, 41, "water", "Озеро, северо-западный берег"),
      p(31, -29, 43, "marsh", "Болото, островок"),
      p(-26, -76, 47, "root", "Дерево, северная сторона"),
      p(79, -109, 51, "trail", "Пересечение троп"),
    ],
  },
  ME: {
    start: { x: -137, z: 121 }, finish: { x: 131, z: -121 },
    controls: [
      p(-101, 56, 31, "depression", "Овраг, верхняя часть"),
      p(-41, 96, 34, "rock", "Скала, северная сторона"),
      p(20, 56, 37, "rock", "Каменная россыпь"),
      p(96, 111, 41, "hill", "Холм, восточный склон"),
      p(135, 36, 43, "water", "Озеро, южный мыс"),
      p(65, -25, 47, "marsh", "Болото, северный край"),
      p(5, -11, 51, "depression", "Яма"),
      p(-61, -41, 53, "rock", "Камень, западная сторона"),
      p(-20, -116, 57, "water", "Ручей, излучина"),
      p(81, -105, 61, "hill", "Холм, подножие"),
    ],
  },
};

const CITY_COURSES: Record<Difficulty, Omit<Course, "difficulty" | "label" | "nominalLength">> = {
  M12: {
    start: { x: -132, z: 112 }, finish: { x: 137, z: -102 },
    controls: [
      p(-91, 73, 31, "trail", "Дорожки, перекрёсток"),
      p(-41, 46, 34, "building", "Здание, северный угол"),
      p(1, 31, 37, "tree", "Отдельно стоящее дерево"),
      p(52, 11, 41, "fence", "Ограждение, конец"),
      p(116, -59, 43, "building", "Здание, южный угол"),
    ],
  },
  M16: {
    start: { x: -132, z: 112 }, finish: { x: 126, z: -116 },
    controls: [
      p(-86, 105, 31, "tree", "Парк, отдельное дерево"),
      p(-31, 61, 34, "building", "Здание, восточный угол"),
      p(25, 86, 37, "fence", "Ограждение, внутренний угол"),
      p(76, 37, 41, "tree", "Парк, северо-западная дорожка"),
      p(31, -29, 43, "building", "Здание, западный угол"),
      p(-26, -76, 47, "tree", "Дерево, северная сторона"),
      p(79, -109, 51, "trail", "Дорожки, пересечение"),
    ],
  },
  ME: {
    start: { x: -137, z: 121 }, finish: { x: 131, z: -121 },
    controls: [
      p(-101, 56, 31, "building", "Здание, северный угол"),
      p(-41, 96, 34, "fence", "Ограждение, внешний угол"),
      p(20, 56, 37, "building", "Здание, юго-западный угол"),
      p(96, 111, 41, "tree", "Куст, восточная сторона"),
      p(135, 36, 43, "trail", "Дворовый проезд, южный выход"),
      p(65, -25, 47, "building", "Здание, северный проход"),
      p(5, -11, 51, "fence", "Ограждение, разрыв"),
      p(-61, -41, 53, "building", "Здание, западный угол"),
      p(-20, -116, 57, "trail", "Пешеходный переход"),
      p(81, -105, 61, "building", "Здание, южный угол"),
    ],
  },
};

const TUTORIAL = {
  start: { x: -66, z: 62 }, finish: { x: 67, z: -57 },
  controls: [
    p(-35, 40, 31, "trail", "Перекрёсток троп"),
    p(0, 12, 34, "rock", "Большой камень"),
    p(37, -17, 37, "tree", "Отдельно стоящее дерево"),
  ],
};

function courseLength(start: Vec2, finish: Vec2, controls: ControlPoint[]): number {
  let total = 0, from = start;
  for (const cp of [...controls, finish]) {
    total += Math.hypot(cp.x - from.x, cp.z - from.z);
    from = cp;
  }
  return Math.round(total / 10) * 10;
}

const MINE_DESCRIPTIONS: Record<Difficulty, string[]> = {
  M12: ["Штрек, перекрёсток", "Слюдяная жила", "Завал, северный обход", "Рельсы, стрелка", "Просевший ход"],
  M16: ["Боковой штрек", "Деревянная крепь", "Верхний горизонт", "Слюдяная стена", "Просевший ход", "Заброшенная вагонетка", "Рельсы, тупик"],
  ME: ["Верхний штрек", "Слюдяная жила", "Каменный завал", "Восточный горизонт", "Обваленный ход", "Просевшая крепь", "Нижний горизонт", "Западный штрек", "Рельсы, излом", "Старый шурф"],
};

export function getCourse(biomeId: BiomeId, difficulty: Difficulty): Course {
  if (biomeId === "tutorial") {
    return { difficulty: "M12", label: "Обучение", ...TUTORIAL, nominalLength: courseLength(TUTORIAL.start, TUTORIAL.finish, TUTORIAL.controls) };
  }
  const source = biomeId === "city" ? CITY_COURSES[difficulty] : NATURE_COURSES[difficulty];
  const labels: Record<Difficulty, string> = { M12: "Лёгкая дистанция", M16: "Средняя дистанция", ME: "Элитная дистанция" };
  if (biomeId === "mine") {
    const controls = source.controls.map((cp, index) => ({ ...cp, feature: (index % 3 === 0 ? "trail" : index % 3 === 1 ? "rock" : "depression") as FeatureKind, description: MINE_DESCRIPTIONS[difficulty][index] }));
    return { ...source, controls, difficulty, label: labels[difficulty], nominalLength: courseLength(source.start, source.finish, controls) };
  }
  return { ...source, difficulty, label: labels[difficulty], nominalLength: courseLength(source.start, source.finish, source.controls) };
}

export function getBiome(id: BiomeId): BiomeDef {
  return BIOMES.find((b) => b.id === id) ?? BIOMES[0];
}

export function recordKey(biome: BiomeId, difficulty: Difficulty, level = 1): string {
  return `${biome}:${difficulty}:L${level}`;
}
