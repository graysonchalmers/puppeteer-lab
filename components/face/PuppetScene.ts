/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Face Puppet's Three.js scene: crease-shaded face (Low/Full), studio
 * light rig, self-lit eyeballs with a fixed glint, self-lit mouth parts and
 * brows, capsule hands drawn in a second pass so they always sit in front.
 * All geometry maths is in the pure modules; this file only moves meshes.
 */
import * as THREE from 'three';
import { Landmark } from '../shared/trackerTypes';
import { Projection, toScene, V3 } from './projection';
import { MeshDetail, FACE_MESHES, createFaceBuffers, updateFaceBuffers, FaceBuffers } from './faceGeometry';
import { buildCreaseGroups, CreaseGroups } from './creaseGroups';
import { eyePose } from './eyes';
import { handRig, HAND_SEGMENTS } from './handRig';
import {
  CANONICAL_VERTS, LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR, LIPS_INNER, LIPS_INNER_UPPER, LIPS_INNER_LOWER,
  LEFT_EYEBROW, RIGHT_EYEBROW,
} from './faceTopology';

const BG = 0x090a0c;
const SKIN_HAND = 0xa3a7ad; // close to the face's SKIN_GRAY after lighting
const CAVITY = 0x0b0c0e;
const TOOTH = 0xe6e4dc;
const TOOTH_SEAM = 0x8e8c85;
const LIP_CLOSED = 0x3a3d44;
const LIP_SEAM = 0x15171b;
const BROW = 0x16181c;
const TOOTH_BAND = 0.08;
const TOOTH_BAND_MAX_HALF_GAP = 0.6;
const MAX_JOINTS = 42; // 2 hands x 21

export interface SceneInput {
  face: Landmark[] | null;       // boosted (brows, jaw, blink)
  eyeSource: Landmark[] | null;  // boosted brows/jaw but NOT blink: eyeballs must not move when lids close
  hands: Landmark[][];
  mouthOpen: boolean;
  teethGap: number;
  creaseAngle: number;
  meshDetail: MeshDetail;
}

function addLights(scene: THREE.Scene) {
  // Tuned on the synthetic take: low ambient + a side-ish key so the form reads.
  scene.add(new THREE.AmbientLight(0xffffff, 0.15));
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(-0.8, 0.6, 0.7);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.position.set(0.8, -0.2, 0.8);
  const rim = new THREE.DirectionalLight(0xffffff, 2.5);
  rim.position.set(0.3, 0.8, -1);
  scene.add(key, fill, rim);
}

function eyeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128; // equirect: three's SphereGeometry puts +Z (front) at u = 0.25
  const g = c.getContext('2d')!;
  g.fillStyle = '#F3F4F6'; g.fillRect(0, 0, 256, 128);
  const fx = 64, fy = 64;
  g.beginPath(); g.arc(fx, fy, 22, 0, Math.PI * 2); g.fillStyle = '#60A5FA'; g.fill();
  g.beginPath(); g.arc(fx, fy, 19, 0, Math.PI * 2); g.fillStyle = '#111827'; g.fill();
  g.beginPath(); g.arc(fx, fy, 9, 0, Math.PI * 2); g.fillStyle = '#000000'; g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A dynamic mesh whose position buffer we rewrite in place each frame. */
function dynamicMesh(maxVerts: number, material: THREE.Material): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3));
  g.setDrawRange(0, 0);
  const m = new THREE.Mesh(g, material);
  m.frustumCulled = false;
  return m;
}

function writeTris(mesh: THREE.Mesh, tris: V3[]) {
  const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const a = attr.array as Float32Array;
  const n = Math.min(tris.length, a.length / 3);
  for (let i = 0; i < n; i++) { a[i * 3] = tris[i][0]; a[i * 3 + 1] = tris[i][1]; a[i * 3 + 2] = tris[i][2]; }
  attr.needsUpdate = true;
  mesh.geometry.setDrawRange(0, n);
}

