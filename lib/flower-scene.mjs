import * as THREE from './vendor/three/three.module.js';

const DEG = Math.PI / 180;
const clamp = (x, a=0, b=1) => Math.max(a, Math.min(b, x));
const smooth = t => t*t*(3-2*t);
const mix = (a,b,t) => a+(b-a)*t;
const hash = n => { const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x); };
export const BLOOM_KEYS = [0,.2,.4,.6,.8,1];
const U=28,V=18;

// Closed, thin shells with real depth, not camera-facing planes or image cards.
export function buildPetalGeometry(spec, seed=0, animated=true) {
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
  for(let u=0;u<=U;u++)for(let v=0;v<=V;v++){
    const t=u/U,x=v/V*2-1;
    const color=root.clone().lerp(tip,Math.pow(t,.85)*.92);
    color.multiplyScalar(1-.023*Math.cos(x*9*Math.PI+t*2)-.018*x*x);
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
        const vein=.0018*Math.cos(x*9*Math.PI+t*2)*Math.sin(Math.PI*t);
        const cup=(spec.cup??.4)*w*x*x+vein+ripple;
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
function material(color,petal=false){return new THREE.MeshPhysicalMaterial({color,vertexColors:petal,side:THREE.DoubleSide,roughness:petal?.54:.65,metalness:0,sheen:petal?.72:.1,sheenRoughness:.8,sheenColor:new THREE.Color(petal?'#f4d9db':'#a5bc80'),clearcoat:.025,clearcoatRoughness:.8});}
function tube(points,radius,color,segments=16){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));return new THREE.Mesh(new THREE.TubeGeometry(curve,segments,radius,7,false),material(color));}
function leaf(parent,origin,angle,length=.25,width=.065){
  const geo=buildPetalGeometry({len:length,wid:width,t0:80,t1:80,curl:18,cup:.25,p:.5,q:.9,c0:'#698448',c1:'#294934',thickness:.002},angle,false);
  const mesh=new THREE.Mesh(geo,material('#ffffff',true));mesh.position.set(...origin);mesh.rotation.y=angle;mesh.rotation.z=.15;mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);
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
  if(type==='Lotus'){
    const pod=new THREE.Mesh(new THREE.CylinderGeometry(.083,.061,.052,32),material('#bdc66a'));pod.position.y=.047;group.add(pod);
    const seedGeo=new THREE.SphereGeometry(.007,8,6),seedMat=material('#6d8540');
    for(let i=0;i<11;i++){const a=i*2.39996,r=.063*Math.sqrt((i+.5)/11);const seed=new THREE.Mesh(seedGeo,seedMat);seed.scale.y=.28;seed.position.set(Math.cos(a)*r,.074,Math.sin(a)*r);group.add(seed);}
  }
  const lily=type==='Lily',n=lily?6:type==='Lotus'?38:type==='Cherry Blossom'?22:35;
  const filaments=new THREE.Group(),antherGeo=new THREE.SphereGeometry(1,8,6),antherMat=material(lily?'#aa5b28':'#e4b53a');
  const baseRadius=type==='Lotus'?.095:.018,height=lily?.29:type==='Lotus'?.075:.09;
  for(let i=0;i<n;i++){
    const a=i/n*Math.PI*2+(hash(i)-.5)*.12,r=baseRadius+(lily?.13:.045),h=height*(.86+hash(i+7)*.24);
    const end=[Math.cos(a)*r,h,Math.sin(a)*r];
    filaments.add(tube([[Math.cos(a)*baseRadius,0,Math.sin(a)*baseRadius],[end[0]*.7,h*.64,end[2]*.7],end],lily?.0023:.0015,lily?'#d8dda7':'#f0d88c',8));
    const anther=new THREE.Mesh(antherGeo,antherMat);anther.position.set(...end);anther.scale.set(lily?.018:.0045,lily?.006:.005,lily?.007:.0045);anther.rotation.y=-a;filaments.add(anther);
  }
  if(lily){filaments.add(tube([[0,0,0],[.005,.18,0],[.014,.35,.008]],.004,'#becd90',12));const tip=new THREE.Mesh(new THREE.SphereGeometry(.009,10,8),material('#b1c47c'));tip.position.set(.014,.35,.008);filaments.add(tip);}
  group.add(filaments);
  mergeRigidMeshes(group);
}

