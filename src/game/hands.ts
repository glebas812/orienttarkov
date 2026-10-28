import * as THREE from "three";
import type { OrienteeringMap } from "./map";
import type { Vec2 } from "./types";

/** First-person equipment. Kept separate from locomotion so the view can be replaced for Unity later. */
export class HandView {
  readonly group = new THREE.Group();
  private readonly mapGroup = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly needle = new THREE.Group();
  private readonly texture: THREE.CanvasTexture;
  private readonly paper: THREE.MeshBasicMaterial;
  private readonly canvas = document.createElement("canvas");
  private raisedAmount = 0;
  private mapRotation = 0;
  private punchTimer = 0;
  private textureTimer = 0;
  private offsetX = 0;
  private offsetY = 0;
  private mapZoom = 1;

  get zoom(): number { return this.mapZoom; }

  constructor(private mapRenderer: OrienteeringMap) {
    this.group.renderOrder = 1000;
    this.canvas.width = 1200;
    this.canvas.height = 800;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    this.paper = new THREE.MeshBasicMaterial({ map: this.texture, side: THREE.DoubleSide, toneMapped: false });
    const map = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.373), this.paper);
    map.position.z = 0.002;
    this.mapGroup.add(map);

    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(0.574, 0.386, 0.007),
      new THREE.MeshStandardMaterial({ color: 0xd8cfb4, roughness: 1 }),
    );
    rim.position.z = -0.003;
    this.mapGroup.add(rim);

    const compass = new THREE.Group();
    compass.position.set(0.145, 0.075, 0.014);
    const housing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.047, 0.047, 0.014, 32),
      new THREE.MeshStandardMaterial({ color: 0xe7e3d6, roughness: 0.4, metalness: 0.15 }),
    );
    housing.rotation.x = Math.PI / 2;
    compass.add(housing);
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(0.041, 32),
      new THREE.MeshBasicMaterial({ color: 0x263a34 }),
    );
    face.position.z = 0.008;
    compass.add(face);
    const north = this.makeNeedleHalf(0xef6838);
    const south = this.makeNeedleHalf(0xf0eee2);
    south.rotation.z = Math.PI;
    this.needle.add(north, south);
    this.needle.position.z = 0.011;
    compass.add(this.needle);
    const pin = new THREE.Mesh(new THREE.CircleGeometry(0.005, 12), new THREE.MeshBasicMaterial({ color: 0xe9e4d2 }));
    pin.position.z = 0.013;
    compass.add(pin);
    this.mapGroup.add(compass);
    this.group.add(this.mapGroup);

    this.rightArm = this.makeArm(true);
    this.rightArm.position.set(0.36, -0.48, -0.45);
    this.rightArm.rotation.set(-0.3, 0, 0.4);
    this.group.add(this.rightArm);

    this.mapGroup.position.set(0.19, -0.34, -0.57);
    this.mapGroup.rotation.set(-0.68, -0.08, -0.06);
    this.group.traverse((object) => {
      object.frustumCulled = false;
      object.renderOrder = 1000;
      if (object instanceof THREE.Mesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          material.depthTest = false;
          material.depthWrite = false;
          material.transparent = true;
          object.castShadow = false;
          object.receiveShadow = false;
        }
      }
    });
    // Depth testing is disabled for first-person equipment, so draw order is explicit.
    rim.renderOrder = 1000;
    map.renderOrder = 1001;
    compass.traverse((object) => { object.renderOrder = 1002; });
  }

  private makeNeedleHalf(color: number): THREE.Mesh {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.034);
    shape.lineTo(-0.008, 0);
    shape.lineTo(0.008, 0);
    shape.closePath();
    return new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  }

  private makeArm(chip: boolean): THREE.Group {
    const group = new THREE.Group();
    const sleeve = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.047, 0.25, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x344f46, roughness: 0.95 }),
    );
    sleeve.rotation.x = -0.65;
    group.add(sleeve);
    const hand = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.036, 0.07, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0xc89472, roughness: 0.9 }),
    );
    hand.position.set(0, 0.14, -0.105);
    hand.rotation.x = -0.8;
    group.add(hand);
    if (chip) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.035, 0.065), new THREE.MeshStandardMaterial({ color: 0x202a2b, roughness: 0.8 }));
      strap.position.set(0, 0.075, -0.045);
      group.add(strap);
      const chipMesh = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.026, 0.07), new THREE.MeshStandardMaterial({ color: 0xf0b537, emissive: 0x5a3b00, emissiveIntensity: 0.25 }));
      chipMesh.position.set(0, 0.098, -0.045);
      group.add(chipMesh);
    }
    return group;
  }

  punch(): void {
    this.punchTimer = 0.72;
  }

  update(
    dt: number,
    raised: boolean,
    wheel: number,
    bearing: number,
    player: Vec2,
    currentControl: number,
    adjusting: boolean,
    zooming: boolean,
    look: { yaw: number; pitch: number },
    paperBrightness = 1,
  ): void {
    this.paper.color.setScalar(paperBrightness);
    if (raised && zooming) this.mapZoom = THREE.MathUtils.clamp(this.mapZoom - wheel * 0.0012, 0.72, 1.28);
    else if (raised) this.mapRotation += wheel * 0.0022;
    if (raised && adjusting) {
      this.offsetX = THREE.MathUtils.clamp(this.offsetX - look.yaw * 0.72, -0.15, 0.15);
      this.offsetY = THREE.MathUtils.clamp(this.offsetY + look.pitch * 0.72, -0.11, 0.12);
    }
    const target = raised ? 1 : 0;
    this.raisedAmount += (target - this.raisedAmount) * Math.min(1, dt * 10);
    const a = this.raisedAmount;
    this.mapGroup.position.set(
      THREE.MathUtils.lerp(0.19, 0.12 + this.offsetX, a),
      THREE.MathUtils.lerp(-0.34, -0.075 + this.offsetY, a),
      THREE.MathUtils.lerp(-0.57, -0.48, a),
    );
    this.mapGroup.scale.setScalar(THREE.MathUtils.lerp(1, 1.02 * this.mapZoom, a));
    this.mapGroup.rotation.set(
      THREE.MathUtils.lerp(-0.68, -0.13, a),
      THREE.MathUtils.lerp(-0.08, 0, a),
      THREE.MathUtils.lerp(-0.06, 0, a) + this.mapRotation,
    );
    this.needle.rotation.z = bearing * Math.PI / 180;

    this.punchTimer = Math.max(0, this.punchTimer - dt);
    const punch = this.punchTimer > 0 ? Math.sin((1 - this.punchTimer / 0.72) * Math.PI) : 0;
    this.rightArm.position.set(0.36 - punch * 0.27, -0.48 + punch * 0.28, -0.45 - punch * 0.65);
    this.rightArm.rotation.set(-0.3 - punch * 0.5, 0, 0.4 - punch * 0.32);

    this.textureTimer -= dt;
    if (this.textureTimer <= 0) {
      this.textureTimer = 0.18;
      this.mapRenderer.render(this.canvas, player, bearing, currentControl);
      this.texture.needsUpdate = true;
    }
  }

  dispose(): void {
    this.texture.dispose();
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
  }
}
