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
    id: "big-slyudorudnik", name: "Большой Слюдорудник", region: "Слюдяная гора • полный массив", subtitle: "Обрывы • рвы • скальные водоразделы",
    description: "Большая горная карта: высокие обрывистые гряды, глубокие рвы и ямы, каменные россыпи на водоразделах и пять огромных валунов. Просеки, тропы и микротропы дают разные варианты маршрута.",
    seed: 7153, sky: 0x8fa9af, fog: 0x9caca0, ground: 0x2c4936, groundLight: 0x65774f,
    trees: 0x324f3a, treeDark: 0x1e3b2d, treeLight: 0x587247, rock: 0x818885, accent: "#d0dfbd",
    terrainAmplitude: 29, treeDensity: 3650, rockDensity: 520, marshiness: 0.3, terrainDifficulty: 5, fatigue: 1.65, vegetationDensity: 2.25, worldSize: 480,
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
    id: "city-2", name: "Городской спринт 2", region: "Речные кварталы", subtitle: "Фонтаны • аллеи • парки",
    description: "Плотный городской лабиринт с двумя фонтанами, тенистыми аллеями, детскими площадками и скверами. Все КП привязаны к объектам вне проезжей части.",
    seed: 8629, sky: 0xaec8d2, fog: 0xbcc9c2, ground: 0x63775c, groundLight: 0x8c9878,
    trees: 0x416b43, treeDark: 0x2b5035, treeLight: 0x82a05c, rock: 0x8b908b, accent: "#9ed8d2",
    terrainAmplitude: 0.65, treeDensity: 260, rockDensity: 12, marshiness: 0.03, urban: true, terrainDifficulty: 3, fatigue: 0.95, vegetationDensity: 0.7,
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
      p(-45, 45, 31, "tree", "Сквер, отдельное дерево"),
      p(-31, 61, 34, "building", "Здание, северный угол"),
      p(49, 45, 37, "fountain", "Фонтан, восточный борт"),
      p(52, 11, 41, "bench", "Парк, скамейка"),
      p(116, -59, 43, "building", "Здание, южный угол"),
    ],
  },
  M16: {
    start: { x: -132, z: 112 }, finish: { x: 126, z: -116 },
    controls: [
      p(-56, 58, 31, "tree", "Парк, отдельное дерево"),
      p(-31, 61, 34, "building", "Здание, восточный угол"),
      p(49, 45, 37, "fountain", "Фонтан, восточный борт"),
      p(62, 55, 41, "bench", "Аллея, скамейка"),
      p(31, -29, 43, "building", "Здание, западный угол"),
      p(-26, -66, 47, "tree", "Дерево, северная сторона"),
      p(79, -109, 51, "building", "Здание, внутренний угол"),
    ],
  },
  ME: {
    start: { x: -137, z: 121 }, finish: { x: 131, z: -121 },
    controls: [
      p(-101, 56, 31, "building", "Здание, северный угол"),
      p(-41, 104, 34, "fence", "Ограждение, внешний угол"),
      p(20, 56, 37, "building", "Здание, юго-западный угол"),
      p(102, 111, 41, "tree", "Куст, восточная сторона"),
      p(135, 36, 43, "bench", "Двор, скамейка у фасада"),
      p(65, -25, 47, "building", "Здание, северный проход"),
      p(11, -11, 51, "fence", "Ограждение, разрыв"),
      p(-61, -41, 53, "building", "Здание, западный угол"),
      p(-45, -45, 57, "bench", "Игровая площадка, скамейка"),
      p(81, -105, 61, "building", "Здание, южный угол"),
    ],
  },
};