export function buildFlower(spec) {
  const group=new THREE.Group(),petals=[],centers=[],resources=new Set();
  const type=spec.name;
  let layers=spec.layers.map(x=>({...x}));
  if(type==='Lotus')layers=[{n:10,len:.60,wid:.18,p:.68,q:.88,t0:9,t1:88,curl:15,cup:.5,c0:'#d57b97',c1:'#fbefec',delay:0},{n:9,len:.55,wid:.18,p:.68,q:.9,t0:6,t1:66,curl:10,cup:.52,c0:'#e38aa1',c1:'#fff2ed',delay:.06,twist:18},{n:7,len:.44,wid:.15,p:.65,q:.86,t0:5,t1:43,curl:5,cup:.56,c0:'#e49ab0',c1:'#fff4ec',delay:.12,twist:6},{n:5,len:.30,wid:.11,p:.68,q:.9,t0:4,t1:24,curl:4,cup:.6,c0:'#e9a2b5',c1:'#fff6ed',delay:.17,twist:30}];
  if(type==='Camellia')layers=layers.map((ly,i)=>({...ly,c0:['#fcf4e8','#fff8ee','#f8ecdc'][i],c1:'#e3d5bc',ruffle:.055}));
  const blossom=(parent,variant=0)=>{
    layers.forEach((ly,li)=>{
      const geo=buildPetalGeometry(ly,li*7+variant),mat=material('#ffffff',true);resources.add(geo);resources.add(mat);
      for(let i=0;i<ly.n;i++){
        const seed=li*37+i*13+variant*101,j=hash(seed)-.5;
        const mesh=new THREE.Mesh(geo,mat);mesh.rotation.y=(i/ly.n*Math.PI*2+(ly.twist||0)*DEG+j*.16);
        mesh.scale.set(1+j*.035,1+j*.07,1+j*.08);mesh.position.y=li*.007;mesh.frustumCulled=false;mesh.castShadow=mesh.receiveShadow=true;
        parent.add(mesh);petals.push({mesh,delay:variant*.065});
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
    if(type==='Lily'){leaf(group,[-.01,-.30,0],.5,.29,.045);leaf(group,[0,-.48,0],3.1,.25,.04);}
    if(type==='Rose'){leaf(group,[-.01,-.34,0],-.5,.24,.075);leaf(group,[.005,-.45,0],2.8,.20,.06);}
    if(type==='Camellia'){leaf(group,[0,-.15,-.04],.25,.31,.10);leaf(group,[-.01,-.23,-.035],3.1,.26,.09);}
  }
  const model={group,petals,centers,lastBloom:NaN,update(bloom){
    const b=clamp(bloom);if(Math.abs(b-this.lastBloom)<.00005)return;this.lastBloom=b;
    const cache=new Map();
    for(const p of petals){if(!cache.has(p.delay))cache.set(p.delay,bloomWeights(clamp((b-p.delay)/(1-p.delay))));const w=cache.get(p.delay);for(let k=0;k<5;k++)p.mesh.morphTargetInfluences[k]=w[k];}
    for(const c of centers)c.scale.setScalar(.8+.2*b);
  },wireframe(on){group.traverse(o=>{if(o.isMesh&&o.material)o.material.wireframe=on;});},dispose(){const geometries=new Set(),materials=new Set();group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}};
  model.update(.68);
  model.bounds=new THREE.Box3().setFromObject(group);
  return model;
}

export function createFlowerScene(canvas,specs) {
  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
  renderer.setClearColor(0x000000,0);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,4000);camera.position.set(0,0,1500);
  scene.add(new THREE.HemisphereLight(0xfff4e4,0x7c9277,2.0));
  const key=new THREE.DirectionalLight(0xffeddb,3.0);key.position.set(-500,800,1000);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.bias=-.00015;key.shadow.normalBias=.45;key.shadow.camera.near=100;key.shadow.camera.far=2500;scene.add(key);
  const fill=new THREE.DirectionalLight(0xdce8ff,.85);fill.position.set(650,180,600);scene.add(fill);
  const rim=new THREE.DirectionalLight(0xffd5dc,1.0);rim.position.set(100,400,-800);scene.add(rim);
  const holders=[new THREE.Group(),new THREE.Group()];holders.forEach(g=>scene.add(g));
  const modelCache=new Map();
  const active=[null,null],types=[-1,-1];let width=0,height=0,quality=1.5,wire=false,lost=false,lastCost=0,slowFrames=0;
  const originalDpr=Math.min(globalThis.devicePixelRatio||1,1.75);
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;});
  canvas.addEventListener('webglcontextrestored',()=>{lost=false;});
  function resize(w,h){if(w===width&&h===height)return;width=w;height=h;renderer.setPixelRatio(Math.min(originalDpr,quality));renderer.setSize(w,h,false);camera.left=-w/2;camera.right=w/2;camera.top=h/2;camera.bottom=-h/2;camera.updateProjectionMatrix();const extent=Math.max(w,h)*.7;Object.assign(key.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent});key.shadow.camera.updateProjectionMatrix();}
  return {render(slots,state){
    if(lost)return false;const started=performance.now();resize(state.width,state.height);
    if(wire!==!!state.wireframe){wire=!!state.wireframe;for(const m of active)m?.wireframe(wire);}
    const base=Math.min(width*.42,height*.6),duo=state.duo;
    const top=state.phone?58:width<760?108:76,bottom=state.phone?104:width<760?118:72;
    slots.forEach((s,i)=>{
      const visible=i===0||duo>.01;holders[i].visible=visible;if(!visible)return;
      if(types[i]!==s.type){if(active[i])holders[i].remove(active[i].group);const key=i+":"+s.type;if(!modelCache.has(key))modelCache.set(key,buildFlower(specs[s.type]));active[i]=modelCache.get(key);active[i].wireframe(wire);holders[i].add(active[i].group);types[i]=s.type;}
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
    renderer.render(scene,camera);lastCost=performance.now()-started;
    if(lastCost>23||(state.frameMs>25&&state.frameMs<90))slowFrames++;else slowFrames=Math.max(0,slowFrames-1);
    if(slowFrames>45&&quality>1){quality=1;renderer.setPixelRatio(Math.min(originalDpr,quality));renderer.shadowMap.enabled=false;slowFrames=0;}
    return true;
  },stats(){return {engine:'WebGL2',triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,geometries:renderer.info.memory.geometries,renderMs:lastCost,pixelRatio:renderer.getPixelRatio(),models:types.slice(),cachedModels:modelCache.size};},dispose(){for(const model of modelCache.values())model.dispose();modelCache.clear();renderer.dispose();},resetQuality(){quality=1.5;renderer.setPixelRatio(Math.min(originalDpr,quality));renderer.shadowMap.enabled=true;slowFrames=0;}};
}
