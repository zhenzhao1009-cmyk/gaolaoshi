import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {buildFlower,bloomWeights} from '../lib/flower-scene.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=await fs.readFile(path.join(root,'index.html'),'utf8');
const config=html.slice(html.indexOf('const P ='),html.indexOf('/* ---------- One Euro'));
const specs=vm.runInNewContext(config+';FLOWERS');
export function encodeGLB(model,name){
 const document={asset:{version:'2.0',generator:'Bloom procedural volumetric flower model'},scene:0,scenes:[{nodes:[0]}],nodes:[],meshes:[],materials:[],accessors:[],bufferViews:[],buffers:[{byteLength:0}],animations:[]};
 const chunks=[],geometryCache=new Map(),materialCache=new Map(),meshCache=new Map();let byteLength=0;
 const add=(array,itemSize,type,bounds=false,target)=>{
   const padded=(4-array.byteLength%4)%4,bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength);const view=document.bufferViews.length;
   document.bufferViews.push({buffer:0,byteOffset:byteLength,byteLength:bytes.length,...(target?{target}:{})});chunks.push(bytes,Buffer.alloc(padded));byteLength+=bytes.length+padded;
   const componentType=array instanceof Float32Array?5126:array instanceof Uint32Array?5125:5123;
   const accessor={bufferView:view,componentType,count:array.length/itemSize,type};
   if(bounds){accessor.min=Array(itemSize).fill(Infinity);accessor.max=Array(itemSize).fill(-Infinity);for(let i=0;i<array.length;i++){const c=i%itemSize;accessor.min[c]=Math.min(accessor.min[c],array[i]);accessor.max[c]=Math.max(accessor.max[c],array[i]);}}
   document.accessors.push(accessor);return document.accessors.length-1;
 };
 const geometry=(g)=>{
   if(geometryCache.has(g))return geometryCache.get(g);
   const attributes={};for(const [key,semantic]of [['position','POSITION'],['normal','NORMAL'],['color','COLOR_0']]){const a=g.getAttribute(key);if(a)attributes[semantic]=add(a.array,a.itemSize,'VEC3',key==='position',34962);}
   const primitive={attributes,indices:add(g.index.array,1,'SCALAR',false,34963)};
   if(g.morphAttributes.position?.length){primitive.targets=g.morphAttributes.position.map((p,i)=>{const target={};for(const [key,semantic]of [['position','POSITION'],['normal','NORMAL']]){const base=g.getAttribute(key).array,source=g.morphAttributes[key][i].array,delta=new Float32Array(source.length);for(let j=0;j<delta.length;j++)delta[j]=source[j]-base[j];target[semantic]=add(delta,3,'VEC3',key==='position',34962);}return target;});}
   geometryCache.set(g,primitive);return primitive;
 };
 const material=(m)=>{if(materialCache.has(m))return materialCache.get(m);const i=document.materials.length;document.materials.push({name:'Procedural petal material',doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[m.color.r,m.color.g,m.color.b,1],metallicFactor:0,roughnessFactor:m.roughness??.6}});materialCache.set(m,i);return i;};
 const time=add(new Float32Array([0,1,2,3,4,5,6,7,8,9,10]),1,'SCALAR',true),samplers=[],channels=[];
 const visit=(object)=>{
   object.updateMatrix();const index=document.nodes.length,node={name:object.name||name,matrix:object.matrix.toArray()};document.nodes.push(node);
   if(object.isMesh){const key=object.geometry.uuid+object.material.uuid;if(!meshCache.has(key)){const primitive={...geometry(object.geometry),material:material(object.material)};const mesh={primitives:[primitive]};if(primitive.targets)mesh.weights=Array(primitive.targets.length).fill(0);meshCache.set(key,document.meshes.length);document.meshes.push(mesh);}node.mesh=meshCache.get(key);
     if(object.morphTargetInfluences?.length){node.weights=object.morphTargetInfluences.slice();const values=[];for(let k=0;k<=10;k++)values.push(...bloomWeights((k<=5?k:10-k)/5));const output=add(new Float32Array(values),1,'SCALAR');const sampler=samplers.length;samplers.push({input:time,output,interpolation:'LINEAR'});channels.push({sampler,target:{node:index,path:'weights'}});}
   }
   if(object.children.length)node.children=object.children.map(visit);return index;
 };
 visit(model.group);if(channels.length)document.animations.push({name:'Bloom open and close',samplers,channels});
 document.buffers[0].byteLength=byteLength;
 const json=Buffer.from(JSON.stringify(document)),jsonPad=Buffer.alloc((4-json.length%4)%4,0x20),binary=Buffer.concat(chunks),jsonChunk=Buffer.concat([json,jsonPad]);
 const header=Buffer.alloc(12),jh=Buffer.alloc(8),bh=Buffer.alloc(8);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+jsonChunk.length+8+binary.length,8);jh.writeUInt32LE(jsonChunk.length,0);jh.writeUInt32LE(0x4e4f534a,4);bh.writeUInt32LE(binary.length,0);bh.writeUInt32LE(0x004e4942,4);
 return Buffer.concat([header,jh,jsonChunk,bh,binary]);
}
await fs.mkdir(path.join(root,'models/flowers'),{recursive:true});
const ids=['lotus','lily','rose','camellia','sakura'];
for(let i=0;i<specs.length;i++){const model=buildFlower(specs[i]);const data=encodeGLB(model,specs[i].chinese);await fs.writeFile(path.join(root,'models/flowers',ids[i]+'.glb'),data);console.log(ids[i]+'.glb '+data.length+' bytes');model.dispose();}