/** Triangle fan of a closed ring around its centroid, pushed by dz. */
function fan(ring: V3[], dz: number): V3[] {
  const c: V3 = [0, 1, 2].map((d) => ring.reduce((s, q) => s + q[d], 0) / ring.length) as V3;
  const out: V3[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    out.push([c[0], c[1], c[2] + dz], [a[0], a[1], a[2] + dz], [b[0], b[1], b[2] + dz]);
  }
  return out;
}

/** Quad strip between two equal-length polylines. */
function strip(top: V3[], bottom: V3[]): V3[] {
  const out: V3[] = [];
  for (let i = 0; i + 1 < top.length; i++) {
    out.push(top[i], bottom[i], top[i + 1], top[i + 1], bottom[i], bottom[i + 1]);
  }
  return out;
}

/** Ribbon of half-width hw along a polyline (screen plane), pushed by dz. */
function ribbon(pts: V3[], hw: number, dz: number): V3[] {
  const top: V3[] = [], bottom: V3[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1;
    const nx = -dy / m * hw, ny = dx / m * hw;
    top.push([pts[i][0] + nx, pts[i][1] + ny, pts[i][2] + dz]);
    bottom.push([pts[i][0] - nx, pts[i][1] - ny, pts[i][2] + dz]);
  }
  return strip(top, bottom);
}

