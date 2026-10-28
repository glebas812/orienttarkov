import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Activity, ArrowLeft, BookOpen, Check, ChevronRight, Compass, Dumbbell, Flag, Flashlight, Gauge, HeartPulse, Map, Mountain, Pause, Play, RotateCcw, Sparkles, Trophy, Volume2, VolumeX, X, Zap } from "lucide-react";
import { gameActions, startGame, stopGame } from "@/game/boot";
import { BIOMES, getBiome, getCourse, recordKey } from "@/game/data";
import { DIFFICULTY_INFO } from "@/game/config";
import { getSnapshot, subscribe } from "@/game/state";
import { EMPTY_TESTER, validTester, type TesterDevice, type TesterProfile } from "@/game/tester";
import type { Difficulty, GameSnapshot, UpgradeStat } from "@/game/types";

function formatTime(value: number, tenths = false): string {
  const safe = Math.max(0, value);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const fraction = Math.floor((safe % 1) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${tenths ? `.${fraction}` : ""}`;
}

function direction(degrees: number): string {
  return ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"][Math.round(degrees / 45) % 8];
}

function MapView({ snap }: { snap: GameSnapshot }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) gameActions.renderMap(ref.current);
  });
  if (!snap.mapOpen) return null;
  return (
    <div className="map-overlay">
      <div className="map-topbar">
        <div><Map size={19} /><strong>{getBiome(snap.biomeId).name}</strong><span>{DIFFICULTY_INFO[snap.difficulty].label}</span></div>
        <button className="icon-button light" onClick={() => gameActions.toggleMap()} aria-label="Закрыть карту"><X size={22} /></button>
      </div>
      <canvas ref={ref} className="orienteering-map" />
      <div className="map-footer"><span>M / Tab — убрать карту</span><span>Белый — хороший лес • жёлтый — открыто • зелёный — медленно</span></div>
    </div>
  );
}

const UPGRADE_INFO: Record<UpgradeStat, { name: string; detail: string; icon: typeof Zap }> = {
  speed: { name: "Скорость", detail: "+2,8% к темпу за ранг", icon: Zap },
  strength: { name: "Сила", detail: "Легче зелёнка, склоны и вода", icon: Dumbbell },
  recovery: { name: "Восстановление", detail: "+8,5% за ранг", icon: HeartPulse },
};

function ProfilePanel({ snap }: { snap: GameSnapshot }) {
  return (
    <section className="profile-panel">
      <div className="profile-summary">
        <div className="level-medallion"><span>УРОВЕНЬ</span><strong>{snap.level}</strong></div>
        <div className="xp-block">
          <div><span>Опыт спортсмена</span><strong>{snap.xp} / {snap.xpNext}</strong></div>
          <div className="xp-track"><i style={{ width: `${Math.min(100, snap.xp / snap.xpNext * 100)}%` }} /></div>
          <small>{snap.skillPoints > 0 ? `Доступно очков навыков: ${snap.skillPoints}` : "Новые очки навыков — со следующим уровнем"}</small>
        </div>
      </div>
      <div className="upgrade-list">
        {(Object.keys(UPGRADE_INFO) as UpgradeStat[]).map((stat) => {
          const info = UPGRADE_INFO[stat], Icon = info.icon, rank = snap.upgrades[stat];
          return (
            <button key={stat} onClick={() => gameActions.buyUpgrade(stat)} disabled={snap.skillPoints <= 0 || rank >= 8} title={info.detail}>
              <Icon size={17} /><span><strong>{info.name}</strong><small>{info.detail}</small></span><em>{rank}/8</em><b>{rank >= 8 ? "MAX" : "+"}</b>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function TesterScreen() {
  const [profile, setProfile] = useState<TesterProfile>({ ...EMPTY_TESTER });
  const [pace, setPace] = useState("5:30");
  const [error, setError] = useState("");
  const setNumber = (key: keyof TesterProfile, value: string) => setProfile((old) => ({ ...old, [key]: Number(value) }));
  const setDevice = (device: TesterDevice) => setProfile((old) => ({ ...old, device }));
  const submit = () => {
    const match = pace.trim().match(/^(\d{1,2})(?::(\d{1,2}))?$/);
    const paceSeconds = match ? Number(match[1]) * 60 + Number(match[2] ?? 0) : Number(pace) * 60;
    const next = { ...profile, paceSeconds };
    if (!validTester(next)) {
      setError("Проверь значения: темп 2:30–15:00, вес 35–200 кг и показатели в допустимых пределах.");
      return;
    }
    gameActions.startTester(next);
  };
  return (
    <div className="screen modal-screen tester-screen">
      <div className="tester-card">
        <button className="back-button" onClick={() => gameActions.closeTester()}><ArrowLeft size={18} /> Главное меню</button>
        <span className="eyebrow">ОТДЕЛЬНЫЙ ТЕСТОВЫЙ МОДУЛЬ</span>
        <h1>Тестер спортсмена</h1>
        <p className="tester-intro">Показатели преобразуются только в игровые модификаторы. Это не медицинская или тренировочная оценка. Рекорды и опыт в тесте отключены.</p>
        <div className="device-tabs">
          <button className={profile.device === "garmin" ? "active" : ""} onClick={() => setDevice("garmin")}><strong>GARMIN</strong><span>VO₂ max и порог</span></button>
          <button className={profile.device === "polar" ? "active" : ""} onClick={() => setDevice("polar")}><strong>POLAR</strong><span>Running Index и пульс</span></button>
        </div>
        <div className="tester-fields common-fields">
          <label><span>Вес, кг</span><input type="number" min="35" max="200" value={profile.weight} onChange={(e) => setNumber("weight", e.target.value)} /></label>
          <label><span>Обычный темп, мин/км</span><input type="text" inputMode="numeric" value={pace} onChange={(e) => setPace(e.target.value)} placeholder="5:30" /></label>
          <label><span>Пульс макс., уд/мин</span><input type="number" min="120" max="230" value={profile.hrMax} onChange={(e) => setNumber("hrMax", e.target.value)} /></label>
        </div>
        <div className="tester-device-heading"><Activity size={18} /><strong>{profile.device === "garmin" ? "Показатели Garmin" : "Показатели Polar"}</strong><span>только числовые поля</span></div>
        {profile.device === "garmin" ? (
          <div className="tester-fields">
            <label><span>VO₂ max</span><input type="number" min="20" max="90" value={profile.vo2max} onChange={(e) => setNumber("vo2max", e.target.value)} /></label>
            <label><span>Пороговый пульс</span><input type="number" min="90" max="220" value={profile.lactateThreshold} onChange={(e) => setNumber("lactateThreshold", e.target.value)} /></label>
          </div>
        ) : (
          <div className="tester-fields">
            <label><span>Running Index</span><input type="number" min="20" max="90" value={profile.runningIndex} onChange={(e) => setNumber("runningIndex", e.target.value)} /></label>
            <label><span>Пульс покоя</span><input type="number" min="30" max="120" value={profile.hrRest} onChange={(e) => setNumber("hrRest", e.target.value)} /></label>
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
        <div className="tester-note"><Gauge size={20} /><span>Темп влияет на скорость, аэробные показатели — на запас и восстановление, вес — на силу и проходимость.</span></div>
        <button className="primary-button tester-submit" onClick={submit}><Play size={18} /> Применить и выбрать старт <ChevronRight size={18} /></button>
      </div>
    </div>
  );
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const biome = getBiome(snap.biomeId);
  const course = getCourse(snap.biomeId, snap.difficulty);
  const best = snap.bestTimes[recordKey(snap.biomeId, snap.difficulty, snap.mode === "results" ? snap.runLevel : snap.level)];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    startGame(canvas);
    return () => stopGame();
  }, []);

  return (
    <div id="game-root">
      <canvas id="game-canvas" ref={canvasRef} />
      <div id="ui-overlay">
        {snap.mode === "title" && (
          <div className="screen title-screen">
            <header className="brand-bar">
              <div className="brand"><span className="brand-mark"><Compass size={25} /></span><div><strong>АЗИМУТ</strong><small>спортивное ориентирование</small></div></div>
              <div className="brand-actions"><span className="author-credit">Создано <strong>GLEBASS812</strong></span><button className="icon-button" onClick={() => gameActions.toggleMute()} aria-label="Звук">{snap.muted ? <VolumeX /> : <Volume2 />}</button></div>
            </header>
            <main className="menu-layout">
              <section className="menu-main">
                <div className="hero-copy">
                  <span className="eyebrow">КАРТА. КОМПАС. ТВОЙ МАРШРУТ.</span>
                  <h1>Найди свой путь<br />через живую местность.</h1>
                  <p>Читай рельеф и проходимость, выбирай между узкой тропой и азимутом, развивай спортсмена и улучшай своё время.</p>
                </div>
                <div className="menu-shortcuts">
                  <button className="tutorial-banner" onClick={() => { gameActions.selectBiome("tutorial"); gameActions.openBriefing(); }}>
                    <span className="tutorial-icon"><BookOpen size={24} /></span><span><strong>Начать с обучения</strong><small>Короткая дистанция • карта в руках • 3 КП</small></span><ChevronRight size={22} />
                  </button>
                  <button className={`tester-banner ${snap.tester ? "active" : ""}`} onClick={() => gameActions.openTester()}><Activity size={21} /><span><strong>Тестер</strong><small>Garmin / Polar</small></span></button>
                </div>
                {snap.tester && <div className="tester-active"><Activity size={15} /><span>Тестовый профиль активен: рекорды и опыт отключены</span><button onClick={() => gameActions.clearTester()}>Вернуть обычный режим</button></div>}
                <ProfilePanel snap={snap} />
                <div className="section-heading"><span>ВЫБЕРИ МЕСТНОСТЬ</span><small>11 карт • от полян до большого Слюдорудника, двух городов и штольни</small></div>
                <div className="biome-grid">
                  {BIOMES.filter((item) => !item.tutorial).map((item) => {
                    const record = snap.bestTimes[recordKey(item.id, snap.difficulty, snap.level)];
                    return (
                      <button key={item.id} className={`biome-card ${item.id === snap.biomeId ? "selected" : ""}`} data-biome={item.id} onClick={() => gameActions.selectBiome(item.id)}>
                        <div className="biome-art"><Mountain size={24} /><span>{item.region}</span><em className="terrain-pips">{Array.from({ length: 5 }, (_, i) => <i key={i} className={i < item.terrainDifficulty ? "on" : ""} />)}</em></div>
                        <div className="biome-info"><strong>{item.name}</strong><small>{item.subtitle}</small>{record && <em><Trophy size={12} /> {formatTime(record, true)}</em>}</div>
                        {item.id === snap.biomeId && <span className="selected-check"><Check size={15} /></span>}
                      </button>
                    );
                  })}
                </div>
                <footer className="sponsor-bar"><span>При поддержке</span><strong>ЖУКОВ ОРИЕНТ</strong><strong className="garmin-logo">GARMIN</strong><strong>ГОРНОЗАВОДСК</strong></footer>
              </section>
              <aside className="course-panel">
                <span className="eyebrow">ТВОЯ ДИСТАНЦИЯ • УРОВЕНЬ {snap.level}</span>
                <h2>{biome.name}</h2>
                <p>{biome.description}</p>
                <div className="terrain-rating"><span>Сложность местности</span><div>{Array.from({ length: 5 }, (_, i) => <i key={i} className={i < biome.terrainDifficulty ? "on" : ""} />)}</div><strong>{biome.terrainDifficulty}/5</strong></div>
                <div className="difficulty-list">
                  {(Object.keys(DIFFICULTY_INFO) as Difficulty[]).map((id) => (
                    <button key={id} className={snap.difficulty === id ? "active" : ""} onClick={() => gameActions.selectDifficulty(id)}>
                      <span>{DIFFICULTY_INFO[id].label}</span><strong>{DIFFICULTY_INFO[id].name}</strong><small>{DIFFICULTY_INFO[id].detail}</small>
                    </button>
                  ))}
                </div>
                <div className="course-stats"><div><Flag size={17} /><span><strong>{course.controls.length}</strong> КП</span></div><div><Mountain size={17} /><span><strong>{course.nominalLength} м</strong> по прямой</span></div></div>
                {best && <div className="best-time"><Trophy size={17} /><span>Рекорд уровня {snap.level}</span><strong>{formatTime(best, true)}</strong></div>}
                <button className="primary-button" onClick={() => gameActions.openBriefing()}><Play size={19} fill="currentColor" /> К дистанции <ChevronRight size={19} /></button>
                <small className="desktop-note">Рекорды хранятся в этом браузере • нужны клавиатура и мышь</small>
              </aside>
            </main>
          </div>
        )}

        {snap.mode === "tester" && <TesterScreen />}

        {snap.mode === "briefing" && (
          <div className="screen modal-screen">
            <div className="briefing-card">
              <button className="back-button" onClick={() => gameActions.quitToTitle()}><ArrowLeft size={18} /> Выбор карты</button>
              <span className="eyebrow">{biome.region} • {DIFFICULTY_INFO[snap.difficulty].label}</span>
              <h1>{biome.tutorial ? "Первая дистанция" : course.label}</h1>
              <p className="briefing-description">{biome.description}</p>
              {snap.tester && <div className="briefing-tester"><Activity size={17} /> ТЕСТОВЫЙ СТАРТ — результат не попадёт в рекорды, опыт не начисляется.</div>}
              <div className="briefing-stats"><div><strong>{course.controls.length}</strong><span>контрольных пунктов</span></div><div><strong>{course.nominalLength} м</strong><span>по прямой</span></div><div><strong>{best ? formatTime(best, true) : "—"}</strong><span>рекорд уровня {snap.level}</span></div></div>
              <div className="briefing-columns">
                <div><h3>Как пройти</h3><ol className="steps"><li><span>1</span>Изучи линию дистанции, зелёные зоны и легенду.</li><li><span>2</span>Бери КП строго по порядку, отмечайся клавишей E.</li><li><span>3</span>Обходи глубокую воду: мокрая одежда замедляет и после выхода.</li></ol><div className="key-guide"><span><kbd>WASD</kbd> движение</span><span><kbd>Shift</kbd> бег</span><span><kbd>Space</kbd> прыжок</span><span><kbd>ЛКМ</kbd> поднять карту</span><span><kbd>Колесо</kbd> повернуть</span><span><kbd>F + ЛКМ</kbd> двигать карту</span><span><kbd>M</kbd> большая карта</span><span><kbd>E</kbd> отметка</span>{biome.mine && <span><kbd>L</kbd> фонарик</span>}</div></div>
                <div><h3>Легенда КП</h3><div className="legend-list">{course.controls.map((cp, index) => <div key={cp.code}><span>{index + 1}</span><strong>{cp.code}</strong><small>{cp.description}</small></div>)}</div></div>
              </div>
              <button className="primary-button start-button" onClick={() => gameActions.beginCourse()}><Flag size={19} /> На старт <span>Space</span></button>
            </div>
          </div>
        )}

        {(snap.mode === "playing" || snap.mode === "paused") && (
          <div className={`hud ${snap.mapOpen ? "hidden" : ""}`}>
            <div className="hud-top">
              <div className="hud-location"><span>{biome.region}</span><strong>{biome.name}</strong><em>{DIFFICULTY_INFO[snap.difficulty].label}</em></div>
              <div className="heading"><Compass size={18} /><strong>{Math.round(snap.bearing).toString().padStart(3, "0")}°</strong><span>{direction(snap.bearing)}</span></div>
              <div className="hud-time"><span>ВРЕМЯ</span><strong>{formatTime(snap.elapsed + snap.penalty)}</strong>{snap.penalty > 0 && <small>+{snap.penalty} сек штраф</small>}</div>
              <button className="icon-button hud-pause" onClick={() => gameActions.pause()} aria-label="Пауза"><Pause size={20} /></button>
            </div>
            <div className="control-progress"><span>КП</span><strong>{snap.currentControl}</strong><em>/ {snap.totalControls}</em><div>{course.controls.map((cp, i) => <i key={cp.code} className={i < snap.currentControl ? "done" : i === snap.currentControl ? "current" : ""} />)}</div></div>
            {biome.tutorial && <div className="tutorial-coach"><BookOpen size={21} /><div><span>ОБУЧЕНИЕ • ШАГ {snap.tutorialStep + 1}</span><p>{snap.tutorialText}</p></div></div>}
            {snap.tester && <div className="tester-watermark">ТЕСТ • БЕЗ РЕКОРДОВ И ОПЫТА</div>}
            <div className="hud-bottom">
              <div className="stamina"><div><span>ВЫНОСЛИВОСТЬ</span><strong>{Math.round(snap.stamina)}</strong></div><div className="stamina-track"><i style={{ width: `${snap.stamina}%` }} className={snap.stamina < 25 ? "low" : ""} /></div><small>{snap.speed.toFixed(1)} м/с • {snap.surface}</small>{snap.wet && <em>Мокрая одежда: темп и восстановление снижены</em>}</div>
              <div className={`map-hand-hint ${snap.mapRaised ? "raised" : ""}`}><Map size={16} /><span>{snap.mapAdjust ? "Мышь — переместить карту • отпусти F для обзора" : snap.mapRaised ? "Колёсико — повернуть • V + колёсико — масштаб • F — двигать" : "Зажми ЛКМ — поднять карту"}</span></div>
              <div className="quick-keys"><span><kbd>M</kbd> карта</span><span><kbd>C</kbd> компас</span>{biome.mine && <span><kbd>L</kbd> фонарик</span>}<span><kbd>Shift</kbd> бег</span><span><kbd>Space</kbd> прыжок</span></div>
            </div>
            {snap.canInteract && <div className="interact-prompt">{snap.interactLabel}</div>}
          </div>
        )}

        {snap.mode === "playing" && biome.mine && !snap.mapOpen && <div className={`mine-vignette ${snap.flashlight ? "lit" : "dark"}`} />}
        {snap.mode === "playing" && biome.mine && !snap.mapOpen && <div className={`flashlight-status ${snap.flashlight ? "on" : "off"}`}><Flashlight size={18} /><span>{snap.flashlight ? "Фонарик включён" : "В темноте что-то движется"}</span><kbd>L</kbd></div>}
        {snap.mode === "playing" && snap.monsterScare && <div className="monster-scare"><div className="scare-face"><div className="scare-eyes"><i /><i /></div><div className="scare-nose" /><div className="scare-mouth">{Array.from({ length: 8 }, (_, i) => <i key={i} />)}</div></div><strong>ОНО ЗДЕСЬ</strong><span>L — СВЕТИ ПРЯМО НА НЕГО</span></div>}
        {snap.mode === "playing" && snap.toast && !snap.mapOpen && <div className={`toast ${snap.toast.tone}`}>{snap.toast.tone === "success" ? <Check size={18} /> : <Flag size={18} />}{snap.toast.text}</div>}
        {snap.mode === "playing" && <MapView snap={snap} />}
        {snap.mode === "playing" && snap.compassOpen && !snap.mapOpen && <div className="compass-widget"><div className="compass-ring"><span className="north">С</span><span className="east">В</span><span className="south">Ю</span><span className="west">З</span><div className="compass-needle" style={{ transform: `rotate(${-snap.bearing}deg)` }}><i /><b /></div><div className="compass-center" /></div><strong>{Math.round(snap.bearing)}° {direction(snap.bearing)}</strong><small>C — убрать компас</small></div>}

        {snap.mode === "paused" && (
          <div className="screen modal-screen pause-screen"><div className="pause-card"><span className="eyebrow">ДИСТАНЦИЯ НА ПАУЗЕ</span><h1>{formatTime(snap.elapsed + snap.penalty)}</h1><p>{biome.name} • пройдено {snap.currentControl} из {snap.totalControls} КП</p><button className="primary-button" onClick={() => gameActions.resume()}><Play size={18} /> Продолжить</button><button className="secondary-button" onClick={() => gameActions.restart()}><RotateCcw size={18} /> Начать заново</button><button className="secondary-button" onClick={() => gameActions.toggleMute()}>{snap.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}{snap.muted ? "Включить звук" : "Выключить звук"}</button><button className="text-button warning" onClick={() => gameActions.retire()}>Сойти с дистанции</button><button className="text-button" onClick={() => gameActions.quitToTitle()}>Выйти в меню</button></div></div>
        )}

        {snap.mode === "results" && (
          <div className="screen modal-screen"><div className="results-card"><div className={`result-emblem ${snap.finished ? "success" : "dnf"}`}>{snap.finished ? <Trophy size={34} /> : <Flag size={34} />}</div><span className="eyebrow">{biome.name} • {DIFFICULTY_INFO[snap.difficulty].label}</span><h1>{snap.finished ? "Дистанция пройдена!" : snap.finishReason.startsWith("ДТП") ? "Столкновение с автомобилем" : "Сход с дистанции"}</h1><p>{snap.finished ? snap.tester ? "Тестовая дистанция завершена. Рекорд и опыт не начислены." : "Все контрольные пункты отмечены в правильном порядке." : snap.finishReason || "Результат не сохранён. Попробуй ещё раз — маршрут уже знаком."}</p><div className="result-time"><span>ИТОГОВОЕ ВРЕМЯ</span><strong>{formatTime(snap.elapsed + snap.penalty, true)}</strong>{snap.penalty > 0 && <small>включая штраф {snap.penalty} сек</small>}</div>{snap.xpAwarded > 0 && <div className="xp-award"><Sparkles size={18} /> +{snap.xpAwarded} опыта спортсмена</div>}<div className="result-summary"><div><strong>{snap.currentControl}/{snap.totalControls}</strong><span>КП взято</span></div><div><strong>{best ? formatTime(best, true) : "—"}</strong><span>{snap.tester ? "тест без рекорда" : `рекорд уровня ${snap.runLevel}`}</span></div></div>{snap.splits.length > 0 && <div className="splits"><div className="split-row split-head"><span>Этап</span><span>КП</span><span>Время этапа</span><span>Общее</span></div>{snap.splits.map((split) => <div className="split-row" key={`${split.number}-${split.code}`}><span>{split.number}</span><strong>{split.code === 999 ? "Финиш" : split.code}</strong><span>{formatTime(split.legTime, true)}</span><span>{formatTime(split.totalTime, true)}</span></div>)}</div>}<div className="result-actions"><button className="primary-button" onClick={() => gameActions.restart()}><RotateCcw size={18} /> Ещё раз</button><button className="secondary-button" onClick={() => gameActions.quitToTitle()}>Выбрать карту</button></div></div></div>
        )}
      </div>
    </div>
  );
}
