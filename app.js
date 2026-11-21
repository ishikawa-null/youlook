const $ = id => document.getElementById(id);
const out = $('output'), ctx = out.getContext('2d', {alpha:false});
const cameraVideo = $('source');
let fileVideo, kind='camera', cameraStream=null, facing='environment', mode='video', strength=.6;
let waveText='I am System Engineer', waveColor='#00b1b1', textColor='#f7afdd', frameColor='#f7afdd';
const waveLayer=document.createElement('canvas');let waveDirty=true;
function buildWave(){
 const w=out.width,h=out.height;waveLayer.width=w;waveLayer.height=h;const c=waveLayer.getContext('2d');
 const waveY=x=>h*.79+h*.033*Math.cos(x/w*Math.PI*10);
 c.fillStyle=waveColor;c.beginPath();c.moveTo(0,h);for(let x=0;x<=w;x+=2)c.lineTo(x,waveY(x));c.lineTo(w,h);c.closePath();c.fill();
 if(waveText){let size=h*.073;c.font=`${size}px WaveDot, monospace`;const total=c.measureText(waveText).width;if(total>w*.86)size*=w*.86/total;
 c.font=`${size}px WaveDot, monospace`;c.fillStyle=textColor;c.strokeStyle=textColor;c.lineWidth=Math.max(.4,size*.025);c.textBaseline='alphabetic';
 let x=(w-c.measureText(waveText).width)/2;for(const char of Array.from(waveText)){const width=c.measureText(char).width,y=waveY(x+width/2)-size*.12;c.fillText(char,x,y);c.strokeText(char,x,y);x+=width;}}
 waveDirty=false;
}
function saveWave(){try{localStorage.setItem('youlook.wave',JSON.stringify({waveText,waveColor,textColor,frameColor}));}catch{}}