export class PuppetScene {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.OrthographicCamera;
  private faceScene = new THREE.Scene();
  private handScene = new THREE.Scene();
  private skinMat = new THREE.MeshStandardMaterial({ color: 0xffffff, // vertex colors carry the gray
    roughness: 0.75, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
  private faceMesh!: THREE.Mesh;
  private faceBuf!: FaceBuffers;
  private detail: MeshDetail | null = null;
  private crease = { detail: null as MeshDetail | null, angle: -1, groups: null as CreaseGroups | null };
  private eyes: THREE.Mesh[] = [];
  private glints: THREE.Mesh[] = [];
  private cavity = dynamicMesh(64 * 3, new THREE.MeshBasicMaterial({ color: CAVITY, side: THREE.DoubleSide }));
  private teeth = dynamicMesh(64 * 3, new THREE.MeshBasicMaterial({ color: TOOTH, side: THREE.DoubleSide }));
  private toothSeam = dynamicMesh(64 * 3, new THREE.MeshBasicMaterial({ color: TOOTH_SEAM, side: THREE.DoubleSide }));
  private closedLip = dynamicMesh(64 * 3, new THREE.MeshBasicMaterial({ color: LIP_CLOSED, side: THREE.DoubleSide }));
  private lipSeam = dynamicMesh(64 * 3, new THREE.MeshBasicMaterial({ color: LIP_SEAM, side: THREE.DoubleSide }));
  private brows = dynamicMesh(64 * 3, new THREE.MeshBasicMaterial({ color: BROW, side: THREE.DoubleSide }));
  private bones: THREE.InstancedMesh;
  private jointBalls: THREE.InstancedMesh;
  private palms: THREE.Mesh[] = [];
  private tmp = new THREE.Object3D();

  constructor(w: number, h: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = false;
    this.canvas = this.renderer.domElement;
    this.camera = new THREE.OrthographicCamera(0, w, 0, -h, -10000, 10000);
    this.setSize(w, h);
    addLights(this.faceScene);
    addLights(this.handScene);

    const tex = eyeTexture();
    for (let i = 0; i < 2; i++) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ map: tex }));
      const glint = new THREE.Mesh(new THREE.CircleGeometry(1, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      this.eyes.push(eye); this.glints.push(glint);
      this.faceScene.add(eye, glint);
    }
    this.faceScene.add(this.cavity, this.teeth, this.toothSeam, this.closedLip, this.lipSeam, this.brows);

    const handMat = new THREE.MeshStandardMaterial({ color: SKIN_HAND, roughness: 0.75, metalness: 0 });
    this.bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), handMat, HAND_SEGMENTS.length * 2);
    this.jointBalls = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), handMat, MAX_JOINTS);
    this.bones.frustumCulled = false;
    this.jointBalls.frustumCulled = false;
    this.handScene.add(this.bones, this.jointBalls);
    for (let i = 0; i < 2; i++) {
      const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), handMat);
      this.palms.push(palm);
      this.handScene.add(palm);
    }
  }

  setSize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.right = w;
    this.camera.bottom = -h;
    this.camera.updateProjectionMatrix();
  }

  private ensureFace(detail: MeshDetail, angle: number) {
    if (this.detail !== detail) {
      if (this.faceMesh) { this.faceScene.remove(this.faceMesh); this.faceMesh.geometry.dispose(); }
      this.faceBuf = createFaceBuffers(detail);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.faceBuf.positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(this.faceBuf.normals, 3));
      g.setAttribute('color', new THREE.BufferAttribute(this.faceBuf.colors, 3));
      this.faceMesh = new THREE.Mesh(g, this.skinMat);
      this.faceMesh.frustumCulled = false;
      this.faceScene.add(this.faceMesh);
      this.detail = detail;
    }
    if (this.crease.detail !== detail || this.crease.angle !== angle) {
      this.crease = { detail, angle, groups: buildCreaseGroups(FACE_MESHES[detail].tris, CANONICAL_VERTS, angle) };
    }
  }

  render(input: SceneInput, p: Projection) {
    const face = input.face && input.face.length >= 468 ? input.face : null;
    this.faceMesh && (this.faceMesh.visible = !!face);
    for (const o of [...this.eyes, ...this.glints, this.cavity, this.teeth, this.toothSeam, this.closedLip, this.lipSeam, this.brows]) o.visible = !!face;

    if (face) {
      this.ensureFace(input.meshDetail, input.creaseAngle);
      updateFaceBuffers(this.faceBuf, input.meshDetail, face, p, this.crease.groups!);
      const g = this.faceMesh.geometry;
      g.getAttribute('position').needsUpdate = true;
      g.getAttribute('normal').needsUpdate = true;
      this.updateEyes(input.eyeSource ?? face, p);
      this.updateMouth(face, p, input.mouthOpen, input.teethGap);
      this.updateBrows(face, p);
    }
    this.updateHands(input.hands, p);

    this.renderer.setClearColor(BG, 1);
    this.renderer.clear();
    this.renderer.render(this.faceScene, this.camera);
    this.renderer.clearDepth(); // hands always in front of the face
    this.renderer.render(this.handScene, this.camera);
  }

  private updateEyes(lm: Landmark[], p: Projection) {
    // MediaPipe iris centers: 468 sits in the 33..133 eye, 473 in the 263..362 eye.
    [[LEFT_EYE_CONTOUR, 468], [RIGHT_EYE_CONTOUR, 473]].forEach(([contour, iris], i) => {
      const e = eyePose(lm, contour as readonly number[], iris as number, p);
      const eye = this.eyes[i];
      eye.position.set(e.center[0], e.center[1], e.center[2]);
      eye.scale.setScalar(e.radius);
      eye.rotation.set(e.rx, e.ry, 0, 'YXZ');
      const glint = this.glints[i];
      glint.position.set(e.center[0] - e.radius * 0.3, e.center[1] + e.radius * 0.3, e.center[2] + e.radius * 1.01);
      glint.scale.setScalar(Math.max(1.5, e.radius * 0.12));
    });
  }

  private updateMouth(lm: Landmark[], p: Projection, open: boolean, gap: number) {
    const S = (i: number) => toScene(lm[i], p);
    const ring = LIPS_INNER.slice(0, -1).map(S); // LIPS_INNER repeats its first index at the end
    const mouthW = Math.hypot(S(308)[0] - S(78)[0], S(308)[1] - S(78)[1]);
    const lipZ = ring.reduce((s, q) => s + q[2], 0) / ring.length;
    const mid = LIPS_INNER_UPPER.map((u, k) => {
      const a = S(u), b = S(LIPS_INNER_LOWER[k]);
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] as V3;
    });
    const seamLine = [S(78), ...mid, S(308)];
    this.cavity.visible = this.teeth.visible = open;
    this.toothSeam.visible = open && gap < 0.1;
    this.closedLip.visible = this.lipSeam.visible = !open;
    if (!open) {
      writeTris(this.closedLip, fan(ring, 0.5));
      writeTris(this.lipSeam, ribbon(seamLine, 1, 1));
      return;
    }
    writeTris(this.cavity, fan(ring.map((q) => [q[0], q[1], lipZ] as V3), -mouthW * 0.3));
    const half = Math.hypot(S(13)[0] - S(14)[0], S(13)[1] - S(14)[1]) / 2;
    const row = half * (1 - gap) + Math.min(mouthW * TOOTH_BAND, half * TOOTH_BAND_MAX_HALF_GAP) * gap;
    const toothZ = -mouthW * 0.1;
    const upper = [78, ...LIPS_INNER_UPPER, 308].map(S).map((q) => [q[0], q[1], lipZ + toothZ] as V3);
    const lower = [78, ...LIPS_INNER_LOWER, 308].map(S).map((q) => [q[0], q[1], lipZ + toothZ] as V3);
    writeTris(this.teeth, [
      ...strip(upper, upper.map((q) => [q[0], q[1] - row, q[2]] as V3)),
      ...strip(lower, lower.map((q) => [q[0], q[1] + row, q[2]] as V3)),
    ]);
    if (gap < 0.1) writeTris(this.toothSeam, ribbon(seamLine.map((q) => [q[0], q[1], lipZ + toothZ] as V3), 0.75, 0.5));
  }

  private updateBrows(lm: Landmark[], p: Projection) {
    const S = (i: number) => toScene(lm[i], p);
    const tris: V3[] = [];
    for (const brow of [LEFT_EYEBROW, RIGHT_EYEBROW]) {
      const up = brow.slice(0, 5).map(S), low = brow.slice(5).reverse().map(S);
      const w = Math.hypot(up[4][0] - up[0][0], up[4][1] - up[0][1]);
      const lift = (q: V3): V3 => [q[0], q[1], q[2] + w * 0.08];
      tris.push(...strip(up.map(lift), low.map(lift)));
    }
    writeTris(this.brows, tris);
  }

  private updateHands(hands: Landmark[][], p: Projection) {
    let b = 0, j = 0;
    const m = this.tmp;
    this.palms.forEach((pm) => (pm.visible = false));
    hands.filter((h) => h && h.length >= 21).slice(0, 2).forEach((hand, hi) => {
      const rig = handRig(hand, p);
      for (const s of rig.segments) {
        const dir = new THREE.Vector3(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]);
        const len = dir.length() || 1e-3;
        m.position.set((s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, (s.a[2] + s.b[2]) / 2);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        m.scale.set(s.radius, len, s.radius);
        m.updateMatrix();
        this.bones.setMatrixAt(b++, m.matrix);
      }
      for (const jt of rig.joints) {
        m.position.set(jt.p[0], jt.p[1], jt.p[2]);
        m.quaternion.identity();
        m.scale.setScalar(jt.radius);
        m.updateMatrix();
        this.jointBalls.setMatrixAt(j++, m.matrix);
      }
      const pad = rig.palm, palm = this.palms[hi];
      const basis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...pad.v).multiplyScalar(pad.sv),
        new THREE.Vector3(...pad.u).multiplyScalar(pad.su),
        new THREE.Vector3(...pad.n).multiplyScalar(pad.sn),
      );
      basis.setPosition(pad.center[0], pad.center[1], pad.center[2]);
      palm.matrixAutoUpdate = false;
      palm.matrix.copy(basis);
      palm.visible = true;
    });
    this.bones.count = b;
    this.jointBalls.count = j;
    this.bones.instanceMatrix.needsUpdate = true;
    this.jointBalls.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
