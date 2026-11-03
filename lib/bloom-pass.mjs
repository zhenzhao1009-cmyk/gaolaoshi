/**
 * 轻量级 Bloom Pass
 * 不依赖 Three.js postprocessing 库，使用双通道模糊实现泛光效果。
 */
import * as THREE from './vendor/three/three.module.js';

const dimension = value => Math.max(1, Math.floor(value));

export class BloomPass {
  constructor(renderer, width, height, options = {}) {
    this.renderer = renderer;
    this.width = dimension(width);
    this.height = dimension(height);
    this.strength = options.strength ?? 0.5;
    this.radius = options.radius ?? 0.4;
    this.threshold = options.threshold ?? 0.85;
    this.enabled = options.enabled ?? true;
    this.disposed = false;

    const pars = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: false };
    this.renderTargetBright = new THREE.WebGLRenderTarget(dimension(this.width / 2), dimension(this.height / 2), pars);
    this.renderTargetBlur1 = new THREE.WebGLRenderTarget(dimension(this.width / 4), dimension(this.height / 4), pars);
    this.renderTargetBlur2 = new THREE.WebGLRenderTarget(dimension(this.width / 4), dimension(this.height / 4), pars);

    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
    this.materialBright = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: null },
        threshold: { value: this.threshold }
      },
      vertexShader,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float threshold;
        varying vec2 vUv;
        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          float brightness = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
          float contribution = max(0.0, brightness - threshold) / max(brightness, 0.0001);
          gl_FragColor = vec4(color.rgb * contribution, color.a * contribution);
        }
      `
    });

    this.materialBlur = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2(this.renderTargetBright.width, this.renderTargetBright.height) },
        direction: { value: new THREE.Vector2(1, 0) }
      },
      vertexShader,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform vec2 direction;
        varying vec2 vUv;
        void main() {
          vec2 texelSize = 1.0 / resolution;
          vec4 color = vec4(0.0);
          float weights[5];
          weights[0] = 0.227027;
          weights[1] = 0.1945946;
          weights[2] = 0.1216216;
          weights[3] = 0.054054;
          weights[4] = 0.016216;
          color += texture2D(tDiffuse, vUv) * weights[0];
          for (int i = 1; i < 5; i++) {
            vec2 offset = direction * texelSize * float(i);
            color += texture2D(tDiffuse, vUv + offset) * weights[i];
            color += texture2D(tDiffuse, vUv - offset) * weights[i];
          }
          gl_FragColor = color;
        }
      `
    });

    this.materialCombine = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: null },
        tBloom: { value: this.renderTargetBlur2.texture },
        strength: { value: this.strength }
      },
      vertexShader,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform sampler2D tBloom;
        uniform float strength;
        varying vec2 vUv;
        void main() {
          vec4 original = texture2D(tDiffuse, vUv);
          vec4 bloom = texture2D(tBloom, vUv);
          float alpha = clamp(original.a + bloom.a * strength, 0.0, 1.0);
          vec3 premultiplied = original.rgb + bloom.rgb * strength;
          // 最终复制使用透明材质；先还原直通颜色，避免透明光晕被再次乘以 alpha。
          gl_FragColor = vec4(premultiplied / max(alpha, 0.0001), alpha);
        }
      `
    });

    // 关闭 Bloom 时复用复制材质；不在每帧创建新材质。
    this.materialCopy = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.NoBlending, depthTest: false, depthWrite: false, toneMapped: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.materialBright);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
  }

  setSize(width, height) {
    this.width = dimension(width);
    this.height = dimension(height);
    // Three.js 的 setSize 会在尺寸改变时释放旧 GPU 缓冲，同时保留纹理对象引用。
    this.renderTargetBright.setSize(dimension(this.width / 2), dimension(this.height / 2));
    this.renderTargetBlur1.setSize(dimension(this.width / 4), dimension(this.height / 4));
    this.renderTargetBlur2.setSize(dimension(this.width / 4), dimension(this.height / 4));
    this.materialBlur.uniforms.resolution.value.set(this.renderTargetBright.width, this.renderTargetBright.height);
  }

  render(readBuffer, writeBuffer) {
    if (this.disposed) return;
    const previousTarget = this.renderer.getRenderTarget();
    try {
      if (!this.enabled) {
        this.materialCopy.map = readBuffer.texture;
        this.quad.material = this.materialCopy;
        this.renderer.setRenderTarget(writeBuffer);
        this.renderer.render(this.scene, this.camera);
        return;
      }

      this.quad.material = this.materialBright;
      this.materialBright.uniforms.tDiffuse.value = readBuffer.texture;
      this.materialBright.uniforms.threshold.value = this.threshold;
      this.renderer.setRenderTarget(this.renderTargetBright);
      this.renderer.render(this.scene, this.camera);

      this.quad.material = this.materialBlur;
      this.materialBlur.uniforms.tDiffuse.value = this.renderTargetBright.texture;
      this.materialBlur.uniforms.resolution.value.set(this.renderTargetBright.width, this.renderTargetBright.height);
      this.materialBlur.uniforms.direction.value.set(1, 0);
      this.renderer.setRenderTarget(this.renderTargetBlur1);
      this.renderer.render(this.scene, this.camera);

      this.materialBlur.uniforms.tDiffuse.value = this.renderTargetBlur1.texture;
      this.materialBlur.uniforms.resolution.value.set(this.renderTargetBlur1.width, this.renderTargetBlur1.height);
      this.materialBlur.uniforms.direction.value.set(0, 1);
      this.renderer.setRenderTarget(this.renderTargetBlur2);
      this.renderer.render(this.scene, this.camera);

      this.quad.material = this.materialCombine;
      this.materialCombine.uniforms.tDiffuse.value = readBuffer.texture;
      this.materialCombine.uniforms.strength.value = this.strength;
      this.renderer.setRenderTarget(writeBuffer);
      this.renderer.render(this.scene, this.camera);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderTargetBright.dispose();
    this.renderTargetBlur1.dispose();
    this.renderTargetBlur2.dispose();
    this.materialBright.dispose();
    this.materialBlur.dispose();
    this.materialCombine.dispose();
    this.materialCopy.dispose();
    this.quad.geometry.dispose();
  }
}
