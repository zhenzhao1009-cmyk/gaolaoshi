import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from '../lib/vendor/three/three.module.js';
import { BloomPass } from '../lib/bloom-pass.mjs';
import { generateLilySpotNormalMap, canvasToTexture } from '../lib/normal-map-generator.mjs';
import { buildFlower, applyLayeredBloom, autoInitLOD, detectDevicePerformance, setLODOverride } from '../lib/flower-scene.mjs';

const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
const specs = vm.runInNewContext(html.slice(html.indexOf('const P ='), html.indexOf('/* ---------- One Euro')) + ';FLOWERS');
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS ' + name); }
function withGlobal(name, value, fn) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  try { return fn(); }
  finally {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  }
}
function canvasDocument() {
  return { createElement() {
    const canvas = { width: 0, height: 0, pixels: null };
    canvas.getContext = type => type === '2d' ? {
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: image => { canvas.pixels = image.data; }
    } : null;
    return canvas;
  } };
}
function withCanvas(fn) { return withGlobal('document', canvasDocument(), fn); }
function fakeRenderer() {
  return {
    target: { name: 'previous target' }, calls: [], fail: false,
    getRenderTarget() { return this.target; },
    setRenderTarget(target) { this.target = target; },
    render(scene) {
      if (this.fail) throw Error('render failed');
      const material = scene.children[0].material;
      this.calls.push({ target: this.target, material, resolution: material.uniforms?.resolution?.value.clone() });
    }
  };
}

check('Normal map without spots has neutral opaque normals, including all edges', () => withCanvas(() => {
  for (const [w, h] of [[32, 24], [1, 1]]) {
    const canvas = generateLilySpotNormalMap(w, h, { spotCount: 0 });
    assert.equal(canvas.pixels.length, w * h * 4);
    for (let i = 0; i < canvas.pixels.length; i += 4) assert.deepEqual([...canvas.pixels.slice(i, i + 4)], [128, 128, 255, 255]);
  }
}));

check('Rectangular normal map has a localized circular spot with gradients in both directions', () => withCanvas(() => {
  const random = Math.random;
  Math.random = () => 0.5;
  let canvas;
  try { canvas = generateLilySpotNormalMap(128, 96, { spotCount: 1, spotSizeMin: 0.12, spotSizeMax: 0.12, bumpHeight: 0.8 }); }
  finally { Math.random = random; }
  const xs = [], ys = [], red = [], green = [];
  for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
    const i = (y * 128 + x) * 4;
    assert.equal(canvas.pixels[i + 3], 255);
    if (canvas.pixels[i] !== 128 || canvas.pixels[i + 1] !== 128) {
      xs.push(x); ys.push(y); red.push(canvas.pixels[i]); green.push(canvas.pixels[i + 1]);
    }
  }
  assert.ok(xs.length > 0 && xs.length < 600);
  assert.ok(Math.min(...red) < 128 && Math.max(...red) > 128);
  assert.ok(Math.min(...green) < 128 && Math.max(...green) > 128);
  assert.ok(Math.abs((Math.max(...xs) - Math.min(...xs)) - (Math.max(...ys) - Math.min(...ys))) <= 1);
}));

check('CanvasTexture retains its image source and dimensions', () => withCanvas(() => {
  const canvas = generateLilySpotNormalMap(16, 12, { spotCount: 0 });
  const texture = canvasToTexture(canvas, THREE);
  assert.equal(texture.image, canvas);
  assert.equal(canvas.width, 16);
  assert.equal(canvas.height, 12);
  texture.dispose();
}));

check('Shared lily normal map survives one model disposal and is recreated after the final owner', () => withCanvas(() => {
  const spec = specs.find(s => s.name === 'Lily');
  const first = buildFlower(spec, 'low'), second = buildFlower(spec, 'low');
  const texture = first.petals[0].mesh.material.normalMap;
  assert.ok(texture?.isCanvasTexture);
  assert.equal(second.petals[0].mesh.material.normalMap, texture);
  let disposed = 0;
  texture.addEventListener('dispose', () => disposed++);
  first.dispose(); first.dispose();
  assert.equal(disposed, 0);
  second.update(0.2); second.update(0.8);
  second.dispose(); second.dispose();
  assert.equal(disposed, 1);
  const third = buildFlower(spec, 'low');
  assert.notEqual(third.petals[0].mesh.material.normalMap, texture);
  assert.equal(third.petals[0].mesh.material.normalMap.image.width, 512);
  third.dispose();
}));

check('Model disposal releases each geometry/material once, detaches it, and preserves borrowed textures', () => {
  const model = buildFlower(specs[0], 'low');
  const parent = new THREE.Group(); parent.add(model.group);
  const resources = new Set();
  model.group.traverse(o => { if (o.geometry) resources.add(o.geometry); if (o.material) resources.add(o.material); });
  const counts = new Map([...resources].map(r => [r, 0]));
  for (const resource of resources) resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
  const envMap = new THREE.CubeTexture(); let textureDisposals = 0;
  envMap.addEventListener('dispose', () => textureDisposals++);
  model.petals[0].mesh.material.envMap = envMap;
  model.dispose(); model.dispose();
  assert.equal(parent.children.length, 0);
  assert.ok([...counts.values()].every(n => n === 1));
  assert.equal(textureDisposals, 0);
  envMap.dispose();
});

