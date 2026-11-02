import * as THREE from './vendor/three/three.module.js';
import { BloomPass } from './bloom-pass.mjs';

const DEG = Math.PI / 180;
const clamp = (x, a=0, b=1) => Math.max(a, Math.min(b, x));
const smooth = t => t*t*(3-2*t);
const mix = (a,b,t) => a+(b-a)*t;
const hash = n => { const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x); };
export const BLOOM_KEYS = [0,.2,.4,.6,.8,1];

// LOD (Level of Detail) 配置：根据场景复杂度动态调整网格密度
const LOD_PRESETS = {
  high:   { U: 28, V: 18 },  // 单花特写、静态展示
  medium: { U: 20, V: 12 },  // 双花模式、一般场景
  low:    { U: 14, V: 8  }   // 移动端、性能受限设备
};
let currentLOD = 'high';  // 默认高质量
let lodOverride = null;    // 用户手动设置
export function setLOD(level) {
  if (LOD_PRESETS[level]) currentLOD = level;
}
export function getLOD() { return currentLOD; }
export function setLODOverride(level) {
  lodOverride = level && LOD_PRESETS[level] ? level : null;
  if (lodOverride) currentLOD = lodOverride;
}

// 设备性能检测：返回推荐的 LOD 级别
export function detectDevicePerformance() {
  const ua = navigator.userAgent || '';
  const isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const isTablet = /iPad|Android(?!.*Mobile)/i.test(ua);

  // 内存检测（Chrome/Edge 支持）
  const memory = (navigator as any).deviceMemory || 8;  // 默认 8GB

  // GPU 检测（通过 WebGL）
  let gpuTier = 2;  // 0=low, 1=medium, 2=high
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
        // 低端 GPU 关键词
        if (/Intel.*HD [2-5]\d{2,3}|Mali-[4-6]\d{2}|Adreno [2-4]\d{2}/i.test(renderer)) {
          gpuTier = 0;
        }
        // 中端 GPU
        else if (/Intel.*Iris|Mali-G[5-7]\d|Adreno [5-6]\d{2}|GTX [9-1]\d{2,3}M?$/i.test(renderer)) {
          gpuTier = 1;
        }
        // 高端 GPU（RTX, 高端 Intel, Apple M 系列等）
        else if (/RTX|Apple M\d|Radeon RX|GTX [2-4]\d{3}/i.test(renderer)) {
          gpuTier = 2;
        }
      }
    }
  } catch (e) {
    // WebGL 不可用，保守估计
  }

  // 决策逻辑
  if (isMobile && !isTablet) {
    // 手机：根据内存和 GPU 判断
    if (memory < 4 || gpuTier === 0) return 'low';
    if (memory < 6 || gpuTier === 1) return 'medium';
    return 'medium';  // 高端手机也用 medium（省电）
  }

  if (isTablet) {
    // 平板：通常性能较好
    if (memory < 4 || gpuTier === 0) return 'medium';
    return 'high';
  }

  // 桌面端：根据 GPU 判断
  if (gpuTier === 0) return 'medium';
  if (gpuTier === 1 && memory < 8) return 'medium';
  return 'high';
}

// 自动初始化 LOD（在模块加载时执行）
export function autoInitLOD() {
  const recommended = detectDevicePerformance();
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('bloom.lod.override') : null;

  if (stored && LOD_PRESETS[stored]) {
    // 用户手动设置优先
    setLODOverride(stored);
  } else {
    // 使用自动检测结果
    setLOD(recommended);
  }

  return { detected: recommended, active: currentLOD, override: lodOverride };
}

