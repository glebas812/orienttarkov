import * as THREE from "three";
import type { Vec2 } from "./types";

interface Car {
  group: THREE.Group;
  axis: "x" | "z";
  lane: number;
  direction: number;
  cruise: number;
  speed: number;
  value: number;
}
interface Signal {
  axis: "x" | "z";
  red: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  yellow: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  green: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
}

export class TrafficSystem {
  private readonly cars: Car[] = [];
  private readonly signals: Signal[] = [];
  private jamTimer = 0;
  private elapsed = 0;

  constructor(private group: THREE.Group, private heightAt: (x: number, z: number) => number) {
    const colors = [0xc64f3c, 0x47718a, 0xe0b64f, 0xeeeeea, 0x4c6057, 0x8b5b91, 0xcf773d, 0x335d78, 0xa8aaa4, 0x7d493d, 0x54835e, 0xd08345];
    for (let i = 0; i < 12; i++) {
      const axis = i % 2 ? "x" : "z";
      const car = this.makeCar(colors[i]);
      const data: Car = {
        group: car, axis, lane: [-90, 0, 90][i % 3], direction: i % 3 === 0 ? -1 : 1,
        cruise: 7.5 + (i % 5) * 0.65, speed: 4 + (i % 4), value: -150 + i * 27,
      };
      this.cars.push(data); group.add(car);
    }
    this.buildSignals();
    this.update(0);
  }

  private makeCar(color: number): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.65, 3.8), new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15 }));
    body.position.y = 0.65; group.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.62, 1.9), new THREE.MeshStandardMaterial({ color: 0x79959d, roughness: 0.25, metalness: 0.2 }));
    cabin.position.set(0, 1.2, -0.2); group.add(cabin);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x252827, roughness: 1 });
    for (const x of [-0.9, 0.9]) for (const z of [-1.15, 1.15]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.18, 10), wheelMaterial);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(x, 0.35, z); group.add(wheel);
    }
    const brakeMaterial = new THREE.MeshBasicMaterial({ color: 0x8f1710 });
    for (const x of [-0.58, 0.58]) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.05), brakeMaterial);
      light.position.set(x, 0.72, 1.93); group.add(light);
    }
    return group;
  }

  private buildSignals(): void {
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x333c3b, roughness: 0.7 });
    for (const x of [-90, 0, 90]) for (const z of [-90, 0, 90]) {
      for (const axis of ["x", "z"] as const) {
        const px = x + (axis === "x" ? 4.4 : -4.4), pz = z + (axis === "x" ? 4.4 : -4.4), y = this.heightAt(px, pz);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 3.4, 7), poleMaterial);
        pole.position.set(px, y + 1.7, pz); this.group.add(pole);
        const housing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.12, 0.35), new THREE.MeshStandardMaterial({ color: 0x202726, roughness: 0.8 }));
        housing.position.set(px, y + 3.25, pz); this.group.add(housing);
        const makeBulb = (color: number, yy: number) => {
          const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), new THREE.MeshBasicMaterial({ color }));
          bulb.position.set(px, y + yy, pz - 0.18); this.group.add(bulb); return bulb;
        };
        this.signals.push({ axis, red: makeBulb(0x4a1712, 3.57), yellow: makeBulb(0x4d4114, 3.25), green: makeBulb(0x123d22, 2.93) });
      }
    }
  }

  private phase(axis: "x" | "z"): "green" | "yellow" | "red" {
    const t = this.elapsed % 18;
    const active = axis === "x" ? t < 8 : t >= 9 && t < 17;
    if (active) return (axis === "x" ? t > 6.5 : t > 15.5) ? "yellow" : "green";
    return "red";
  }

  private setSignal(signal: Signal): void {
    const phase = this.phase(signal.axis);
    signal.red.material.color.setHex(phase === "red" ? 0xff3a24 : 0x4a1712);
    signal.yellow.material.color.setHex(phase === "yellow" ? 0xffc52e : 0x4d4114);
    signal.green.material.color.setHex(phase === "green" ? 0x42ef78 : 0x123d22);
  }

  private redLightTarget(car: Car): number {
    if (this.phase(car.axis) === "green") return car.cruise;
    let nearest = Infinity;
    for (const cross of [-90, 0, 90]) {
      const distance = (cross - car.value) * car.direction;
      if (distance > 2.8 && distance < nearest) nearest = distance;
    }
    if (nearest > 19) return car.cruise;
    return Math.max(0, Math.min(car.cruise, (nearest - 5.2) * 0.75));
  }

  private playerTarget(car: Car, player?: Vec2): number {
    if (!player) return car.cruise;
    const playerLongitudinal = car.axis === "x" ? player.x : player.z;
    const playerLateral = car.axis === "x" ? player.z : player.x;
    const carLateral = car.axis === "x" ? car.lane - car.direction * 1.4 : car.lane + car.direction * 1.4;
    const ahead = (playerLongitudinal - car.value) * car.direction;
    const lateral = Math.abs(playerLateral - carLateral);
    if (ahead < -1 || ahead > 25 || lateral > 3.4) return car.cruise;
    if (ahead < 7) return 0;
    return Math.max(0, Math.min(car.cruise, (ahead - 5) * 0.58));
  }

  update(dt: number, player?: Vec2): void {
    this.elapsed += dt;
    this.jamTimer = Math.max(0, this.jamTimer - dt);
    const trafficFactor = this.jamTimer > 0 ? 0.22 : 1;
    for (const signal of this.signals) this.setSignal(signal);
    for (const car of this.cars) {
      const target = Math.min(this.redLightTarget(car), this.playerTarget(car, player)) * trafficFactor;
      const response = target < car.speed ? 5.2 : 1.5;
      car.speed += (target - car.speed) * Math.min(1, dt * response);
      if (target === 0 && car.speed < 0.08) car.speed = 0;
      car.value += car.speed * car.direction * dt;
      if (car.value > 170) car.value = -170;
      if (car.value < -170) car.value = 170;
      const x = car.axis === "x" ? car.value : car.lane + car.direction * 1.4;
      const z = car.axis === "z" ? car.value : car.lane - car.direction * 1.4;
      car.group.position.set(x, this.heightAt(x, z) + 0.12, z);
      car.group.rotation.y = car.axis === "x" ? (car.direction > 0 ? Math.PI / 2 : -Math.PI / 2) : (car.direction > 0 ? 0 : Math.PI);
    }
  }

  collision(player: Vec2): boolean {
    for (const car of this.cars) {
      const dx = Math.abs(car.group.position.x - player.x), dz = Math.abs(car.group.position.z - player.z);
      if (car.axis === "x" ? dx < 2.2 && dz < 1.3 : dx < 1.3 && dz < 2.2) return true;
    }
    return false;
  }

  firstCarPosition(): Vec2 {
    const car = this.cars[0].group.position;
    return { x: car.x, z: car.z };
  }

  jam(seconds: number): void {
    this.jamTimer = Math.max(this.jamTimer, seconds);
  }
}
