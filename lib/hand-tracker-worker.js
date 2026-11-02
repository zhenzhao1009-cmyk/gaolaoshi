// Classic worker: MediaPipe's WASM loader uses importScripts().
let task=null,busy=false,lastTime=-1;
self.onmessage=async({data})=>{
  if(data.type==='init'){
    try{
      const {FilesetResolver,HandLandmarker}=await import('./vision_bundle.mjs');
      const fileset=await FilesetResolver.forVisionTasks(new URL('./wasm',self.location.href).href);
      const options={baseOptions:{modelAssetPath:new URL('../models/hand_landmarker.task',self.location.href).href,delegate:'GPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.5,minHandPresenceConfidence:.3,minTrackingConfidence:.3};
      try{task=await HandLandmarker.createFromOptions(fileset,options);}catch(error){options.baseOptions.delegate='CPU';task=await HandLandmarker.createFromOptions(fileset,options);}
      self.postMessage({type:'ready',delegate:options.baseOptions.delegate});
    }catch(error){self.postMessage({type:'init-error',message:String(error)});}
    return;
  }
  if(data.type==='frame'){
    const image=data.image;
    if(!task||busy){image?.close?.();return;}
    busy=true;const started=performance.now();
    try{const time=Math.max(data.time,lastTime+.01);lastTime=time;const result=task.detectForVideo(image,time);self.postMessage({type:'result',token:data.token,time,cost:performance.now()-started,result:{landmarks:result.landmarks,handedness:result.handedness}});}
    catch(error){self.postMessage({type:'frame-error',token:data.token,message:String(error)});}
    finally{image?.close?.();busy=false;}
  }
};