// Closed, thin shells with real depth, not camera-facing planes or image cards.
export function buildPetalGeometry(spec, seed=0, animated=true, lodLevel=null) {
  const lod = lodLevel || currentLOD;
  const { U, V } = LOD_PRESETS[lod] || LOD_PRESETS.high;
  const rows=U+1,cols=V+1,side=rows*cols,count=side*2,indices=[];
  for(let u=0;u<U;u++)for(let v=0;v<V;v++){
    const a=u*cols+v,b=a+cols;
    indices.push(a,a+1,b,a+1,b+1,b);
    indices.push(a+side,b+side,a+1+side,a+1+side,b+side,b+1+side);
  }
  const edge=[];
  for(let v=0;v<=V;v++)edge.push(v);
  for(let u=1;u<=U;u++)edge.push(u*cols+V);
  for(let v=V-1;v>=0;v--)edge.push(U*cols+v);
  for(let u=U-1;u>0;u--)edge.push(u*cols);
  for(let k=0;k<edge.length;k++){const a=edge[k],b=edge[(k+1)%edge.length];indices.push(a,b,a+side,b,b+side,a+side);}
  const index=new THREE.Uint16BufferAttribute(indices,1);
  const root=new THREE.Color(spec.c1||'#f9e8e7'),tip=new THREE.Color(spec.c0||'#d77c94');
  const colors=new Float32Array(count*3);
  // 增强颜色渐变：叶脉区域颜色略深
  for(let u=0;u<=U;u++)for(let v=0;v<=V;v++){
    const t=u/U,x=v/V*2-1;
    const color=root.clone().lerp(tip,Math.pow(t,.85)*.92);
    // 主叶脉（中心线）颜色加深
    const veinDarken=.018*Math.exp(-x*x*18)*Math.sin(Math.PI*t);
    // 侧脉纹理
    const lateralVeins=.012*Math.abs(x)*Math.cos(x*9*Math.PI+t*2)*smooth(t);
    color.multiplyScalar(1-.023*Math.cos(x*9*Math.PI+t*2)-.018*x*x-veinDarken-lateralVeins);
    for(let s=0;s<2;s++){const k=(s*side+u*cols+v)*3;colors[k]=color.r;colors[k+1]=color.g;colors[k+2]=color.b;}
  }
  const keys=animated?BLOOM_KEYS:[1];
  const states=keys.map(bloom=>{
    const opening=smooth(clamp((bloom-(spec.delay||0))/(1-(spec.delay||0))));
    const theta=mix(spec.t0??7,spec.t1??76,opening)*DEG;
    const curl=(spec.curl||0)*DEG*opening;
    const length=(spec.len||.5)*mix(.94,1,opening),width=spec.wid||.18;
    const front=new Float32Array(side*3),positions=new Float32Array(count*3);
    let radial=spec.base??.025,height=0;
    for(let u=0;u<=U;u++){
      const t=u/U,angle=theta+curl*Math.pow(t,1.8);
      if(u){const tm=(u-.5)/U,th=theta+curl*Math.pow(tm,1.8);radial+=Math.sin(th)*length/U;height+=Math.cos(th)*length/U;}
      const profile=Math.pow(Math.max(.00001,Math.sin(Math.PI*Math.pow(t,spec.p||.7))),spec.q||.8);
      const w=width*profile*mix(.88,1,opening);
      const nx=-Math.cos(angle),ny=Math.sin(angle);
      for(let v=0;v<=V;v++){
        const x=v/V*2-1;
        const ripple=Math.sin(t*14+seed)*Math.pow(Math.abs(x),4)*(spec.ruffle||.02)*width*opening;
        // 叶脉凸起：主脉凸起更明显
        const mainVein=.0025*Math.exp(-x*x*24)*Math.sin(Math.PI*t*.8);
        const sideVein=.0018*Math.cos(x*9*Math.PI+t*2)*Math.sin(Math.PI*t);
        const veinRelief=mainVein+sideVein;
        const cup=(spec.cup??.4)*w*x*x+veinRelief+ripple;
        const notch=(spec.notch||0)*length*Math.pow(1-x*x,7)*smooth(clamp((t-.78)/.22));
        const k=(u*cols+v)*3;
        front[k]=radial+nx*cup-Math.sin(angle)*notch;
        front[k+1]=height+ny*cup-Math.cos(angle)*notch;
        front[k+2]=x*w*(1+.035*x*Math.sin(seed+3))+.012*Math.sin(seed)*t*t*opening;
      }
    }
    for(let u=0;u<=U;u++)for(let v=0;v<=V;v++){
      const k=(u*cols+v)*3;
      const a=(Math.max(0,u-1)*cols+v)*3,b=(Math.min(U,u+1)*cols+v)*3;
      const c=(u*cols+Math.max(0,v-1))*3,d=(u*cols+Math.min(V,v+1))*3;
      const du=new THREE.Vector3(front[b]-front[a],front[b+1]-front[a+1],front[b+2]-front[a+2]);
      const dv=new THREE.Vector3(front[d]-front[c],front[d+1]-front[c+1],front[d+2]-front[c+2]);
      const n=dv.cross(du).normalize();
      if(n.lengthSq()<.1)n.set(-1,0,0);
      const thickness=(spec.thickness??.0025)*(.45+.55*Math.sin(Math.PI*u/U));
      for(let s=0;s<2;s++){const j=k+s*side*3,sign=s?-1:1;positions[j]=front[k]+n.x*thickness*sign;positions[j+1]=front[k+1]+n.y*thickness*sign;positions[j+2]=front[k+2]+n.z*thickness*sign;}
    }
    const geometry=new THREE.BufferGeometry();geometry.setIndex(index);geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.computeVertexNormals();
    return {position:geometry.getAttribute('position'),normal:geometry.getAttribute('normal')};
  });
  const geometry=new THREE.BufferGeometry();geometry.setIndex(index);
  geometry.setAttribute('position',states[0].position);geometry.setAttribute('normal',states[0].normal);geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  if(animated){geometry.morphAttributes.position=states.slice(1).map(s=>s.position);geometry.morphAttributes.normal=states.slice(1).map(s=>s.normal);}
  geometry.computeBoundingSphere();geometry.userData={kind:'volumetric-petal',shellThickness:spec.thickness??.0025,keys:keys.slice()};
  return geometry;
}