let frame='none', customImage=null, cameraBusy=false, recording=false, finalizing=false;
let recorder=null, recordingStream=null, micStream=null, chunks=[], bytes=0, started=0, recordTimer=null;
let resultFile=null, resultURL=null, inputURL=null, fileLoaded=false, audioContext=null, audioNode=null, audioDest=null, wakeLock=null;
let lastTick=0, drawFailed=false;
const shaderCanvas=document.createElement('canvas');
const gl=shaderCanvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});
let program, texture, uniforms;
function status(t){$('status').textContent=t;}
function error(t){status(t);}
function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
function initGL(){
 if(!gl)return;
 program=gl.createProgram();
 gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 pos; varying vec2 uv; void main(){uv=(pos+1.0)*0.5;gl_Position=vec4(pos,0.0,1.0);}'));
 gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`precision mediump float;
 varying vec2 uv; uniform sampler2D image; uniform float amount; uniform vec2 crop; uniform float aspect; uniform float mirror;
 void main(){vec2 p=(uv-0.5)*vec2(aspect,1.0);float r2=dot(p,p)/(0.25*(aspect*aspect+1.0));float s=(1.0+amount*r2)/(1.0+amount);vec2 q=(uv-0.5)*s*crop+0.5;q.x=mix(q.x,1.0-q.x,mirror);gl_FragColor=texture2D(image,q);}`));
 gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('魚眼処理を初期化できません。');gl.useProgram(program);
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
 const p=gl.getAttribLocation(program,'pos');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
 texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);uniforms={};for(const n of ['amount','crop','aspect','mirror'])uniforms[n]=gl.getUniformLocation(program,n);
}
const demo=document.createElement('canvas');demo.width=1280;demo.height=960;
function drawDemo(){
 const d=demo.getContext('2d');d.fillStyle='#d8f2ee';d.fillRect(0,0,1280,960);
 d.strokeStyle='#a5d5d2';d.lineWidth=3;
 for(let x=0;x<1280;x+=100){d.beginPath();d.moveTo(x,0);d.lineTo(x,960);d.stroke();}
 for(let y=0;y<960;y+=100){d.beginPath();d.moveTo(0,y);d.lineTo(1280,y);d.stroke();}
 d.fillStyle='#f7afdd';d.beginPath();d.ellipse(660,440,235,180,0,0,Math.PI*2);d.fill();
 d.beginPath();d.moveTo(450,440);d.lineTo(285,320);d.lineTo(285,560);d.closePath();d.fill();
 d.fillStyle='#073c42';d.beginPath();d.arc(735,405,15,0,Math.PI*2);d.fill();
 d.strokeStyle='#073c42';d.lineWidth=8;d.beginPath();d.arc(775,445,34,.2,1.5);d.stroke();
 d.fillStyle='#fff';for(const [x,y,r] of [[1000,240,32],[1050,130,19],[170,730,30]]){d.beginPath();d.arc(x,y,r,0,Math.PI*2);d.fill();}
}
drawDemo();
function setSize(ratio){if(recording||finalizing)return;ratio=Math.max(.4,Math.min(2.5,ratio));let w,h;if(ratio>=1){w=gl?1280:640;h=Math.round(w/ratio/2)*2;}else{h=gl?1280:640;w=Math.round(h*ratio/2)*2;}out.width=w;out.height=h;waveDirty=true;shaderCanvas.width=w;shaderCanvas.height=h;$('viewfinder').style.aspectRatio=`${w} / ${h}`;if(gl)gl.viewport(0,0,w,h);}
function presetFrame(){
 const w=out.width,h=out.height,u=Math.min(w,h);
 if(frame==='wave'){
  ctx.strokeStyle=frameColor;ctx.lineWidth=u*.018;ctx.lineJoin='round';ctx.lineCap='round';const m=u*.025,amp=u*.009;
  ctx.beginPath();for(let x=m;x<=w-m;x+=3){const y=m+Math.sin((x-m)/u*50)*amp;x===m?ctx.moveTo(x,y):ctx.lineTo(x,y);}for(let y=m;y<=h-m;y+=3)ctx.lineTo(w-m+Math.sin((y-m)/u*50)*amp,y);for(let x=w-m;x>=m;x-=3)ctx.lineTo(x,h-m+Math.sin((x-m)/u*50)*amp);for(let y=h-m;y>=m;y-=3)ctx.lineTo(m+Math.sin((y-m)/u*50)*amp,y);ctx.closePath();ctx.stroke();
 }else if(frame==='check'){
  const size=u*.027;for(let x=0;x<w;x+=size)for(let y=0;y<h;y+=size){if(x<size*1.5||y<size*1.5||x>w-size*2||y>h-size*2){ctx.fillStyle=(Math.round(x/size)+Math.round(y/size))%2?'#f7afdd':'#03b6b6';ctx.fillRect(x,y,size+1,size+1);}}
 }else if(frame==='supplied'){if(waveDirty)buildWave();ctx.drawImage(waveLayer,0,0,w,h);
 }else if(frame==='custom'&&customImage){ctx.drawImage(customImage,0,0,w,h);}
}
// Canvas fallback for browsers without a WebGL context.
function renderMesh(source,sw,sh,crop){
 const w=out.width,h=out.height,ar=w/h,cols=14,rows=Math.max(8,Math.round(cols/ar));
 const point=(x,y)=>{const u=x/w-.5,v=y/h-.5,r2=(u*u*ar*ar+v*v)/(.25*(ar*ar+1)),s=(1+strength*r2)/(1+strength);let sx=u*s*crop[0]+.5;if(kind==='camera'&&cameraStream&&facing==='user')sx=1-sx;return [sx*sw,(v*s*crop[1]+.5)*sh];};
 const tri=(a,b,c)=>{const A=point(...a),B=point(...b),C=point(...c);const sx1=B[0]-A[0],sy1=B[1]-A[1],sx2=C[0]-A[0],sy2=C[1]-A[1],det=sx1*sy2-sx2*sy1;if(Math.abs(det)<.001)return;
 const dx1=b[0]-a[0],dy1=b[1]-a[1],dx2=c[0]-a[0],dy2=c[1]-a[1];const aa=(dx1*sy2-dx2*sy1)/det,bb=(dy1*sy2-dy2*sy1)/det,cc=(dx2*sx1-dx1*sx2)/det,dd=(dy2*sx1-dy1*sx2)/det;
 ctx.save();ctx.beginPath();const mx=(a[0]+b[0]+c[0])/3,my=(a[1]+b[1]+c[1])/3;for(const [i,p]of [a,b,c].entries()){const x=mx+(p[0]-mx)*1.02,y=my+(p[1]-my)*1.02;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.closePath();ctx.clip();ctx.transform(aa,bb,cc,dd,a[0]-aa*A[0]-cc*A[1],a[1]-bb*A[0]-dd*A[1]);const minX=Math.max(0,Math.floor(Math.min(A[0],B[0],C[0])-2)),minY=Math.max(0,Math.floor(Math.min(A[1],B[1],C[1])-2));const bw=Math.min(sw-minX,Math.ceil(Math.max(A[0],B[0],C[0])+2)-minX),bh=Math.min(sh-minY,Math.ceil(Math.max(A[1],B[1],C[1])+2)-minY);ctx.drawImage(source,minX,minY,bw,bh,minX,minY,bw,bh);ctx.restore();};
 ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
 for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const a=[x*w/cols,y*h/rows],b=[(x+1)*w/cols,y*h/rows],c=[x*w/cols,(y+1)*h/rows],d=[(x+1)*w/cols,(y+1)*h/rows];tri(a,b,c);tri(b,d,c);}
}
function render(){
 if(drawFailed)return;
 const source=kind==='file'&&fileLoaded&&fileVideo.readyState>=2?fileVideo:kind==='camera'&&cameraStream&&cameraVideo.readyState>=2?cameraVideo:demo;
 const sw=source.videoWidth||source.width,sh=source.videoHeight||source.height;if(!sw||!sh)return;
 const ratio=out.width/out.height,sr=sw/sh,crop=sr>ratio?[ratio/sr,1]:[1,sr/ratio];
 try{
  if(!gl){renderMesh(source,sw,sh,crop);presetFrame();return;}
  gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
  gl.uniform1f(uniforms.amount,strength);gl.uniform2f(uniforms.crop,...crop);gl.uniform1f(uniforms.aspect,ratio);gl.uniform1f(uniforms.mirror,kind==='camera'&&cameraStream&&facing==='user'?1:0);gl.drawArrays(gl.TRIANGLES,0,6);
  ctx.drawImage(shaderCanvas,0,0);presetFrame();
 }catch(e){drawFailed=true;error('映像処理が止まりました。ページを開き直してください。');if(recording)stopRecording();}
}
function loop(t){if(t-lastTick>=1000/30){render();lastTick=t;}requestAnimationFrame(loop);}
function live(){return kind==='file'?fileLoaded&&fileVideo.readyState>=2:!!cameraStream&&cameraVideo.readyState>=2;}
function refresh(){
 const locked=recording||finalizing||cameraBusy;
 $('shutter').disabled=!live()||cameraBusy||finalizing||drawFailed;
 $('shutter').classList.toggle('recording',recording);$('shutter').classList.toggle('photo',mode==='photo');
 $('shutter').setAttribute('aria-label',recording?'録画・書き出し停止':kind==='file'?(mode==='photo'?'この場面を写真にする':'動画を書き出す'):mode==='photo'?'写真を撮る':'録画開始');
 $('flip').disabled=locked||kind!=='camera';
 $('cameraChoices').hidden=kind!=='camera';for(const [id,side] of [['frontCamera','user'],['backCamera','environment']]){$(id).disabled=locked;$(id).setAttribute('aria-pressed',String(facing===side));}
 for(const id of ['waveText','waveColor','textColor','resetWave','frameColor','resetFrame'])$(id).disabled=locked;
 for(const id of ['ratio','upload','mic','cameraTab','fileTab','removeFrame','pauseCamera','playFile','seek'])if($(id))$(id).disabled=locked;
 document.querySelectorAll('[data-frame],[data-mode]').forEach(b=>b.disabled=locked);
 $('strength').disabled=kind==='file'&&locked;
 $('start').hidden=kind==='file'?fileLoaded:!!cameraStream;
 $('start').disabled=cameraBusy||finalizing;
 $('pauseCamera').hidden=!cameraStream||kind==='file';
 $('mic').parentElement.hidden=mode==='photo'||kind==='file';
 $('fileControls').hidden=kind!=='file'||!fileLoaded;
 $('cameraTab').classList.toggle('active',kind==='camera');$('fileTab').classList.toggle('active',kind==='file');
 $('previewLabel').textContent=kind==='file'?'VIDEO PREVIEW':cameraStream?'LIVE CAMERA':'TRY THE FISHEYE';
 $('cameraState').textContent=kind==='file'?'既存動画に、魚眼とフレーム。':cameraStream?(facing==='user'?'内カメラ · 左右反転で保存':'外カメラ'):'まずはデモで、ぐにゃっと。';
}
function stopCamera(){cameraVideo.pause();if(cameraStream)cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;cameraVideo.srcObject=null;refresh();}
async function startCamera(requested=facing){
 if(cameraBusy||recording||finalizing)return;cameraBusy=true;kind='camera';if(fileVideo)fileVideo.pause();refresh();status('カメラを準備しています…');
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('SafariでこのURLを直接開いてください。');
  stopCamera();
  const videoOptions={width:{ideal:1280},height:{ideal:960},frameRate:{ideal:30,max:30}};
  let stream,usedFallback=false;
  try{stream=await navigator.mediaDevices.getUserMedia({video:{...videoOptions,facingMode:{exact:requested}},audio:false});}
  catch(e){if(e.name!=='OverconstrainedError'&&e.name!=='NotFoundError')throw e;usedFallback=true;stream=await navigator.mediaDevices.getUserMedia({video:{...videoOptions,facingMode:{ideal:requested}},audio:false});}
  const actual=stream.getVideoTracks()[0].getSettings().facingMode;facing=actual==='user'||actual==='environment'?actual:requested;
  if(document.hidden){stream.getTracks().forEach(t=>t.stop());throw new Error('画面に戻ってからカメラをひらいてください。');}
  cameraStream=stream;cameraVideo.srcObject=stream;await cameraVideo.play();
  stream.getVideoTracks()[0].addEventListener('ended',()=>{if(recording)stopRecording();cameraStream=null;refresh();status('カメラが停止しました。もう一度ひらいてください。');});
  status(usedFallback&&(!actual||actual!==requested)?'指定したカメラが見つからないため、利用できるカメラを開きました。':`${facing==='user'?'インカメ':'外カメ'}を開きました。見えている映像がそのまま保存されます。`);
 }catch(e){stopCamera();const m=e.name==='NotAllowedError'?'カメラが許可されていません。Safariのサイト設定でカメラを許可して、もう一度お試しください。':e.name==='NotFoundError'?'カメラが見つかりません。「動画を読み込む」も使えます。':e.message;error(m);}
 finally{cameraBusy=false;refresh();}
}
function setFrame(name){frame=name;$('waveEditor').hidden=name!=='supplied';$('frameEditor').hidden=name!=='wave';if(name==='supplied'){setSize(16/9);$('ratio').value='1.7777777778';}$('customFrame').hidden=name!=='custom';document.querySelectorAll('[data-frame]').forEach(b=>{b.classList.toggle('selected',b.dataset.frame===name);b.setAttribute('aria-pressed',String(b.dataset.frame===name));});}
async function importFrame(file){
 if(!file||recording||finalizing)return;
 if(file.size>15*1024*1024){error('フレームは15MB以下の画像を選んでください。');return;}
 const url=URL.createObjectURL(file);const img=new Image();
 try{img.src=url;await img.decode();if(!img.width||!img.height)throw new Error();
  const scale=Math.min(1,4096/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);const x=c.getContext('2d');x.drawImage(img,0,0,c.width,c.height);customImage=c;
  setFrame('custom');$('frameName').textContent=file.name;
  const ratio=img.width/img.height;setSize(ratio);let option=$('ratio').querySelector('[data-custom]');if(!option){option=document.createElement('option');option.dataset.custom='true';$('ratio').append(option);}option.value=ratio;option.textContent='枠に合わせる';$('ratio').value=String(ratio);
  const sample=document.createElement('canvas');sample.width=32;sample.height=32;const sx=sample.getContext('2d');sx.drawImage(c,0,0,32,32);const pixels=sx.getImageData(0,0,32,32).data;let transparent=false;for(let i=3;i<pixels.length;i+=4)if(pixels[i]<250){transparent=true;break;}
  status(transparent?'フレームを追加しました。透明なところに映像が入ります。':'この画像に透明部分が見つかりません。映像を見せるには中央が透明なPNGを使ってください。');
 }catch{error('画像を読み込めませんでした。PNG・JPEG・WebPでお試しください。');}finally{URL.revokeObjectURL(url);$('frameFile').value='';}
}
function fileReady(file){
 if(!file||recording||finalizing)return;
 if(file.size>350*1024*1024){error('動画は350MB以下・3分以内で選んでください。');return;}
 stopCamera();if(inputURL)URL.revokeObjectURL(inputURL);fileLoaded=false;kind='file';inputURL=URL.createObjectURL(file);fileVideo.src=inputURL;fileVideo.load();status('動画を読み込んでいます…');refresh();
}
function showResult(blob,name){
 if(!blob||!blob.size){error('保存データを作れませんでした。短い動画でお試しください。');return;}
 if(resultURL)URL.revokeObjectURL(resultURL);resultFile=new File([blob],name,{type:blob.type});resultURL=URL.createObjectURL(blob);
 const el=document.createElement(blob.type.startsWith('video/')?'video':'img');el.src=resultURL;if(el.tagName==='VIDEO'){el.controls=true;el.playsInline=true;}else el.alt='撮影した写真';
 $('resultMedia').replaceChildren(el);$('download').href=resultURL;$('download').download=name;$('resultInfo').textContent=`${out.width} × ${out.height} · ${(blob.size/1024/1024).toFixed(1)} MB`;
 $('lastResult').disabled=false;$('resultDialog').showModal();status('できました！保存・共有から受け取ってください。');
}
function photo(){render();out.toBlob(b=>showResult(b,`youlook-${Date.now()}.png`),'image/png');}
async function lockScreen(){try{wakeLock=await navigator.wakeLock?.request('screen');}catch{}}
function cleanupRecord(){
 clearInterval(recordTimer);recordTimer=null;recordingStream?.getTracks().forEach(t=>t.stop());recordingStream=null;micStream?.getTracks().forEach(t=>t.stop());micStream=null;
 if(audioNode)try{audioNode.disconnect();}catch{}audioDest=null;wakeLock?.release().catch(()=>{});wakeLock=null;
 if(kind==='file')fileVideo.pause();$('timer').hidden=true;recording=false;finalizing=false;recorder=null;refresh();
}
async function beginRecording(){
 if(recording||finalizing||cameraBusy)return;
 if(!window.MediaRecorder||!out.captureStream){error('このブラウザは動画保存に対応していません。Safariで開くか、写真モードをお試しください。');return;}
 finalizing=true;refresh();status(kind==='file'?'書き出しを準備しています…':'録画を準備しています…');
 try{
  render();recordingStream=out.captureStream(30);
  if(kind==='file'){
   if(!audioContext)audioContext=new (window.AudioContext||window.webkitAudioContext)();await audioContext.resume();
   if(!audioNode)audioNode=audioContext.createMediaElementSource(fileVideo);
   audioDest=audioContext.createMediaStreamDestination();audioNode.connect(audioDest);audioDest.stream.getAudioTracks().forEach(t=>recordingStream.addTrack(t));
   fileVideo.muted=false;fileVideo.currentTime=0;
   if(fileVideo.seeking)await new Promise(resolve=>fileVideo.addEventListener('seeked',resolve,{once:true}));render();
  }else if($('mic').checked){
   micStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});micStream.getAudioTracks().forEach(t=>recordingStream.addTrack(t));
  }
  if(document.hidden)throw new Error('画面を開いたままで撮影・書き出ししてください。');
  const mime=['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp8,opus','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
  recorder=new MediaRecorder(recordingStream,{...(mime?{mimeType:mime}:{}),videoBitsPerSecond:6000000});chunks=[];bytes=0;
  recorder.ondataavailable=e=>{if(e.data.size){chunks.push(e.data);bytes+=e.data.size;if(bytes>200*1024*1024&&recording){status('容量の上限に達したので保存します。');stopRecording();}}};
  recorder.onerror=()=>{cleanupRecord();error('録画に失敗しました。短い動画でお試しください。');};
  recorder.onstop=()=>{const type=chunks[0]?.type||mime||'video/webm';const blob=new Blob(chunks,{type});chunks=[];cleanupRecord();showResult(blob,`youlook-${Date.now()}.${type.includes('mp4')?'mp4':'webm'}`);};
  recorder.start(1000);recording=true;finalizing=false;started=performance.now();$('timer').textContent='● 00:00';$('timer').hidden=false;refresh();lockScreen();
  if(kind==='file')await fileVideo.play();
  status(kind==='file'?'書き出し中。この画面を開いたままお待ちください。':'録画中。もう一度押すと停止します。');
  recordTimer=setInterval(()=>{const s=Math.floor((performance.now()-started)/1000);$('timer').textContent=`● ${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;if(s>=180)stopRecording();},250);
 }catch(e){if(recorder?.state==='recording'){stopRecording();}else cleanupRecord();error(e.name==='NotAllowedError'?'マイクが許可されませんでした。「音声あり」を外すと無音で撮影できます。':`録画を開始できませんでした。${e.message||''}`);}
}
function stopRecording(){if(!recorder||recorder.state!=='recording')return;recording=false;finalizing=true;recorder.stop();if(kind==='file')fileVideo.pause();status('保存データを作っています…');refresh();}
async function share(){if(!resultFile)return;try{if(navigator.canShare?.({files:[resultFile]}))await navigator.share({files:[resultFile],title:'ゆるっく'});else{$('download').click();}}catch(e){if(e.name!=='AbortError')error('共有できませんでした。「ファイルをダウンロード」をお試しください。');}}
function init(){
 fileVideo=$('fileSource');initGL();setSize(4/3);requestAnimationFrame(loop);
 $('strength').oninput=e=>{strength=Number(e.target.value)/100;$('strengthValue').value=e.target.value;e.target.style.setProperty('--progress',`${Number(e.target.value)/1.2}%`);};
 $('ratio').onchange=e=>setSize(Number(e.target.value));$('start').onclick=()=>kind==='file'?$('videoFile').click():startCamera();
 $('cameraTab').onclick=()=>{if(recording||finalizing)return;kind='camera';fileVideo.pause();refresh();status('「カメラをひらく」で撮影できます。');};
 $('fileTab').onclick=()=>{if(recording||finalizing)return;$('videoFile').click();};$('videoFile').onchange=e=>{fileReady(e.target.files[0]);e.target.value='';};
 $('frontCamera').onclick=()=>startCamera('user');$('backCamera').onclick=()=>startCamera('environment');
 $('flip').onclick=()=>startCamera(facing==='user'?'environment':'user');$('pauseCamera').onclick=()=>{stopCamera();status('カメラを停止しました。');};
 document.querySelectorAll('[data-frame]').forEach(b=>b.onclick=()=>setFrame(b.dataset.frame));$('upload').onclick=()=>$('frameFile').click();$('frameFile').onchange=e=>importFrame(e.target.files[0]);$('removeFrame').onclick=()=>{customImage=null;setFrame('none');};
 document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});refresh();});
 $('shutter').onclick=()=>{if(recording)stopRecording();else if(mode==='photo')photo();else beginRecording();};
 $('lastResult').onclick=()=>$('resultDialog').showModal();$('closeResult').onclick=()=>{$('resultDialog').close();document.querySelector('#resultMedia video')?.pause();};
 $('share').onclick=share;$('help').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();
 fileVideo.onloadedmetadata=()=>{
  if(!Number.isFinite(fileVideo.duration)||fileVideo.duration>180){fileLoaded=false;fileVideo.removeAttribute('src');fileVideo.load();if(inputURL){URL.revokeObjectURL(inputURL);inputURL=null;}refresh();error('読み込める動画は3分以内です。先に短くしてから選んでください。');return;}
  fileLoaded=true;if(frame!=='custom'){const r=fileVideo.videoWidth/fileVideo.videoHeight;setSize(r);let o=$('ratio').querySelector('[data-video]');if(!o){o=document.createElement('option');o.dataset.video='true';$('ratio').append(o);}o.value=r;o.textContent='元動画の比率';$('ratio').value=String(r);}
  $('seek').max=fileVideo.duration;$('seek').step=.05;$('seek').value=0;status('準備OK。ビデオの撮影ボタンで、先頭から書き出します。');refresh();};
 fileVideo.onloadeddata=()=>refresh();
 fileVideo.onerror=()=>{fileLoaded=false;error('この動画形式を読み込めません。MP4（H.264）の動画でお試しください。');refresh();};
 fileVideo.ontimeupdate=()=>{$('seek').value=fileVideo.currentTime;const s=Math.floor(fileVideo.currentTime);$('fileTime').textContent=`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
 fileVideo.onended=()=>{if(recording)stopRecording();$('playFile').textContent='再生';};fileVideo.onpause=()=>{$('playFile').textContent='再生';};
 $('playFile').onclick=async()=>{if(fileVideo.paused){fileVideo.muted=true;try{await fileVideo.play();$('playFile').textContent='停止';}catch{error('動画を再生できませんでした。');}}else fileVideo.pause();};$('seek').oninput=e=>{fileVideo.currentTime=Number(e.target.value);};
 document.addEventListener('visibilitychange',()=>{if(document.hidden){if(recording)stopRecording();fileVideo.pause();if(cameraStream){stopCamera();status('カメラを停止しました。再開するときはひらき直してください。');}}});
 window.addEventListener('beforeunload',e=>{if(recording||finalizing){e.preventDefault();e.returnValue='';}});
 shaderCanvas.addEventListener('webglcontextlost',e=>{e.preventDefault();drawFailed=true;if(recording)stopRecording();error('映像処理が停止しました。保存後にページを開き直してください。');refresh();});
 refresh();
 try{const saved=JSON.parse(localStorage.getItem('youlook.wave')||'null');if(saved){if(typeof saved.waveText==='string')waveText=saved.waveText.slice(0,60);if(/^#[0-9a-f]{6}$/i.test(saved.waveColor))waveColor=saved.waveColor;if(/^#[0-9a-f]{6}$/i.test(saved.textColor))textColor=saved.textColor;if(/^#[0-9a-f]{6}$/i.test(saved.frameColor))frameColor=saved.frameColor;}}catch{}
 const syncFrame=()=>{$('frameColor').value=frameColor;document.documentElement.style.setProperty('--frame',frameColor);};syncFrame();
 $('frameColor').oninput=e=>{frameColor=e.target.value;syncFrame();saveWave();};$('resetFrame').onclick=()=>{frameColor='#f7afdd';syncFrame();saveWave();};
 const syncWave=()=>{$('waveText').value=waveText;$('waveColor').value=waveColor;$('textColor').value=textColor;waveDirty=true;};syncWave();
 $('waveText').oninput=e=>{waveText=e.target.value;waveDirty=true;saveWave();};$('waveColor').oninput=e=>{waveColor=e.target.value;waveDirty=true;saveWave();};$('textColor').oninput=e=>{textColor=e.target.value;waveDirty=true;saveWave();};
 $('resetWave').onclick=()=>{waveText='I am System Engineer';waveColor='#00b1b1';textColor='#f7afdd';syncWave();saveWave();};
 document.fonts.load('24px WaveDot').then(()=>{waveDirty=true;});setFrame('supplied');
}
try{init();}catch(e){error(e.message);$('start').disabled=true;$('shutter').disabled=true;}
