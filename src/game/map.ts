import { GAME_CONFIG } from "./config";
import type { BiomeDef, Course, Vec2 } from "./types";
import type { World } from "./world";

const W = 1200, H = 800;
const MAP = { x: 28, y: 72, size: 688 };
const PURPLE = "#91366f";

export class OrienteeringMap {
  private readonly base: HTMLCanvasElement;
  private readonly heights: number[][] = [];

  constructor(private world: World, private biome: BiomeDef, private course: Course) {
    this.base = document.createElement("canvas");
    this.base.width = W; this.base.height = H;
    this.drawBase();
  }

  private xy(x: number, z: number): [number, number] {
    return [MAP.x + (x + GAME_CONFIG.WORLD_SIZE / 2) / GAME_CONFIG.WORLD_SIZE * MAP.size,
      MAP.y + (z + GAME_CONFIG.WORLD_SIZE / 2) / GAME_CONFIG.WORLD_SIZE * MAP.size];
  }

  private drawBase(): void {
    const ctx = this.base.getContext("2d")!;
    ctx.fillStyle = "#f4efdd"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#252d28"; ctx.font = "700 27px system-ui"; ctx.fillText(this.biome.name.toUpperCase(), 28, 38);
    ctx.fillStyle = "#6c7469"; ctx.font = "14px system-ui"; ctx.fillText(`${this.course.label}  •  масштаб 1:5 000  •  сечение рельефа 2 м`, 29, 59);
    ctx.fillStyle = this.biome.urban ? "#e8e6d6" : "#fffef4"; ctx.fillRect(MAP.x, MAP.y, MAP.size, MAP.size);
    ctx.save(); ctx.beginPath(); ctx.rect(MAP.x, MAP.y, MAP.size, MAP.size); ctx.clip();
    this.drawGrid(ctx);
    this.drawForestFloor(ctx);
    this.drawVegetation(ctx);
    this.drawContours(ctx);
    this.drawMarshes(ctx);
    this.drawWater(ctx);
    this.drawTrails(ctx);
    this.drawBuildings(ctx);
    this.drawFeatures(ctx);
    this.drawCourse(ctx);
    ctx.restore();
    ctx.strokeStyle = "#313c32"; ctx.lineWidth = 1.5; ctx.strokeRect(MAP.x, MAP.y, MAP.size, MAP.size);
    this.drawNorth(ctx);
    this.drawLegend(ctx);
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = "rgba(73,94,77,0.12)"; ctx.lineWidth = 1;
    for (let v = -150; v <= 150; v += 50) {
      const [x1, y1] = this.xy(v, -170), [x2, y2] = this.xy(v, 170);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      const [x3, y3] = this.xy(-170, v), [x4, y4] = this.xy(170, v);
      ctx.beginPath(); ctx.moveTo(x3, y3); ctx.lineTo(x4, y4); ctx.stroke();
    }
  }

  private drawForestFloor(ctx: CanvasRenderingContext2D): void {
    if (this.biome.mine) {
      ctx.fillStyle = "#d5d0bd";
      ctx.fillRect(MAP.x, MAP.y, MAP.size, MAP.size);
      return;
    }
    const step = 4;
    const size = step / GAME_CONFIG.WORLD_SIZE * MAP.size;
    for (let z = -170; z < 170; z += step) {
      for (let x = -170; x < 170; x += step) {
        const count = this.world.treeCountNear(x + step / 2, z + step / 2, 10);
        const [px, py] = this.xy(x, z);
        ctx.fillStyle = count >= 5 ? "#fffef4" : count > 0 ? "#f6e7a4" : "#f4d66f";
        ctx.fillRect(px - 0.2, py - 0.2, size + 0.4, size + 0.4);
      }
    }
    ctx.fillStyle = "#5e8d55";
    for (const tree of this.world.trees) {
      if (this.world.treeCountNear(tree.x, tree.z, 10) >= 5) continue;
      const [x, y] = this.xy(tree.x, tree.z);
      ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
    }
  }