export function bloomWeights(value) {
  const v=clamp(Number.isFinite(value)?value:0),scaled=v*5,lower=Math.min(4,Math.floor(scaled)),upper=lower+1,t=scaled-lower;
  const weights=[0,0,0,0,0];
  if(lower>0)weights[lower-1]=1-t;
  weights[upper-1]+=t;
  return weights;
}

// 缓动函数：让动画更自然
const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeOutElastic = t => { const c4 = (2 * Math.PI) / 3; return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1; };
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

// 应用缓动到开放度，支持分层时间差
export function applyLayeredBloom(value, layerIndex, totalLayers, easeType='cubic') {
  const v = clamp(Number.isFinite(value) ? value : 0);
  // 分层延迟：外层（layerIndex=0）立即开始，内层逐渐延迟
  const delayPerLayer = 0.12 / Math.max(1, totalLayers - 1);
  const layerDelay = layerIndex * delayPerLayer;
  // 调整后的开放度
  const adjusted = clamp((v - layerDelay) / (1 - layerDelay));
  // 应用缓动
  let eased = adjusted;
  if (easeType === 'back') eased = easeOutBack(adjusted);
  else if (easeType === 'elastic') eased = easeOutElastic(adjusted);
  else eased = easeOutCubic(adjusted);
  return eased;
}

