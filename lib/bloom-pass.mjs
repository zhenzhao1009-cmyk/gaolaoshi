/**
 * 轻量级 Bloom Pass
 * 不依赖 Three.js postprocessing 库，使用双通道模糊实现泛光效果
 */

import * as THREE from './vendor/three/three.module.js';

export class BloomPass {
  constructor(renderer, width, height, options = {}) {
    this.renderer = renderer;
    this.width = width;
    this.height = height;

    // 配置参数
    this.strength = options.strength ?? 0.5;      // 泛光强度
    this.radius = options.radius ?? 0.4;          // 泛光半径
    this.threshold = options.threshold ?? 0.85;   // 亮度阈值
    this.enabled = options.enabled ?? true;

    // 创建渲染目标
    const pars = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat };
    this.renderTargetBright = new THREE.WebGLRenderTarget(width / 2, height / 2, pars);
    this.renderTargetBlur1 = new THREE.WebGLRenderTarget(width / 4, height / 4, pars);
    this.renderTargetBlur2 = new THREE.WebGLRenderTarget(width / 4, height / 4, pars);

    // 提取亮部材质
    this.materialBright = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        threshold: { value: this.threshold }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float threshold;
        varying vec2 vUv;

        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          float brightness = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));

          // 只保留亮度超过阈值的部分
          float contribution = max(0.0, brightness - threshold) / max(brightness, 0.0001);
          gl_FragColor = vec4(color.rgb * contribution, color.a);
        }
      `
    });

    // 高斯模糊材质
    this.materialBlur = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2(width / 4, height / 4) },
        direction: { value: new THREE.Vector2(1, 0) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform vec2 direction;
        varying vec2 vUv;

        void main() {
          vec2 texelSize = 1.0 / resolution;
          vec4 color = vec4(0.0);

          // 9-tap 高斯模糊
          float weights[5];
          weights[0] = 0.227027;
          weights[1] = 0.1945946;
          weights[2] = 0.1216216;
          weights[3] = 0.054054;
          weights[4] = 0.016216;

          color += texture2D(tDiffuse, vUv) * weights[0];

          for(int i = 1; i < 5; i++) {
            vec2 offset = direction * texelSize * float(i);
            color += texture2D(tDiffuse, vUv + offset) * weights[i];
            color += texture2D(tDiffuse, vUv - offset) * weights[i];
          }

          gl_FragColor = color;
        }
      `
    });

    // 合成材质
    this.materialCombine = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tBloom: { value: this.renderTargetBlur2.texture },
        strength: { value: this.strength }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform sampler2D tBloom;
        uniform float strength;
        varying vec2 vUv;

        void main() {
          vec4 original = texture2D(tDiffuse, vUv);
          vec4 bloom = texture2D(tBloom, vUv);
          gl_FragColor = original + bloom * strength;
        }
      `
    });

    // 全屏四边形
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.renderTargetBright.setSize(width / 2, height / 2);
    this.renderTargetBlur1.setSize(width / 4, height / 4);
    this.renderTargetBlur2.setSize(width / 4, height / 4);
    this.materialBlur.uniforms.resolution.value.set(width / 4, height / 4);
  }

  render(readBuffer, writeBuffer) {
    if (!this.enabled) {
      // Bloom 禁用时直接输出原图
      this.renderer.setRenderTarget(writeBuffer);
      this.quad.material = new THREE.MeshBasicMaterial({ map: readBuffer.texture });
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      return;
    }

    // 1. 提取亮部
    this.quad.material = this.materialBright;
    this.materialBright.uniforms.tDiffuse.value = readBuffer.texture;
    this.renderer.setRenderTarget(this.renderTargetBright);
    this.renderer.render(this.scene, this.camera);

    // 2. 水平模糊
    this.quad.material = this.materialBlur;
    this.materialBlur.uniforms.tDiffuse.value = this.renderTargetBright.texture;
    this.materialBlur.uniforms.direction.value.set(1, 0);
    this.renderer.setRenderTarget(this.renderTargetBlur1);
    this.renderer.render(this.scene, this.camera);

    // 3. 垂直模糊
    this.materialBlur.uniforms.tDiffuse.value = this.renderTargetBlur1.texture;
    this.materialBlur.uniforms.direction.value.set(0, 1);
    this.renderer.setRenderTarget(this.renderTargetBlur2);
    this.renderer.render(this.scene, this.camera);

    // 4. 合成
    this.quad.material = this.materialCombine;
    this.materialCombine.uniforms.tDiffuse.value = readBuffer.texture;
    this.materialCombine.uniforms.tBloom.value = this.renderTargetBlur2.texture;
    this.materialCombine.uniforms.strength.value = this.strength;
    this.renderer.setRenderTarget(writeBuffer);
    this.renderer.render(this.scene, this.camera);

    // 恢复默认渲染目标
    this.renderer.setRenderTarget(null);
  }

  dispose() {
    this.renderTargetBright.dispose();
    this.renderTargetBlur1.dispose();
    this.renderTargetBlur2.dispose();
    this.materialBright.dispose();
    this.materialBlur.dispose();
    this.materialCombine.dispose();
    this.quad.geometry.dispose();
  }
}