check('Textured petal shells include usable UV coordinates on both surfaces', () => {
  const model = buildFlower(specs[1], 'low');
  for (const { mesh } of model.petals) {
    const geometry = mesh.geometry, uv = geometry.getAttribute('uv');
    assert.equal(uv.count, geometry.getAttribute('position').count);
    assert.ok([...uv.array].every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    const side = uv.count / 2;
    assert.deepEqual([...uv.array.slice(0, side * 2)], [...uv.array.slice(side * 2)]);
    assert.ok([...Array(side).keys()].some(i => uv.getY(i) === 0));
    assert.ok([...Array(side).keys()].some(i => uv.getY(i) === 1));
  }
  model.dispose();
});

check('Animation weights update in both directions after reuse', () => {
  const model = buildFlower(specs.find(s => s.name === 'Cherry Blossom'), 'low');
  const weights = () => model.petals.map(p => [...p.mesh.morphTargetInfluences]);
  model.update(0.2); const closed = weights();
  model.update(0.7); assert.notDeepEqual(weights(), closed);
  model.update(0.2); assert.deepEqual(weights(), closed);
  model.dispose();
});

check('All easing types have exact closed/open endpoints for every layer', () => {
  for (const ease of ['cubic', 'back', 'elastic']) for (let layer = 0; layer < 4; layer++) {
    assert.equal(applyLayeredBloom(0, layer, 4, ease), 0);
    assert.equal(applyLayeredBloom(1, layer, 4, ease), 1);
  }
});

check('Bloom resize preserves render targets and texture references, with positive integer dimensions', () => {
  const pass = new BloomPass(fakeRenderer(), 321, 127);
  const targets = [pass.renderTargetBright, pass.renderTargetBlur1, pass.renderTargetBlur2];
  const texture = pass.materialCombine.uniforms.tBloom.value;
  const events = [0, 0, 0];
  targets.forEach((target, i) => target.addEventListener('dispose', () => events[i]++));
  pass.setSize(321, 127);
  assert.deepEqual(events, [0, 0, 0]);
  pass.setSize(1, 1);
  assert.deepEqual(events, [1, 1, 1]);
  assert.deepEqual([pass.renderTargetBright, pass.renderTargetBlur1, pass.renderTargetBlur2], targets);
  assert.equal(pass.materialCombine.uniforms.tBloom.value, texture);
  targets.forEach(target => { assert.equal(target.width, 1); assert.equal(target.height, 1); });
  pass.dispose(); pass.dispose();
  assert.deepEqual(events, [2, 2, 2]);
});

check('Disabled Bloom reuses one copy material and restores the caller render target', () => {
  const renderer = fakeRenderer(), previous = renderer.target;
  const pass = new BloomPass(renderer, 80, 60, { enabled: false });
  const input = new THREE.WebGLRenderTarget(80, 60), output = new THREE.WebGLRenderTarget(80, 60);
  for (let i = 0; i < 50; i++) { pass.render(input, output); assert.equal(renderer.target, previous); }
  assert.equal(new Set(renderer.calls.map(c => c.material)).size, 1);
  assert.equal(renderer.calls[0].material, pass.materialCopy);
  assert.ok(renderer.calls.every(c => c.target === output));
  pass.dispose(); input.dispose(); output.dispose();
});

check('Enabled Bloom samples each source at its own size and restores state on render errors', () => {
  const renderer = fakeRenderer(), previous = renderer.target;
  const pass = new BloomPass(renderer, 100, 60);
  const input = new THREE.WebGLRenderTarget(100, 60);
  pass.threshold = 0.7;
  pass.render(input, null);
  assert.equal(renderer.calls.length, 4);
  assert.deepEqual(renderer.calls[1].resolution.toArray(), [50, 30]);
  assert.deepEqual(renderer.calls[2].resolution.toArray(), [25, 15]);
  assert.equal(pass.materialBright.uniforms.threshold.value, 0.7);
  assert.equal(renderer.target, previous);
  renderer.fail = true;
  assert.throws(() => pass.render(input, null), /render failed/);
  assert.equal(renderer.target, previous);
  pass.dispose(); input.dispose();
});

check('GPU detection recognizes GTX 900/1000 series and stale LOD overrides reset without storage', () => {
  for (const gpu of ['NVIDIA GeForce GTX 960', 'NVIDIA GeForce GTX 1660']) {
    const gl = { getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 1 }), getParameter: () => gpu };
    withGlobal('navigator', { userAgent: 'Windows', deviceMemory: 4 }, () =>
      withGlobal('document', { createElement: () => ({ getContext: () => gl }) }, () => {
        assert.equal(detectDevicePerformance(), 'medium');
        setLODOverride('low');
        withGlobal('localStorage', { getItem() { throw Error('storage denied'); } }, () => {
          const info = autoInitLOD();
          assert.equal(info.override, null);
          assert.equal(info.active, 'medium');
        });
      }));
  }
});

console.log(`\n${passed} rendering/resource checks passed. GPU rendering is covered separately in tools/test_webgl.html.`);