// 针对不同花卉类型的专属材质配置
function material(color,petal=false,type=null){
  const base={color,vertexColors:petal,side:THREE.DoubleSide,metalness:0};
  if(!petal)return new THREE.MeshPhysicalMaterial({...base,roughness:.65,sheen:.1,sheenRoughness:.8,sheenColor:new THREE.Color('#a5bc80'),clearcoat:.025,clearcoatRoughness:.8});
  // 花瓣专属材质：根据花卉种类调整光学特性
  const presets={
    'Lotus':{roughness:.48,sheen:.82,sheenRoughness:.75,sheenColor:new THREE.Color('#fce8eb'),clearcoat:.15,clearcoatRoughness:.65},      // 荷花：蜡质光泽
    'Lily':{roughness:.42,sheen:.92,sheenRoughness:.7,sheenColor:new THREE.Color('#fdfaef'),clearcoat:.08,clearcoatRoughness:.72},       // 百合：丝绸光泽 + 半透
    'Rose':{roughness:.72,sheen:.65,sheenRoughness:.85,sheenColor:new THREE.Color('#d8344c'),clearcoat:.02,clearcoatRoughness:.9},       // 玫瑰：天鹅绒质感
    'Camellia':{roughness:.58,sheen:.78,sheenRoughness:.76,sheenColor:new THREE.Color('#f9ebe8'),clearcoat:.12,clearcoatRoughness:.68,iridescence:.15,iridescenceIOR:1.35,iridescenceThicknessRange:[100,400]}, // 山茶：柔和光泽 + 革质虹彩
    'Cherry Blossom':{roughness:.38,sheen:.88,sheenRoughness:.65,sheenColor:new THREE.Color('#fdeef3'),clearcoat:.05,clearcoatRoughness:.78,transmission:.06,thickness:.5},  // 樱花：纸质薄透
  };
  const config=type&&presets[type]?presets[type]:{roughness:.54,sheen:.72,sheenRoughness:.8,sheenColor:new THREE.Color('#f4d9db'),clearcoat:.025,clearcoatRoughness:.8};
  return new THREE.MeshPhysicalMaterial({...base,...config});
}
function tube(points,radius,color,segments=16){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));return new THREE.Mesh(new THREE.TubeGeometry(curve,segments,radius,7,false),material(color));}
function leaf(parent,origin,angle,length=.25,width=.065,serrated=false,lodLevel=null){
  const geo=buildPetalGeometry({len:length,wid:width,t0:80,t1:80,curl:18,cup:.25,p:.5,q:.9,c0:'#698448',c1:'#294934',thickness:.002},angle,false,lodLevel);
  const mesh=new THREE.Mesh(geo,material('#ffffff',true));mesh.position.set(...origin);mesh.rotation.y=angle;mesh.rotation.z=.15;mesh.castShadow=mesh.receiveShadow=true;
  // 锯齿边缘（玫瑰叶片）：在边缘添加微小三角形扰动
  if(serrated){
    const pos=geo.getAttribute('position');
    for(let i=0;i<pos.count;i++){
      const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
      const radialDist=Math.sqrt(x*x+z*z);
      if(radialDist>.08){  // 仅边缘区域
        const theta=Math.atan2(z,x),sawTooth=.003*Math.sin(theta*28);  // 28齿
        pos.setX(i,x+sawTooth*Math.cos(theta));
        pos.setZ(i,z+sawTooth*Math.sin(theta));
      }
    }
    pos.needsUpdate=true;
    geo.computeVertexNormals();
  }
  parent.add(mesh);
}
function mergeRigidMeshes(parent) {
  parent.updateMatrixWorld(true);
  const inverse=new THREE.Matrix4().copy(parent.matrixWorld).invert(),buckets=new Map(),oldGeo=new Set(),oldMat=new Set();
  parent.traverse(o=>{if(!o.isMesh)return;const key=o.material.color.getHexString();if(!buckets.has(key))buckets.set(key,{material:o.material,parts:[]});buckets.get(key).parts.push({geometry:o.geometry,matrix:new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld)});oldGeo.add(o.geometry);oldMat.add(o.material);});
  parent.clear();const retained=new Set();
  for(const {material,parts} of buckets.values()){
    const positions=[],normals=[],indices=[];let offset=0;
    for(const part of parts){const p=part.geometry.getAttribute('position'),n=part.geometry.getAttribute('normal'),normalMatrix=new THREE.Matrix3().getNormalMatrix(part.matrix);for(let i=0;i<p.count;i++){const v=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(part.matrix),normal=new THREE.Vector3().fromBufferAttribute(n,i).applyMatrix3(normalMatrix).normalize();positions.push(v.x,v.y,v.z);normals.push(normal.x,normal.y,normal.z);}const index=part.geometry.index;if(index)for(let i=0;i<index.count;i++)indices.push(index.getX(i)+offset);else for(let i=0;i<p.count;i++)indices.push(i+offset);offset+=p.count;}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setIndex(indices);geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);retained.add(material);
  }
  oldGeo.forEach(g=>g.dispose());oldMat.forEach(m=>{if(!retained.has(m))m.dispose();});
}

