import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const root = resolve(new URL("../", import.meta.url).pathname);
const dist = join(root, "dist");
const shots = join(root, "verification-shots");
await mkdir(shots, { recursive: true });
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const server = createServer(async (req, res) => {
  try {
    const path = req.url?.split("?")[0] === "/" ? "/index.html" : req.url?.split("?")[0] ?? "/index.html";
    const data = await readFile(join(dist, decodeURIComponent(path)));
    res.writeHead(200, { "content-type": mime[extname(path)] ?? "application/octet-stream" }); res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", args: ["--no-sandbox", "--disable-gpu-sandbox", "--use-gl=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("pageerror", (error) => errors.push(String(error)));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const snap = () => page.evaluate(() => window.__gameTest.snapshot());
const start = (biome, difficulty = "M12") => page.evaluate(({ biome, difficulty }) => window.__gameTest.start(biome, difficulty), { biome, difficulty });
const finishCourse = async () => {
  for (let i = 0; i < 14; i++) {
    const current = await snap();
    if (current.mode === "results") break;
    await page.evaluate(() => { window.__gameTest.teleportNext(); window.__gameTest.interact(); });
    await page.waitForTimeout(45);
  }
  await page.waitForTimeout(1100);
  assert((await snap()).mode === "results", "course did not reach results or restarted unexpectedly");
};
try {
  await page.goto(`http://127.0.0.1:${port}/?test=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__GAME_READY__ === true);
  await page.screenshot({ path: join(shots, "04-expansion-title.png") });

  await start("ladoga", "M12");
  await page.waitForTimeout(250);
  await page.keyboard.down("KeyW"); await page.waitForTimeout(650);
  const walking = (await snap()).speed;
  await page.keyboard.down("ShiftLeft"); await page.waitForTimeout(650);
  const running = (await snap()).speed;
  await page.keyboard.up("ShiftLeft"); await page.keyboard.up("KeyW");
  assert(running > walking * 1.35, `Shift sprint not effective: walk=${walking}, run=${running}`);

  await page.locator("#game-canvas").dispatchEvent("pointerdown", { button: 0 });
  await page.waitForTimeout(300);
  assert((await snap()).mapRaised, "LMB did not raise hand map");
  await page.keyboard.down("KeyW"); await page.keyboard.down("ShiftLeft"); await page.waitForTimeout(550);
  const mapSpeed = (await snap()).speed;
  await page.keyboard.up("KeyW"); await page.keyboard.up("ShiftLeft");
  assert(mapSpeed < running * 0.8, `raised map did not block sprint: ${mapSpeed} vs ${running}`);
  await page.locator("#game-canvas").dispatchEvent("wheel", { deltaY: 180 });
  await page.keyboard.down("KeyF");
  await page.mouse.move(760, 410); await page.mouse.move(830, 360, { steps: 4 });
  await page.waitForTimeout(250);
  assert((await snap()).mapAdjust, "F did not enter hand-map adjustment mode");
  await page.keyboard.up("KeyF");
  await page.screenshot({ path: join(shots, "05-raised-map.png") });
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { button: 0 })));

  const water = await page.evaluate(() => window.__gameTest.waterPosition());
  assert(water, "lowland water body missing");
  await page.evaluate(({ x, z }) => window.__gameTest.teleport(x, z), water);
  await page.waitForTimeout(300);
  assert((await snap()).wet && (await snap()).surface === "Вода", "water did not apply wet state");
  await page.evaluate(() => window.__gameTest.teleport(0, 0));
  await page.waitForTimeout(250);
  assert((await snap()).wet, "wet state did not persist after leaving water");

  await finishCourse();
  const normalResult = await snap();
  assert(normalResult.finished && normalResult.xpAwarded > 0, "normal finish did not award XP");
  assert(normalResult.bestTimes["ladoga:M12:L1"] > 0, "level-one record missing");
  await page.screenshot({ path: join(shots, "06-results.png") });

  // A second finish crosses level two and exposes skill points.
  await page.getByRole("button", { name: "Ещё раз" }).click();
  await finishCourse();
  await page.getByRole("button", { name: "Выбрать карту" }).click();
  const progressed = await snap();
  assert(progressed.level >= 2 && progressed.skillPoints >= 3, "level progression or skill points missing");
  await page.locator(".upgrade-list button").first().click();
  assert((await snap()).upgrades.speed === 1, "speed upgrade was not purchased");

  // Tester form: Polar branch, no record and no XP on a full finish.
  await page.getByRole("button", { name: /Тестер/ }).click();
  await page.getByRole("button", { name: /POLAR/ }).click();
  await page.getByLabel("Running Index").fill("52");
  await page.getByLabel("Пульс покоя").fill("48");
  await page.getByRole("button", { name: /Применить и выбрать старт/ }).click();
  assert((await snap()).tester && (await snap()).mode === "briefing", "tester did not enter briefing");
  const levelBeforeTest = (await snap()).level;
  const xpBeforeTest = (await snap()).xp;
  await page.getByRole("button", { name: /На старт/ }).click();
  await finishCourse();
  const tested = await snap();
  assert(tested.tester && tested.xpAwarded === 0, "tester awarded XP");
  assert(tested.level === levelBeforeTest && tested.xp === xpBeforeTest, "tester changed profile progression");
  await page.getByRole("button", { name: "Выбрать карту" }).click();
  await page.getByRole("button", { name: "Вернуть обычный режим" }).click();

  let cityMetrics = null;
  for (const [biome, difficulty] of [["north-ural", "ME"], ["south-ural", "M16"], ["bog", "ME"], ["mixed", "M16"], ["recreation", "M12"], ["slyudorudnik", "ME"], ["city", "M16"], ["mine", "ME"], ["tutorial", "M12"]]) {
    await start(biome, difficulty);
    await page.waitForTimeout(450);
    const state = await snap();
    assert(state.mode === "playing" && state.biomeId === biome, `failed to start ${biome}: ${JSON.stringify({ mode: state.mode, biome: state.biomeId, difficulty: state.difficulty })}`);
    if (biome === "north-ural") await page.screenshot({ path: join(shots, "07-north-elite.png") });
    if (biome === "recreation") await page.screenshot({ path: join(shots, "08-recreation.png") });
    if (biome === "slyudorudnik") {
      const treeTotal = await page.evaluate(() => [[0,0],[30,20],[-40,30],[60,-30],[-80,-40]].reduce((sum, [x,z]) => sum + window.__gameTest.treeCount(x,z), 0));
      assert(treeTotal > 15, "mountain taiga does not contain a dense mature forest");
      await page.screenshot({ path: join(shots, "10-slyudorudnik.png") });
    }
    if (biome === "city") {
      await page.evaluate(() => window.__gameTest.teleport(0, 18));
      await page.waitForTimeout(1100);
      await page.screenshot({ path: join(shots, "09-city.png") });
      const city = await snap();
      cityMetrics = { fps: city.fps, drawCalls: city.drawCalls };
      const car = await page.evaluate(() => window.__gameTest.carPosition());
      assert(car, "city traffic missing");
      const madeContact = await page.evaluate(async () => {
        for (let frame = 0; frame < 90; frame++) {
          const position = window.__gameTest.carPosition();
          if (Math.abs(position.x) < 160 && Math.abs(position.z) < 160) {
            window.__gameTest.teleport(position.x, position.z);
          }
          await new Promise(requestAnimationFrame);
          if (window.__gameTest.snapshot().mode === "results") return true;
        }
        return false;
      });
      const collision = await snap();
      assert(madeContact, "car contact did not end the run");
      assert(collision.mode === "results" && !collision.finished && collision.finishReason.startsWith("ДТП"), "car contact did not end the run with a traffic result");
      await page.screenshot({ path: join(shots, "11-traffic-result.png") });
    }
    if (biome === "mine") {
      await page.screenshot({ path: join(shots, "12-mine-dark.png") });
      await page.keyboard.press("KeyL"); await page.waitForTimeout(250);
      assert((await snap()).flashlight, "L did not enable the flashlight");
      await page.screenshot({ path: join(shots, "13-mine-flashlight.png") });
      await page.keyboard.press("KeyL");
      await page.waitForFunction(() => window.__gameTest.snapshot().monsterScare, undefined, { timeout: 22000 });
      assert((await snap()).monsterScare, "darkness did not trigger the mine monster event");
      await page.screenshot({ path: join(shots, "14-mine-scare.png") });
    }
  }
  assert(errors.length === 0, `console errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ ok: true, walking, running, mapSpeed, level: progressed.level, testedNoXp: tested.xpAwarded === 0, cityMetrics, consoleErrors: errors.length }, null, 2));
} catch (error) {
  console.error(error);
  console.error("console errors", errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
