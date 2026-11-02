/**
 * 环境贴图生成器
 * 捕获宣纸底色并生成简化的环境贴图用于花瓣反射
 */

import * as THREE from './vendor/three/three.module.js';

/**
 * 生成简化的环境立方体贴图
 * @param {THREE.WebGLRenderer} renderer - 渲染器
 * @param {THREE.Scene} scene - 场景（包含宣纸底色背景）
 * @param {object} colors - 宣纸配色方案
 * @returns {THREE.CubeTexture} 环境立方体贴图
 */
export function generatePaperEnvironmentMap(renderer, colors = {}) {
  // 宣纸配色（从 index.html 的 CSS 变量中提取）
  const paperColor = colors.paper || '#ddc6a7';
  const topLight = colors.topLight || '#ecdec6';
  const bottomDark = colors.bottomDark || '#c9ad88';

  const size = 256;  // 低分辨率足够（环境贴图模糊）

  // 创建 6 个面的 Canvas（+X, -X, +Y, -Y, +Z, -Z）
  const faces = [];

  for (let i = 0; i < 6; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // 根据面的方向绘制不同的颜色
    // +Y (上) = 亮色，-Y (下) = 暗色，其他 = 中间色
    let gradient;
    if (i === 2) {
      // +Y 顶部：亮色到中间色
      gradient = ctx.createLinearGradient(0, 0, 0, size);
      gradient.addColorStop(0, topLight);
      gradient.addColorStop(1, paperColor);
    } else if (i === 3) {
      // -Y 底部：中间色到暗色
      gradient = ctx.createLinearGradient(0, 0, 0, size);
      gradient.addColorStop(0, paperColor);
      gradient.addColorStop(1, bottomDark);
    } else {
      // 其他面：径向渐变（中心亮，边缘暗）
      gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 1.4);
      gradient.addColorStop(0, paperColor);
      gradient.addColorStop(1, bottomDark);
    }

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    // 添加纸张纤维纹理（噪声）
    const imageData = ctx.getImageData(0, 0, size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        // 轻微随机噪声
        const noise = (Math.random() - 0.5) * 10;
        imageData.data[idx] += noise;
        imageData.data[idx + 1] += noise;
        imageData.data[idx + 2] += noise;
      }
    }
    ctx.putImageData(imageData, 0, 0);

    faces.push(canvas);
  }

  // 创建立方体纹理
  const cubeTexture = new THREE.CubeTexture(faces.map(canvas => {
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture.image;
  }));

  cubeTexture.needsUpdate = true;
  return cubeTexture;
}

/**
 * 为场景添加环境贴图
 * @param {THREE.Scene} scene - 场景
 * @param {THREE.CubeTexture} envMap - 环境贴图
 * @param {number} intensity - 环境光强度（0-1）
 */
export function applyEnvironmentMap(scene, envMap, intensity = 0.15) {
  scene.environment = envMap;
  scene.environmentIntensity = intensity;

  // 遍历场景中的所有材质，应用环境贴图
  scene.traverse((object) => {
    if (object.isMesh && object.material) {
      if (Array.isArray(object.material)) {
        object.material.forEach(mat => {
          if (mat.isMeshPhysicalMaterial || mat.isMeshStandardMaterial) {
            mat.envMap = envMap;
            mat.envMapIntensity = intensity;
            mat.needsUpdate = true;
          }
        });
      } else {
        const mat = object.material;
        if (mat.isMeshPhysicalMaterial || mat.isMeshStandardMaterial) {
          mat.envMap = envMap;
          mat.envMapIntensity = intensity;
          mat.needsUpdate = true;
        }
      }
    }
  });
}

/**
 * 简化版：生成单色环境贴图（更高效）
 * @param {string} color - 宣纸颜色
 * @returns {THREE.CubeTexture} 环境立方体贴图
 */
export function generateSimpleEnvironmentMap(color = '#ddc6a7') {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // 单色填充（稍加渐变）
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 1.5);
  gradient.addColorStop(0, color);
  const rgb = hexToRgb(color);
  const darken = `rgb(${Math.floor(rgb.r * 0.8)}, ${Math.floor(rgb.g * 0.8)}, ${Math.floor(rgb.b * 0.8)})`;
  gradient.addColorStop(1, darken);

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // 6 个面使用相同的图像（简化）
  const faces = Array(6).fill(canvas);

  const cubeTexture = new THREE.CubeTexture(faces.map(c => {
    const texture = new THREE.CanvasTexture(c);
    texture.needsUpdate = true;
    return texture.image;
  }));

  cubeTexture.needsUpdate = true;
  return cubeTexture;
}

// 辅助函数：十六进制转 RGB
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 221, g: 198, b: 167 };  // 默认宣纸色
}