function centerDetails(group,spec,type){
  if(type==='Rose')return;
  // 荷花莲蓬：增加种子数量和细节
  if(type==='Lotus'){
    const pod=new THREE.Mesh(new THREE.CylinderGeometry(.083,.061,.052,32),material('#bdc66a'));pod.position.y=.047;group.add(pod);
    const seedGeo=new THREE.SphereGeometry(.007,8,6),seedMat=material('#6d8540');
    // 螺旋排列 120 颗种子（符合斐波那契数列）
    for(let i=0;i<120;i++){
      const a=i*2.39996,r=.063*Math.sqrt((i+.5)/120);  // 黄金角度螺旋
      const seed=new THREE.Mesh(seedGeo,seedMat);
      seed.scale.set(1,.28,1);  // 扁平种子
      seed.position.set(Math.cos(a)*r,.074+hash(i)*.003,Math.sin(a)*r);  // 微小高度差
      group.add(seed);
    }
  }
  // 雄蕊数量：百合6，荷花120，山茶35，樱花30
  const lily=type==='Lily',n=lily?6:type==='Lotus'?120:type==='Cherry Blossom'?30:35;
  const filaments=new THREE.Group(),antherGeo=new THREE.SphereGeometry(1,8,6);
  // 百合花药：橙棕色且更大
  const antherMat=material(lily?'#c85a18':type==='Lotus'?'#e8c550':'#e4b53a');
  const baseRadius=type==='Lotus'?.095:.018,height=lily?.29:type==='Lotus'?.075:.09;
  for(let i=0;i<n;i++){
    const a=i/n*Math.PI*2+(hash(i)-.5)*.12,r=baseRadius+(lily?.13:type==='Lotus'?.06:.045),h=height*(.86+hash(i+7)*.24);
    const end=[Math.cos(a)*r,h,Math.sin(a)*r];
    // 花丝：百合更粗，颜色更明显
    const filThick=lily?.003:type==='Lotus'?.0012:.0015;
    const filColor=lily?'#cfd89a':type==='Lotus'?'#f4db70':'#f0d88c';
    filaments.add(tube([[Math.cos(a)*baseRadius,0,Math.sin(a)*baseRadius],[end[0]*.7,h*.64,end[2]*.7],end],filThick,filColor,8));
    // 花药：百合加大为真实T字型
    const anther=new THREE.Mesh(antherGeo,antherMat);anther.position.set(...end);
    anther.scale.set(lily?.025:.0045,lily?.009:.005,lily?.009:.0045);
    anther.rotation.y=-a;filaments.add(anther);
  }
  // 百合雌蕊：三裂柱头
  if(lily){
    filaments.add(tube([[0,0,0],[.005,.18,0],[.014,.35,.008]],.005,'#b8cd82',12));  // 加粗花柱
    const stigma=new THREE.Mesh(new THREE.SphereGeometry(.012,10,8),material('#9fb86a'));  // 加大柱头
    stigma.scale.set(1,.6,1);stigma.position.set(.014,.35,.008);filaments.add(stigma);
  }
  group.add(filaments);
  mergeRigidMeshes(group);
}