  private drawVegetation(ctx: CanvasRenderingContext2D): void {
    const scale = MAP.size / GAME_CONFIG.WORLD_SIZE;
    const colors = {
      meadow: "#f4d66f", rough: "#f0cb68", slow: "#a7c890",
      walk: "#76aa78", fight: "#3f835c", fallen: "#c4b59b", thorn: "#8c9b62",
    } as const;
    for (const patch of this.world.vegetation.patches) {
      const [x, y] = this.xy(patch.x, patch.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(patch.rotation);
      ctx.beginPath();
      ctx.ellipse(0, 0, patch.rx * scale, patch.rz * scale, 0, 0, Math.PI * 2);
      ctx.fillStyle = colors[patch.kind];
      ctx.globalAlpha = patch.kind === "meadow" || patch.kind === "rough" ? 0.7 : 0.82;
      ctx.fill();
      ctx.clip();
      ctx.globalAlpha = 0.5;
      if (patch.kind === "walk" || patch.kind === "fight" || patch.kind === "slow" || patch.kind === "thorn") {
        ctx.strokeStyle = patch.kind === "fight" ? "#e2eee0" : patch.kind === "thorn" ? "#6b7043" : "#4d875b";
        ctx.lineWidth = 0.65;
        const spacing = patch.kind === "fight" ? 3 : 5;
        for (let yy = -patch.rz * scale; yy < patch.rz * scale; yy += spacing) {
          ctx.beginPath(); ctx.moveTo(-patch.rx * scale, yy); ctx.lineTo(patch.rx * scale, yy); ctx.stroke();
        }
      } else if (patch.kind === "fallen") {
        ctx.strokeStyle = "#81745f";
        ctx.lineWidth = 0.8;
        for (let yy = -patch.rz * scale; yy < patch.rz * scale; yy += 7) {
          for (let xx = -patch.rx * scale; xx < patch.rx * scale; xx += 11) {
            ctx.beginPath(); ctx.moveTo(xx - 2, yy + 2); ctx.lineTo(xx + 3, yy - 2); ctx.stroke();
          }
        }
      } else {
        ctx.fillStyle = "#b59c46";
        for (let yy = -patch.rz * scale; yy < patch.rz * scale; yy += 8) {
          for (let xx = -patch.rx * scale; xx < patch.rx * scale; xx += 9) {
            ctx.beginPath(); ctx.arc(xx + (yy % 3), yy, 0.65, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      ctx.restore();
    }
  }

  private drawContours(ctx: CanvasRenderingContext2D): void {
    const n = 72, min = -GAME_CONFIG.WORLD_SIZE / 2, step = GAME_CONFIG.WORLD_SIZE / n;
    let low = Infinity, high = -Infinity;
    for (let z = 0; z <= n; z++) {
      this.heights[z] = [];
      for (let x = 0; x <= n; x++) {
        const h = this.world.heightAt(min + x * step, min + z * step);
        this.heights[z][x] = h; low = Math.min(low, h); high = Math.max(high, h);
      }
    }
    const interval = this.biome.terrainAmplitude < 2 ? 0.5 : this.biome.terrainAmplitude < 5 ? 1 : 2;
    ctx.strokeStyle = "#b99b73"; ctx.lineWidth = 0.85;
    for (let level = Math.ceil(low / interval) * interval; level <= high; level += interval) {
      ctx.beginPath();
      for (let z = 0; z < n; z++) {
        for (let x = 0; x < n; x++) {
          const values = [this.heights[z][x], this.heights[z][x + 1], this.heights[z + 1][x + 1], this.heights[z + 1][x]];
          const points: Array<[number, number]> = [];
          for (let edge = 0; edge < 4; edge++) {
            const next = (edge + 1) % 4;
            if ((values[edge] < level) === (values[next] < level)) continue;
            const corners = [[x, z], [x + 1, z], [x + 1, z + 1], [x, z + 1]];
            const a = corners[edge], b = corners[next];
            const t = (level - values[edge]) / (values[next] - values[edge]);
            points.push(this.xy(min + (a[0] + (b[0] - a[0]) * t) * step, min + (a[1] + (b[1] - a[1]) * t) * step));
          }
          if (points.length >= 2) { ctx.moveTo(...points[0]); ctx.lineTo(...points[1]); }
          if (points.length === 4) { ctx.moveTo(...points[2]); ctx.lineTo(...points[3]); }
        }
      }
      ctx.stroke();
    }
  }

  private drawWater(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = "#65aabd"; ctx.lineWidth = 1.5;
    for (const stream of this.world.streams) {
      ctx.beginPath();
      stream.forEach((p, i) => { const [x, y] = this.xy(p.x, p.z); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.stroke();
    }
    for (const water of this.world.waters) {
      const [x, y] = this.xy(water.x, water.z), r = water.r / GAME_CONFIG.WORLD_SIZE * MAP.size;
      ctx.fillStyle = "#8dc5d1"; ctx.strokeStyle = "#4e9cad"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  private drawMarshes(ctx: CanvasRenderingContext2D): void {
    for (const marsh of this.world.marshes) {
      const [x, y] = this.xy(marsh.x, marsh.z), r = marsh.r / GAME_CONFIG.WORLD_SIZE * MAP.size;
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = "#c4dcd2"; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.strokeStyle = "#6ba6b2"; ctx.lineWidth = 1;
      for (let yy = y - r; yy < y + r; yy += 7) { ctx.beginPath(); ctx.moveTo(x - r, yy); ctx.lineTo(x + r, yy); ctx.stroke(); }
      ctx.restore();
    }
  }

  private drawTrails(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = this.biome.urban ? "#666a68" : "#3f392e";
    ctx.lineWidth = this.biome.urban ? 5 : 1.5;
    ctx.setLineDash(this.biome.urban ? [] : [6, 4]);
    for (const trail of this.world.trails) {
      ctx.beginPath();
      trail.forEach((p, i) => { const [x, y] = this.xy(p.x, p.z); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (this.biome.urban) {
      ctx.strokeStyle = "#8a806c"; ctx.lineWidth = 1.5;
      for (const path of this.world.cityPaths) {
        ctx.beginPath();
        path.forEach((p, i) => { const [x, y] = this.xy(p.x, p.z); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.stroke();
      }
    }
  }

  private drawBuildings(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#777872"; ctx.strokeStyle = "#555750"; ctx.lineWidth = 0.7;
    for (const b of this.world.buildings) {
      const [x, y] = this.xy(b.x, b.z), scale = MAP.size / GAME_CONFIG.WORLD_SIZE;
      ctx.save(); ctx.translate(x, y); ctx.rotate(b.rotation);
      ctx.fillRect(-b.w * scale / 2, -b.d * scale / 2, b.w * scale, b.d * scale);
      ctx.strokeRect(-b.w * scale / 2, -b.d * scale / 2, b.w * scale, b.d * scale);
      ctx.restore();
    }
  }

  private drawFeatures(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#4a4b45";
    for (const rock of this.world.rocks) {
      const [x, y] = this.xy(rock.x, rock.z);
      const size = Math.max(1.2, rock.s * 2.1);
      ctx.save(); ctx.translate(x, y); ctx.rotate(rock.x * 0.31);
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.restore();
    }
    for (const cp of this.course.controls) {
      const [x, y] = this.xy(cp.x, cp.z);
      if (cp.feature === "rock") {
        ctx.fillStyle = "#4a4b45"; ctx.fillRect(x - 3, y - 3, 6, 6);
      } else if (cp.feature === "tree" || cp.feature === "root") {
        ctx.fillStyle = "#5e8d55"; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
      } else if (cp.feature === "depression") {
        ctx.strokeStyle = "#9d7954"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI); ctx.stroke();
      }
    }
  }

  private drawCourse(ctx: CanvasRenderingContext2D): void {
    const points = [this.course.start, ...this.course.controls, this.course.finish];
    ctx.strokeStyle = PURPLE; ctx.lineWidth = 2; ctx.beginPath();
    points.forEach((p, i) => { const [x, y] = this.xy(p.x, p.z); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
    const [sx, sy] = this.xy(this.course.start.x, this.course.start.z);
    ctx.beginPath(); ctx.moveTo(sx, sy - 8); ctx.lineTo(sx + 7, sy + 5); ctx.lineTo(sx - 7, sy + 5); ctx.closePath(); ctx.stroke();
    this.course.controls.forEach((cp, i) => {
      const [x, y] = this.xy(cp.x, cp.z);
      ctx.fillStyle = "rgba(244,239,221,0.45)"; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = PURPLE; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = PURPLE; ctx.font = "bold 15px system-ui"; ctx.fillText(String(i + 1), x + 10, y - 7);
    });
    const [fx, fy] = this.xy(this.course.finish.x, this.course.finish.z);
    ctx.beginPath(); ctx.arc(fx, fy, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(fx, fy, 11, 0, Math.PI * 2); ctx.stroke();
  }

  private drawNorth(ctx: CanvasRenderingContext2D): void {
    const x = 684, y = 102;
    ctx.fillStyle = "#26352d"; ctx.font = "bold 17px system-ui"; ctx.fillText("С", x - 6, y - 20);
    ctx.beginPath(); ctx.moveTo(x, y - 12); ctx.lineTo(x + 7, y + 10); ctx.lineTo(x, y + 6); ctx.lineTo(x - 7, y + 10); ctx.closePath(); ctx.fill();
  }

  private drawLegend(ctx: CanvasRenderingContext2D): void {
    const x = 750;
    ctx.fillStyle = "#303a32"; ctx.font = "700 18px system-ui"; ctx.fillText("ЛЕГЕНДА КП", x, 94);
    ctx.fillStyle = "#73776b"; ctx.font = "13px system-ui"; ctx.fillText(`${this.course.controls.length} КП  •  ${this.course.nominalLength} м по прямой`, x, 118);
    let y = 151;
    this.course.controls.forEach((cp, i) => {
      ctx.fillStyle = PURPLE; ctx.font = "700 15px system-ui"; ctx.fillText(`${i + 1}`, x, y);
      ctx.fillStyle = "#303a32"; ctx.font = "700 15px system-ui"; ctx.fillText(`${cp.code}`, x + 28, y);
      ctx.font = "14px system-ui"; ctx.fillText(cp.description, x + 70, y);
      y += 34;
    });
    y += 12;
    ctx.fillStyle = "#303a32"; ctx.font = "700 16px system-ui"; ctx.fillText("УСЛОВНЫЕ ЗНАКИ", x, y); y += 29;
    const items = [
      ["#91366f", "Фиолетовый — старт, КП и финиш"],
      ["#b99b73", "Коричневый — горизонтали рельефа"],
      ["#8dc5d1", "Голубой — вода и болота"],
      ["#3f835c", "Зелёный — ели и медленная зелёнка"],
      ["#f4d66f", "Жёлтый — поляна и открытая земля"],
      ["#5e8d55", "Зелёная точка — отдельное дерево"],
      ["#3f392e", "Пунктир — узкая тропа"],
    ];
    for (const [color, text] of items) {
      ctx.fillStyle = color; ctx.fillRect(x, y - 10, 20, 4);
      ctx.fillStyle = "#545b51"; ctx.font = "13px system-ui"; ctx.fillText(text, x + 30, y - 4); y += 28;
    }
    y += 14;
    ctx.fillStyle = "#73776b"; ctx.font = "12px system-ui";
    this.wrap(ctx, "Ваше положение не отображается ни на одной сложности. Белый лес — пять и более деревьев в радиусе 10 м; редкие деревья отмечены точками.", x, y, 390, 18);
    ctx.fillStyle = "#8a8b7e"; ctx.font = "11px system-ui"; ctx.fillText("Масштаб и цвета стилизованы под спортивную карту.", 28, 782);
  }

  private wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
    const words = text.split(" "); let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) { ctx.fillText(line, x, y); y += lineHeight; line = word; }
      else line = test;
    }
    if (line) ctx.fillText(line, x, y);
  }

  render(target: HTMLCanvasElement, _player: Vec2, _bearing: number, currentControl: number): void {
    target.width = W; target.height = H;
    const ctx = target.getContext("2d")!;
    ctx.drawImage(this.base, 0, 0);
    if (this.course.difficulty === "M12" && currentControl < this.course.controls.length) {
      const cp = this.course.controls[currentControl], [cx, cy] = this.xy(cp.x, cp.z);
      ctx.strokeStyle = "rgba(230,99,34,0.82)"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.stroke();
    }
  }
}
