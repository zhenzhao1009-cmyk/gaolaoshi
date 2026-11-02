// One frame in flight. No accumulated camera queue or stale gestures.
export async function createHandTracker({createFallback,onResult,onError,workerFactory,bitmapFactory,timeoutMs=12000}={}) {
  const supported=workerFactory || (typeof Worker!=='undefined' && typeof OffscreenCanvas!=='undefined' && typeof createImageBitmap==='function');
  if(supported){
    let worker;
    try{
      worker=workerFactory?workerFactory():new Worker(new URL('./hand-tracker-worker.js',import.meta.url));
      const bitmap=bitmapFactory||createImageBitmap;
      let closed=false,busy=false,token=0,activeToken=0,lastSubmit=-Infinity,resetVersion=0,errors=0;
      const ready=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('Worker initialization timed out')),timeoutMs);
        worker.onmessage=({data})=>{if(data.type==='ready'){clearTimeout(timer);resolve(data);}else if(data.type==='init-error'){clearTimeout(timer);reject(Error(data.message));}};
        worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message||'Worker failed'));};
        worker.postMessage({type:'init'});
      });
      let meanCost=40;
      worker.onmessage=({data})=>{
        if(closed||data.token!==activeToken)return;
        if(data.type==='result'){
          busy=false;errors=0;meanCost=meanCost*.8+(data.cost||40)*.2;
          onResult?.(data.result,data.time);
        }else if(data.type==='frame-error'){busy=false;errors++;onError?.(Error(data.message),errors);}
      };
      worker.onerror=e=>{if(!closed){busy=false;onError?.(Error(e.message||'Worker failed'),3);}};
      return {mode:'worker',delegate:ready.delegate,
        detectForVideo(source,now){
          const interval=Math.max(33,Math.min(80,meanCost*1.1));
          if(closed||busy||now-lastSubmit<interval)return null;
          busy=true;lastSubmit=now;const version=resetVersion;activeToken=++token;
          let capture;
          try{capture=bitmap(source);}catch(error){busy=false;onError?.(error,++errors);return null;}
          Promise.resolve(capture).then(image=>{
            if(closed||version!==resetVersion){image.close?.();return;}
            try{worker.postMessage({type:'frame',image,time:now,token:activeToken},[image]);}
            catch(error){image.close?.();busy=false;onError?.(error,++errors);}
          }).catch(error=>{if(!closed&&version===resetVersion){busy=false;onError?.(error,++errors);}});
          return null;
        },reset(){resetVersion++;activeToken=++token;busy=false;lastSubmit=-Infinity;},
        close(){closed=true;resetVersion++;worker.terminate();},
        stats(){return {mode:'worker',busy,meanCost};}
      };
    }catch(error){worker?.terminate();}
  }
  const task=await createFallback();let last=-Infinity,cost=0;
  return {mode:'main',detectForVideo(source,now){if(now-last<Math.max(50,cost*1.5))return null;last=now;const started=performance.now();try{return task.detectForVideo(source,now);}finally{cost=performance.now()-started;}},reset(){last=-Infinity;},close(){task.close?.();},stats(){return {mode:'main',busy:false,meanCost:cost};}};
}