export function buildFlower(spec, lodLevel=null) {
  const group=new THREE.Group(),petals=[],centers=[],resources=new Set();
  const type=spec.name;
  let layers=spec.layers.map(x=>({...x}));
  if(type==='Lotus')layers=[{n:10,len:.60,wid:.18,p:.68,q:.88,t0:9,t1:88,curl:15,cup:.5,c0:'#d57b97',c1:'#fbefec',delay:0},{n:9,len:.55,wid:.18,p:.68,q:.9,t0:6,t1:66,curl:10,cup:.52,c0:'#e38aa1',c1:'#fff2ed',delay:.06,twist:18},{n:7,len:.44,wid:.15,p:.65,q:.86,t0:5,t1:43,curl:5,cup:.56,c0:'#e49ab0',c1:'#fff4ec',delay:.12,twist:6},{n:5,len:.30,wid:.11,p:.68,q:.9,t0:4,t1:24,curl:4,cup:.6,c0:'#e9a2b5',c1:'#fff6ed',delay:.17,twist:30}];
  if(type==='Camellia')layers=layers.map((ly,i)=>({...ly,c0:['#fcf4e8','#fff8ee','#f8ecdc'][i],c1:'#e3d5bc',ruffle:.055}));
  // 每种花卉的缓动类型：荷花弹性、百合回弹、玫瑰立方、山茶立方、樱花回弹
  const easeTypes={'Lotus':'elastic','Lily':'back','Rose':'cubic','Camellia':'cubic','Cherry Blossom':'back'};
  const easeType=easeTypes[type]||'cubic';
  const blossom=(parent,variant=0)=>{
    layers.forEach((ly,li)=>{
      const geo=buildPetalGeometry(ly,li*7+variant,true,lodLevel),mat=material('#ffffff',true,type);resources.add(geo);resources.add(mat);
      for(let i=0;i<ly.n;i++){
        const seed=li*37+i*13+variant*101,j=hash(seed)-.5;
        const mesh=new THREE.Mesh(geo,mat);mesh.rotation.y=(i/ly.n*Math.PI*2+(ly.twist||0)*DEG+j*.16);
        mesh.scale.set(1+j*.035,1+j*.07,1+j*.08);mesh.position.y=li*.007;mesh.frustumCulled=false;mesh.castShadow=mesh.receiveShadow=true;
        parent.add(mesh);petals.push({mesh,delay:variant*.065,layerIndex:li,easeType});
      }
    });
    const center=new THREE.Group();centerDetails(center,spec,type);parent.add(center);centers.push(center);
  };
  if(type==='Cherry Blossom'){
    group.add(tube([[-.25,-.36,-.03],[-.10,-.05,0],[.10,.26,.02]],.018,'#6b4c39'));
    [[-.21,.02,.03,.76,-.25],[.08,.25,.03,.84,.1],[.28,-.06,.04,.72,.35]].forEach((p,i)=>{const b=new THREE.Group();b.position.set(p[0],p[1],p[2]);b.scale.setScalar(p[3]);b.rotation.z=p[4];group.add(b);group.add(tube([[-.07,-.09,0],[p[0]*.7,p[1]*.7,0],[p[0],p[1],p[2]]],.008,'#826044'));blossom(b,i);});
  }else{
    blossom(group);
    const len=type==='Lily'?.70:type==='Camellia'?.4:.58;
    group.add(tube([[0,-.02,0],[-.025,-len*.5,-.01],[.04,-len,-.025]],type==='Lotus'?.012:.009,type==='Camellia'?'#6f5641':'#527046',24));
    if(type==='Lily'){leaf(group,[-.01,-.30,0],.5,.29,.045,false,lodLevel);leaf(group,[0,-.48,0],3.1,.25,.04,false,lodLevel);}
    if(type==='Rose'){leaf(group,[-.01,-.34,0],-.5,.24,.075,true,lodLevel);leaf(group,[.005,-.45,0],2.8,.20,.06,true,lodLevel);}  // 玫瑰叶片锯齿边缘
    if(type==='Camellia'){leaf(group,[0,-.15,-.04],.25,.31,.10,true,lodLevel);leaf(group,[-.01,-.23,-.035],3.1,.26,.09,true,lodLevel);}  // 山茶叶片也有小锯齿
  }
  const model={group,petals,centers,lastBloom:NaN,lodLevel:lodLevel||currentLOD,totalLayers:layers.length,update(bloom){
    const b=clamp(bloom);if(Math.abs(b-this.lastBloom)<.00005)return;this.lastBloom=b;
    const cache=new Map();
    // 应用分层时间差和缓动
    for(const p of petals){
      const cacheKey=`${p.delay}_${p.layerIndex}_${p.easeType}`;
      if(!cache.has(cacheKey)){
        const baseBloom=clamp((b-p.delay)/(1-p.delay));
        const layeredBloom=applyLayeredBloom(baseBloom,p.layerIndex,this.totalLayers,p.easeType);
        cache.set(cacheKey,bloomWeights(layeredBloom));
      }
      const w=cache.get(cacheKey);
      for(let k=0;k<5;k++)p.mesh.morphTargetInfluences[k]=w[k];
    }
    for(const c of centers)c.scale.setScalar(.8+.2*b);
  },wireframe(on){group.traverse(o=>{if(o.isMesh&&o.material)o.material.wireframe=on;});},dispose(){const geometries=new Set(),materials=new Set();group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}};
  model.update(.68);
  model.bounds=new THREE.Box3().setFromObject(group);
  return model;
}