const CITY2_COURSES: Record<Difficulty, Omit<Course, "difficulty" | "label" | "nominalLength">> = {
  M12: {
    start: { x: -132, z: -122 }, finish: { x: 132, z: 122 },
    controls: [
      p(-41, -45, 31, "fountain", "Западный фонтан, восточный борт"),
      p(-58, -24, 34, "bench", "Липовая аллея, скамейка"),
      p(34, -34, 37, "building", "Кирпичный дом, угол"),
      p(49, 45, 41, "fountain", "Восточный фонтан, борт"),
      p(70, 68, 43, "tree", "Розарий, отдельное дерево"),
    ],
  },
  M16: {
    start: { x: -132, z: -122 }, finish: { x: 126, z: 116 },
    controls: [
      p(-41, -45, 31, "fountain", "Западный фонтан, борт"),
      p(-63, -66, 34, "bench", "Тихий сквер, скамейка"),
      p(-28, 33, 37, "building", "Дом с аркой, северный угол"),
      p(49, 45, 41, "fountain", "Восточный фонтан, борт"),
      p(66, 25, 43, "bench", "Центральная аллея, скамейка"),
      p(32, -62, 47, "tree", "Детский парк, дерево"),
      p(-62, 72, 51, "building", "Старый фасад, угол"),
    ],
  },
  ME: {
    start: { x: -137, z: -121 }, finish: { x: 131, z: 121 },
    controls: [
      p(-104, -54, 31, "building", "Дом у виадука, угол"),
      p(-41, -45, 34, "fountain", "Западный фонтан, борт"),
      p(-66, -22, 37, "bench", "Липовая аллея, скамейка"),
      p(-22, 58, 41, "tree", "Северный сквер, дерево"),
      p(22, 33, 43, "building", "Арка, внутренний угол"),
      p(49, 45, 47, "fountain", "Восточный фонтан, борт"),
      p(70, 68, 51, "bench", "Розарий, скамейка"),
      p(34, -34, 53, "building", "Кирпичный дом, угол"),
      p(-58, -72, 57, "tree", "Южная роща, дерево"),
      p(102, -66, 61, "fence", "Ограда набережной, конец"),
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

const MINE_POINTS: Record<Difficulty, Vec2[]> = {
  M12: [{x:-108,z:144},{x:-54,z:90},{x:0,z:36},{x:54,z:-36},{x:108,z:-108}],
  M16: [{x:-108,z:126},{x:-72,z:54},{x:-18,z:72},{x:36,z:18},{x:72,z:-54},{x:18,z:-90},{x:108,z:-126}],
  ME: [{x:-126,z:108},{x:-72,z:126},{x:-36,z:54},{x:18,z:90},{x:72,z:36},{x:126,z:-18},{x:54,z:-54},{x:-18,z:-36},{x:-90,z:-90},{x:36,z:-126}],
};

export function getCourse(biomeId: BiomeId, difficulty: Difficulty): Course {
  if (biomeId === "tutorial") {
    return { difficulty: "M12", label: "Обучение", ...TUTORIAL, nominalLength: courseLength(TUTORIAL.start, TUTORIAL.finish, TUTORIAL.controls) };
  }
  const source = biomeId === "city" ? CITY_COURSES[difficulty] : biomeId === "city-2" ? CITY2_COURSES[difficulty] : NATURE_COURSES[difficulty];
  const labels: Record<Difficulty, string> = { M12: "Лёгкая дистанция", M16: "Средняя дистанция", ME: "Элитная дистанция" };
  if (biomeId === "mine") {
    const controls = source.controls.map((cp, index) => ({ ...cp, ...MINE_POINTS[difficulty][index], feature: (index % 3 === 0 ? "trail" : index % 3 === 1 ? "rock" : "depression") as FeatureKind, description: MINE_DESCRIPTIONS[difficulty][index] }));
    const start = { x: -144, z: 144 }, finish = { x: 144, z: -144 };
    return { ...source, start, finish, controls, difficulty, label: labels[difficulty], nominalLength: courseLength(start, finish, controls) };
  }
  if (biomeId === "big-slyudorudnik") {
    const scale = 1.35;
    const start = { x: source.start.x * scale, z: source.start.z * scale };
    const finish = { x: source.finish.x * scale, z: source.finish.z * scale };
    const controls = source.controls.map((cp) => ({ ...cp, x: cp.x * scale, z: cp.z * scale }));
    return { ...source, start, finish, controls, difficulty, label: labels[difficulty], nominalLength: courseLength(start, finish, controls) };
  }
  return { ...source, difficulty, label: labels[difficulty], nominalLength: courseLength(source.start, source.finish, source.controls) };
}

export function getBiome(id: BiomeId): BiomeDef {
  return BIOMES.find((b) => b.id === id) ?? BIOMES[0];
}

export function recordKey(biome: BiomeId, difficulty: Difficulty, level = 1): string {
  return `${biome}:${difficulty}:L${level}`;
}
