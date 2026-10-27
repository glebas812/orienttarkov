export const INPUT_CONFIG = {
  MOUSE_SENS_X: 0.0022,
  MOUSE_SENS_Y: 0.0019,
  INVERT_X: false,
  INVERT_Y: false,
} as const;

export const GAME_CONFIG = {
  WORLD_SIZE: 340,
  PLAYER_HEIGHT: 1.68,
  WALK_SPEED: 4.7,
  RUN_SPEED: 8.2,
  ACCELERATION: 15,
  INTERACT_DISTANCE: 3.1,
  WRONG_CONTROL_PENALTY: 15,
  MAX_STAMINA: 100,
  UI_PUBLISH_INTERVAL: 0.12,
  MAX_PIXEL_RATIO: 1.5,
} as const;

export const DIFFICULTY_INFO = {
  M12: { label: "М12", name: "Знакомство", detail: "Подсветка следующего КП на спортивной карте" },
  M16: { label: "М16", name: "Дистанция", detail: "Без метки игрока: карта, компас и ориентиры" },
  ME: { label: "МЭ", name: "Элита", detail: "Сложная навигация без подсказок и метки игрока" },
} as const;

export const COLORS = {
  orange: 0xf26722,
  purple: 0x9c3d78,
  white: 0xf7f3e8,
} as const;