export function createFlowerScene(canvas,specs) {
  // 自动检测设备性能并初始化 LOD
  const lodInfo = autoInitLOD();
  console.log('[Bloom] Device LOD:', lodInfo);

  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
  renderer.setClearColor(0x000000,0);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;

  // Bloom Pass 初始化（可选功能，默认关闭）
  const bloomEnabled = typeof localStorage !== 'undefined' ? localStorage.getItem('bloom.postBloom') === 'true' : false;
  let bloomPass = null;
  let renderTargetMain = null;
  let renderTargetOutput = null;

  function initBloomPass(w, h) {
    if (bloomPass) return;
    renderTargetMain = new THREE.WebGLRenderTarget(w, h);
    renderTargetOutput = new THREE.WebGLRenderTarget(w, h);
    bloomPass = new BloomPass(renderer, w, h, {
      strength: 0.6,
      radius: 0.5,
      threshold: 0.8,
      enabled: bloomEnabled
    });
  }

  function disposeBloomPass() {
    if (bloomPass) {
      bloomPass.dispose();
      bloomPass = null;
    }
    if (renderTargetMain) {
      renderTargetMain.dispose();
      renderTargetMain = null;
    }
    if (renderTargetOutput) {
      renderTargetOutput.dispose();
      renderTargetOutput = null;
    }
  }
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,4000);camera.position.set(0,0,1500);
  scene.add(new THREE.HemisphereLight(0xfff4e4,0x7c9277,2.0));
  const key=new THREE.DirectionalLight(0xffeddb,3.0);key.position.set(-500,800,1000);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.bias=-.00015;key.shadow.normalBias=.45;key.shadow.camera.near=100;key.shadow.camera.far=2500;scene.add(key);
  const fill=new THREE.DirectionalLight(0xdce8ff,.85);fill.position.set(650,180,600);scene.add(fill);
  const rim=new THREE.DirectionalLight(0xffd5dc,1.0);rim.position.set(100,400,-800);scene.add(rim);
  const holders=[new THREE.Group(),new THREE.Group()];holders.forEach(g=>scene.add(g));
  const modelCache=new Map();
  const active=[null,null],types=[-1,-1];let width=0,height=0,quality=1.5,wire=false,lost=false,lastCost=0,slowFrames=0,lastLOD=currentLOD;
  const originalDpr=Math.min(globalThis.devicePixelRatio||1,1.75);
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;});
  canvas.addEventListener('webglcontextrestored',()=>{lost=false;});
  function resize(w,h){if(w===width&&h===height)return;width=w;height=h;renderer.setPixelRatio(Math.min(originalDpr,quality));renderer.setSize(w,h,false);camera.left=-w/2;camera.right=w/2;camera.top=h/2;camera.bottom=-h/2;camera.updateProjectionMatrix();const extent=Math.max(w,h)*.7;Object.assign(key.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent});key.shadow.camera.updateProjectionMatrix();if(bloomPass)bloomPass.setSize(w,h);else if(bloomEnabled)initBloomPass(w,h);}
  return {render(slots,state){
    if(lost)return false;const started=performance.now();resize(state.width,state.height);
    if(wire!==!!state.wireframe){wire=!!state.wireframe;for(const m of active)m?.wireframe(wire);}
    // 自动 LOD 切换：如果用户没有手动设置，双花模式降至 medium，单花保持初始检测的 LOD
    const targetLOD=lodOverride||(state.duo>.5?'medium':lodInfo.detected);
    if(targetLOD!==lastLOD&&!lodOverride){setLOD(targetLOD);modelCache.clear();for(let i=0;i<2;i++){if(active[i])holders[i].remove(active[i].group);active[i]=null;types[i]=-1;}lastLOD=targetLOD;}
    const base=Math.min(width*.42,height*.6),duo=state.duo;
    const top=state.phone?58:width<760?108:76,bottom=state.phone?104:width<760?118:72;
    slots.forEach((s,i)=>{
      const visible=i===0||duo>.01;holders[i].visible=visible;if(!visible)return;
      if(types[i]!==s.type){if(active[i])holders[i].remove(active[i].group);const key=i+":"+s.type+":"+lastLOD;if(!modelCache.has(key))modelCache.set(key,buildFlower(specs[s.type],lastLOD));active[i]=modelCache.get(key);active[i].wireframe(wire);holders[i].add(active[i].group);types[i]=s.type;}
      const model=active[i],cx=width*(i===0?mix(.5,.29,duo):.71);
      const views={Lotus:49,Lily:29,Rose:47,Camellia:53,'Cherry Blossom':62};
      holders[i].rotation.set((views[specs[s.type].name]||45)*DEG+(s.pitch||0),s.yaw,0,'YXZ');
      const rotated=model.bounds.clone().applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(holders[i].rotation));
      const size=rotated.getSize(new THREE.Vector3()),center=rotated.getCenter(new THREE.Vector3());
      const scale=Math.min(base*mix(1.65,1.05,duo),Math.max(80,height-top-bottom)/Math.max(.01,size.y),width*mix(.82,.42,duo)/Math.max(.01,size.x));
      holders[i].scale.setScalar(scale);
      holders[i].position.set(cx-width/2-center.x*scale,height/2-(top+Math.max(80,height-top-bottom)/2)-center.y*scale,0);
      model.update(clamp(s.bloom));
    });
    // 渲染：如果启用 Bloom，渲染到纹理然后后处理；否则直接渲染到画布
    if(bloomPass&&bloomEnabled){
      renderer.setRenderTarget(renderTargetMain);
      renderer.render(scene,camera);
      bloomPass.render(renderTargetMain,renderTargetOutput);
      // 将后处理结果复制到画布
      renderer.setRenderTarget(null);
      const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({map:renderTargetOutput.texture}));
      const tempScene=new THREE.Scene();tempScene.add(quad);
      const tempCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
      renderer.render(tempScene,tempCamera);
      quad.geometry.dispose();quad.material.dispose();
    }else{
      renderer.render(scene,camera);
    }
    lastCost=performance.now()-started;
    if(lastCost>23||(state.frameMs>25&&state.frameMs<90))slowFrames++;else slowFrames=Math.max(0,slowFrames-1);
    if(slowFrames>45&&quality>1){quality=1;renderer.setPixelRatio(Math.min(originalDpr,quality));renderer.shadowMap.enabled=false;slowFrames=0;}
    return true;
  },stats(){return {engine:'WebGL2',triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,geometries:renderer.info.memory.geometries,renderMs:lastCost,pixelRatio:renderer.getPixelRatio(),models:types.slice(),cachedModels:modelCache.size,lod:lastLOD,lodDetected:lodInfo.detected,lodOverride:lodOverride,bloomEnabled:bloomEnabled};},dispose(){for(const model of modelCache.values())model.dispose();modelCache.clear();disposeBloomPass();renderer.dispose();},resetQuality(){quality=1.5;renderer.setPixelRatio(Math.min(originalDpr,quality));renderer.shadowMap.enabled=true;slowFrames=0;},setLODOverride(level){setLODOverride(level);if(level)localStorage.setItem('bloom.lod.override',level);else localStorage.removeItem('bloom.lod.override');modelCache.clear();for(let i=0;i<2;i++){if(active[i])holders[i].remove(active[i].group);active[i]=null;types[i]=-1;}lastLOD=currentLOD;},toggleBloom(enable){const newState=enable??!bloomEnabled;localStorage.setItem('bloom.postBloom',String(newState));if(newState&&!bloomPass)initBloomPass(width,height);if(bloomPass)bloomPass.enabled=newState;return newState;}};
}
