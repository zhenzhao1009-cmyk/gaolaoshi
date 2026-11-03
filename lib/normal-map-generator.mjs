/**
 * 程序化法线贴图生成器
 * 用于百合花瓣的斑点纹理，不增加几何复杂度
 */

/**
 * 生成百合斑点法线贴图
 * @param {number} width - 纹理宽度
 * @param {number} height - 纹理高度
 * @param {object} options - 配置参数
 * @returns {HTMLCanvasElement} 法线贴图 Canvas
 */
export function generateLilySpotNormalMap(width = 512, height = 512, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // 配置参数
  const spotCount = options.spotCount ?? 40;           // 斑点数量
  const spotSizeMin = options.spotSizeMin ?? 0.01;     // 最小斑点尺寸（相对）
  const spotSizeMax = options.spotSizeMax ?? 0.04;     // 最大斑点尺寸
  const bumpHeight = options.bumpHeight ?? 0.3;        // 凸起高度（0-1）
  const fadeStart = options.fadeStart ?? 0.3;          // 斑点开始淡出的位置（0=根部，1=尖端）
  const fadeEnd = options.fadeEnd ?? 1.0;              // 斑点完全消失的位置

  // 创建高度图（灰度图，用于计算法线）
  const heightData = ctx.createImageData(width, height);

  // 生成随机斑点位置和尺寸
  const spots = [];
  for (let i = 0; i < spotCount; i++) {
    const u = Math.random();
    const v = Math.random();

    // 斑点主要集中在花瓣中部，避免边缘
    const centerBias = 0.3;
    const x = (u - 0.5) * (1 - centerBias) + 0.5;
    const y = (v - 0.5) * (1 - centerBias) + 0.5;

    // 斑点尺寸随机，靠近根部的更大
    const sizeFactor = 1 - y * 0.3;  // 根部（y=0）更大
    const size = (spotSizeMin + Math.random() * (spotSizeMax - spotSizeMin)) * sizeFactor;

    // 淡出因子：靠近花瓣尖端的斑点更淡
    const fade = 1 - Math.max(0, (y - fadeStart) / (fadeEnd - fadeStart));

    spots.push({ x, y, size, fade });
  }

  // 填充高度图
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const u = px / width;
      const v = py / height;
      let sampleHeight = 0;

      // 距离和半径统一使用像素，矩形纹理中的斑点也保持圆形。
      for (const spot of spots) {
        const dx = (u - spot.x) * width;
        const dy = (v - spot.y) * height;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const radius = spot.size * Math.min(width, height);

        if (dist < radius) {
          // 高斯型凸起
          const t = dist / radius;
          const bump = Math.exp(-t * t * 4) * bumpHeight * spot.fade;
          sampleHeight += bump;
        }
      }

      // 限制高度范围 [0, 1]
      sampleHeight = Math.min(1, Math.max(0, sampleHeight));

      // 存储灰度值（0-255）
      const idx = (py * width + px) * 4;
      const gray = Math.floor(sampleHeight * 255);
      heightData.data[idx] = gray;
      heightData.data[idx + 1] = gray;
      heightData.data[idx + 2] = gray;
      heightData.data[idx + 3] = 255;
    }
  }

  // 从高度图计算法线（Sobel 算子）
  const normalData = ctx.createImageData(width, height);
  const strength = 1.0;  // 法线强度

  for (let py = 1; py < height - 1; py++) {
    for (let px = 1; px < width - 1; px++) {
      // 采样周围 8 个像素
      const getHeight = (x, y) => {
        const idx = (y * width + x) * 4;
        return heightData.data[idx] / 255;
      };

      // Sobel X (水平梯度)
      const dX = (
        -1 * getHeight(px - 1, py - 1) +
        1 * getHeight(px + 1, py - 1) +
        -2 * getHeight(px - 1, py) +
        2 * getHeight(px + 1, py) +
        -1 * getHeight(px - 1, py + 1) +
        1 * getHeight(px + 1, py + 1)
      ) * strength;

      // Sobel Y (垂直梯度)
      const dY = (
        -1 * getHeight(px - 1, py - 1) +
        -2 * getHeight(px, py - 1) +
        -1 * getHeight(px + 1, py - 1) +
        1 * getHeight(px - 1, py + 1) +
        2 * getHeight(px, py + 1) +
        1 * getHeight(px + 1, py + 1)
      ) * strength;

      // 法线向量（切线空间）
      const nx = -dX;
      const ny = -dY;
      const nz = 1.0;

      // 归一化
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const normX = nx / len;
      const normY = ny / len;
      const normZ = nz / len;

      // 转换到 [0, 255] 范围（法线贴图标准格式）
      const idx = (py * width + px) * 4;
      normalData.data[idx] = Math.round((normX * 0.5 + 0.5) * 255);      // R
      normalData.data[idx + 1] = Math.round((normY * 0.5 + 0.5) * 255);  // G
      normalData.data[idx + 2] = Math.round((normZ * 0.5 + 0.5) * 255);  // B
      normalData.data[idx + 3] = 255;  // A
    }
  }

  // 处理边缘像素（使用相邻像素）
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      if (px === 0 || px === width - 1 || py === 0 || py === height - 1) {
        const idx = (py * width + px) * 4;
        // 默认法线向上 (0, 0, 1) -> (128, 128, 255)
        normalData.data[idx] = 128;
        normalData.data[idx + 1] = 128;
        normalData.data[idx + 2] = 255;
        normalData.data[idx + 3] = 255;
      }
    }
  }

  // 绘制到 Canvas
  ctx.putImageData(normalData, 0, 0);

  // CanvasTexture 仍将此 Canvas 作为图像源，纹理使用期间需要保留像素缓冲。
  return canvas;
}

/**
 * 生成简单的凹凸贴图（灰度图）
 * 比法线贴图更简单，但效果略差
 */
export function generateLilySpotBumpMap(width = 512, height = 512, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // 填充基础色（中灰）
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, width, height);

  const spotCount = options.spotCount ?? 40;
  const spotSizeMin = options.spotSizeMin ?? 0.01;
  const spotSizeMax = options.spotSizeMax ?? 0.04;
  const fadeStart = options.fadeStart ?? 0.3;

  for (let i = 0; i < spotCount; i++) {
    const u = 0.3 + Math.random() * 0.4;  // 限制在中部
    const v = 0.2 + Math.random() * 0.6;
    const x = u * width;
    const y = v * height;

    const sizeFactor = 1 - v * 0.3;
    const size = (spotSizeMin + Math.random() * (spotSizeMax - spotSizeMin)) * Math.min(width, height) * sizeFactor;

    const fade = 1 - Math.max(0, (v - fadeStart) / (1 - fadeStart));

    // 径向渐变（中心深，边缘浅）
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, size);
    gradient.addColorStop(0, `rgba(40, 20, 10, ${fade * 0.4})`);  // 深褐色斑点
    gradient.addColorStop(0.7, `rgba(40, 20, 10, ${fade * 0.2})`);
    gradient.addColorStop(1, 'rgba(40, 20, 10, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(x - size, y - size, size * 2, size * 2);
  }

  return canvas;
}

/**
 * 将 Canvas 转换为 Three.js Texture
 */
export function canvasToTexture(canvas, THREE) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}
