const RATING_VALUES=[-100,0,1,2,3,4,5,6,7,8,9,10];
const socket=io({transports:["websocket","polling"],reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:500,reconnectionDelayMax:3000,timeout:10000});
let mode="create",roomCode="",myId="",myRole="",pc=null,localStream=null,remoteStream=new MediaStream(),timerId=null,selectedRating=null,currentRatingRound=0,roundEnding=false,rtcStarting=false,iceQueue=[],videoFacingMode="user";
const $=id=>document.getElementById(id);
const show=id=>{const screens=[...document.querySelectorAll("main > .screen")];screens.forEach(s=>{const on=s.id===id;s.classList.toggle("active",on);s.hidden=!on;s.style.display=on?"block":"none";s.setAttribute("aria-hidden",String(!on));});window.scrollTo({top:0,left:0,behavior:"instant"});};
show("home");
const setRecordState=t=>{const x=$("recordHint");if(x)x.textContent=t};
const toast=t=>{const x=$("toast");x.textContent=t;x.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>x.classList.remove("show"),2800)};
const esc=t=>{const d=document.createElement("div");d.textContent=t;return d.innerHTML};

document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");mode=b.dataset.mode;$("codeWrap").classList.toggle("hidden",mode!=="join");$("enter").textContent=mode==="create"?"CREATE A ROOM →":"JOIN ROOM →"});
$("theme").onclick=()=>{document.body.classList.toggle("dark");localStorage.theme=document.body.classList.contains("dark")?"dark":"light";$("theme").textContent=document.body.classList.contains("dark")?"☀":"☾"};
if(localStorage.theme==="dark"){document.body.classList.add("dark");$("theme").textContent="☀"}

socket.on("connect",()=>{if(roomCode)$("callStatus").textContent="Realtime connected"});
socket.on("disconnect",()=>{if(roomCode)$("callStatus").textContent="Realtime connection lost — reconnecting…"});
socket.on("connect_error",e=>{if(roomCode)$("callStatus").textContent="Connecting to show server…";console.warn("Socket connection error",e)});

$("enter").onclick=()=>{
 const event=mode==="create"?"room:create":"room:join";
 const payload=mode==="create"?{}:{code:$("code").value.trim()};
 if(mode==="join"&&!payload.code)return toast("Enter the room code first.");
 const button=$("enter");button.disabled=true;button.textContent="CONNECTING…";
 socket.emit(event,payload,async r=>{
  button.disabled=false;button.textContent=mode==="create"?"CREATE A ROOM →":"JOIN ROOM →";
  if(!r?.ok)return toast(r?.error||"Could not connect.");
  roomCode=r.code;myId=r.id;show("show");addSystem(mode==="create"?"Room created. Share the code with your date.":"You joined the room.");
  const mediaOk=await startMedia();
  if(!mediaOk)$("permissionModal").classList.remove("hidden");
 });
};

let rtcConfig=null;
async function getRtcConfig(){if(rtcConfig)return rtcConfig;try{const r=await fetch("/rtc-config",{cache:"no-store"});if(!r.ok)throw Error("RTC config failed");rtcConfig=await r.json()}catch{rtcConfig={iceServers:[{urls:["stun:stun.l.google.com:19302","stun:stun.cloudflare.com:3478"]}]}}return rtcConfig}
function mediaMessage(errors){const names=errors.map(e=>e?.name).filter(Boolean);if(names.includes("NotAllowedError")||names.includes("PermissionDeniedError"))return"صلاحية الكاميرا أو الميكروفون مرفوضة. من إعدادات الموقع اجعل Camera وMicrophone = Allow ثم أعد التحميل.";if(names.includes("NotFoundError"))return"Chrome لا يجد كاميرا أو ميكروفون. تأكد أن الأجهزة متصلة ومفعلة.";if(names.includes("NotReadableError"))return"الكاميرا أو الميكروفون مستخدم من برنامج آخر. أغلق Zoom أو Teams وحاول مرة أخرى.";return"تعذر تشغيل الكاميرا والميكروفون."}
async function startMedia(){
 try{
  const secure=window.isSecureContext||["localhost","127.0.0.1"].includes(location.hostname);
  if(!secure){$("callStatus").textContent="Open the site on HTTPS";toast("افتح الموقع عبر HTTPS حتى تعمل الكاميرا والميكروفون.");return false}
  if(!navigator.mediaDevices?.getUserMedia){toast("المتصفح لا يدعم الكاميرا والميكروفون هنا.");return false}
  let stream=null,errors=[];
  try{stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30},facingMode:videoFacingMode},audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})}catch(e){errors.push(e)}
  if(!stream){
   let v=null,a=null;try{v=await navigator.mediaDevices.getUserMedia({video:true})}catch(e){errors.push(e)}try{a=await navigator.mediaDevices.getUserMedia({audio:true})}catch(e){errors.push(e)}
   const tracks=[...(v?.getVideoTracks()||[]),...(a?.getAudioTracks()||[])];if(tracks.length)stream=new MediaStream(tracks);
  }
  if(!stream||!stream.getTracks().length){toast(mediaMessage(errors));$("callStatus").textContent="Camera/microphone unavailable";return false}
  localStream?.getTracks().forEach(t=>t.stop());localStream=stream;$("localVideo").srcObject=localStream;await $("localVideo").play().catch(()=>{});
  const hasVideo=localStream.getVideoTracks().length>0,hasAudio=localStream.getAudioTracks().length>0;
  $("cam").style.opacity=hasVideo?"1":".45";$("mic").style.opacity=hasAudio?"1":".45";$("localOff").style.display=hasVideo?"none":"grid";
  $("callStatus").textContent=hasVideo&&hasAudio?"Camera & microphone ready":hasVideo?"Camera ready — microphone unavailable":"Microphone ready — camera unavailable";
  $("permissionModal").classList.add("hidden");socket.emit("media:ready",{code:roomCode});
  if(pc){syncLocalTracks();if(myRole==="host")await makeOffer()}
  return true;
 }catch(e){console.error(e);toast("حدث خطأ أثناء تشغيل أجهزة الصوت والصورة.");return false}
}
$("allowMedia").onclick=async()=>{const b=$("allowMedia");b.disabled=true;await startMedia();b.disabled=false};

function syncLocalTracks(){if(!pc||!localStream)return;const senders=pc.getSenders();for(const kind of ["audio","video"]){const track=localStream.getTracks().find(t=>t.kind===kind);const sender=senders.find(s=>s.track?.kind===kind||(!s.track&&kind==="audio"&&s._kind===kind));if(sender){sender.replaceTrack(track||null).catch(()=>{})}else if(track){const s=pc.addTrack(track,localStream);s._kind=kind}}}
async function makeOffer(){if(!pc||myRole!=="host"||pc.signalingState!=="stable"||rtcStarting)return;rtcStarting=true;try{const offer=await pc.createOffer({offerToReceiveAudio:true,offerToReceiveVideo:true});await pc.setLocalDescription(offer);socket.emit("webrtc:offer",{code:roomCode,offer:pc.localDescription})}catch(e){console.error("Offer error",e)}finally{rtcStarting=false}}
async function flushIce(){if(!pc?.remoteDescription)return;while(iceQueue.length){const c=iceQueue.shift();try{await pc.addIceCandidate(c)}catch(e){console.warn("ICE candidate",e)}}}
async function ensurePeer(){if(pc)return pc;const cfg=await getRtcConfig();pc=new RTCPeerConnection(cfg);remoteStream=new MediaStream();$("remoteVideo").srcObject=remoteStream;
 if(localStream)syncLocalTracks();
 pc.ontrack=async e=>{if(e.track&&!remoteStream.getTracks().some(t=>t.id===e.track.id))remoteStream.addTrack(e.track);$("remotePlaceholder").style.display=remoteStream.getTracks().length?"none":"grid";$("remoteVideo").muted=false;$("remoteVideo").volume=1;try{await $("remoteVideo").play();$("enableAudio").classList.add("hidden")}catch{$("enableAudio").classList.remove("hidden");$("callStatus").textContent="Video connected — click ENABLE SOUND"}};
 pc.onicecandidate=e=>{if(e.candidate)socket.emit("webrtc:ice",{code:roomCode,candidate:e.candidate})};
 pc.onconnectionstatechange=()=>{if(!pc)return;const s=pc.connectionState;if(s==="connected"){$("callStatus").textContent="Connected — audio & video live";$("enableAudio").classList.add("hidden")}else if(s==="connecting")$("callStatus").textContent="Connecting audio & video…";else if(s==="disconnected"){$("callStatus").textContent="Connection interrupted — reconnecting…"}else if(s==="failed"){$("callStatus").textContent="Connection failed — retrying…";setTimeout(()=>{if(pc?.connectionState==="failed")rebuildPeer()},1000)}};
 pc.oniceconnectionstatechange=()=>{if(pc?.iceConnectionState==="failed")pc.restartIce?.()};
 return pc}
async function rebuildPeer(){try{pc?.close()}catch{}pc=null;iceQueue=[];if(!localStream)return;await ensurePeer();if(myRole==="host")await makeOffer()}

socket.on("room:state",async s=>{if(!roomCode)roomCode=s.code;$("roomCode").textContent=s.code;const me=s.participants.find(p=>p.id===myId);if(me)myRole=me.role;if(s.participants.length===2&&s.started&&localStream)socket.emit("media:ready",{code:roomCode})});
socket.on("media:status",x=>{if(x.count<2)$("callStatus").textContent="Waiting for the other participant…"});
socket.on("webrtc:start",async()=>{if(localStream){await ensurePeer();await makeOffer()}});
socket.on("webrtc:offer",async({offer})=>{try{await ensurePeer();if(!pc)return;await pc.setRemoteDescription(new RTCSessionDescription(offer));await flushIce();const answer=await pc.createAnswer();await pc.setLocalDescription(answer);socket.emit("webrtc:answer",{code:roomCode,answer:pc.localDescription})}catch(e){console.error("Offer handling error",e);$("callStatus").textContent="Could not establish the video call."}});
socket.on("webrtc:answer",async({answer})=>{try{if(!pc)return;await pc.setRemoteDescription(new RTCSessionDescription(answer));await flushIce()}catch(e){console.error("Answer error",e)}});
socket.on("webrtc:ice",async({candidate})=>{if(!candidate)return;if(!pc||!pc.remoteDescription){iceQueue.push(candidate);return}try{await pc.addIceCandidate(new RTCIceCandidate(candidate))}catch(e){console.warn("ICE",e)}});

// Director monitoring + intercom (director can receive both participant A/V streams).
const directorPeers=new Map(),directorIce=new Map(),directorTalkPeers=new Map(),directorTalkIce=new Map();
async function directorReceivePeer(from){
 if(directorPeers.has(from)) return directorPeers.get(from);
 const cfg=await getRtcConfig(), p=new RTCPeerConnection(cfg); directorPeers.set(from,p);
 const rs=new MediaStream();
 p.ontrack=e=>{ if(!rs.getTracks().some(t=>t.id===e.track.id)) rs.addTrack(e.track); const v=document.querySelector(`[data-director-id="${from}"]`); if(v){v.srcObject=rs;v.muted=false;v.volume=1;v.play().catch(()=>{})} };
 p.onicecandidate=e=>{if(e.candidate)socket.emit("webrtc:director-ice",{code:roomCode,target:from,candidate:e.candidate})};
 p.onconnectionstatechange=()=>{if(["failed","closed"].includes(p.connectionState)){directorPeers.delete(from)}};
 return p;
}
socket.on("webrtc:director-offer",async({offer,from})=>{try{const p=await directorReceivePeer(from);await p.setRemoteDescription(new RTCSessionDescription(offer));const a=await p.createAnswer();await p.setLocalDescription(a);socket.emit("webrtc:director-answer",{code:roomCode,target:from,answer:p.localDescription})}catch(e){console.warn("Director monitor",e)}});
socket.on("webrtc:director-ice",async({candidate,from})=>{if(!candidate)return;const p=directorPeers.get(from);if(!p||!p.remoteDescription){(directorIce.get(from)||directorIce.set(from,[]).get(from)).push(candidate);return}try{await p.addIceCandidate(new RTCIceCandidate(candidate))}catch{}});
socket.on("webrtc:director-talk-offer",async({offer,from})=>{try{const p=new RTCPeerConnection(await getRtcConfig());directorTalkPeers.set(from,p);const ice=[];directorTalkIce.set(from,ice);p.onicecandidate=e=>{if(e.candidate)socket.emit("webrtc:director-talk-ice",{code:roomCode,target:from,candidate:e.candidate})};p.ontrack=e=>{const v=new Audio();v.autoplay=true;v.srcObject=new MediaStream([e.track]);document.body.appendChild(v)};await p.setRemoteDescription(new RTCSessionDescription(offer));const a=await p.createAnswer();await p.setLocalDescription(a);socket.emit("webrtc:director-talk-answer",{code:roomCode,target:from,answer:p.localDescription})}catch(e){console.warn("Director talk",e)}});
socket.on("webrtc:director-talk-ice",async({candidate,from})=>{if(!candidate)return;const p=directorTalkPeers.get(from);if(p?.remoteDescription)try{await p.addIceCandidate(new RTCIceCandidate(candidate))}catch{}});


$("mic").onclick=async()=>{const t=localStream?.getAudioTracks()[0];if(!t){await startMedia();return}t.enabled=!t.enabled;$("mic").textContent=t.enabled?"🎙":"🔇";$("callStatus").textContent=t.enabled?"Microphone on":"Microphone muted"};
$("cam").onclick=async()=>{const t=localStream?.getVideoTracks()[0];if(!t){await startMedia();return}t.enabled=!t.enabled;$("cam").textContent=t.enabled?"📷":"🚫";$("localOff").style.display=t.enabled?"none":"grid"};
$("enableAudio").onclick=async()=>{const v=$("remoteVideo");v.muted=false;v.volume=1;try{await v.play();$("enableAudio").classList.add("hidden");$("callStatus").textContent="Connected — audio & video live"}catch{toast("اضغط على أي مكان في الصفحة ثم جرّب Enable Sound مرة أخرى.")}};
$("end").onclick=()=>{if(roundEnding)return;roundEnding=true;$("end").disabled=true;$("callStatus").textContent="Ending round…";socket.emit("round:end",{code:roomCode},r=>{if(!r?.ok){roundEnding=false;$("end").disabled=false;toast(r?.error||"Could not end the round.")}})};

function addSystem(t){const d=document.createElement("div");d.className="msg system";d.innerHTML=`<div class="bubble">${esc(t)}</div>`;$("messages").appendChild(d);$("messages").scrollTop=99999}
socket.on("chat:message",m=>{const d=document.createElement("div");d.className="msg "+(m.id===myId?"me":"");d.innerHTML=`<strong>${m.id===myId?"You":esc(m.label||"Your date")}</strong><div class="bubble">${esc(m.text)}</div><time>${new Date(m.time).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</time>`;$("messages").appendChild(d);$("messages").scrollTop=99999});
function sendChat(){const t=$("chatText").value.trim();if(t)socket.emit("chat:send",{code:roomCode,text:t},r=>{if(r?.ok)$("chatText").value=""})}$('sendChat').onclick=sendChat;$('chatText').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat()}};socket.on('chat:typing',x=>$('typing').textContent=x.typing?`${x.label||"Your date"} is typing...`:"");let typingTimer;$('chatText').oninput=()=>{socket.emit('chat:typing',{code:roomCode,typing:true});clearTimeout(typingTimer);typingTimer=setTimeout(()=>socket.emit('chat:typing',{code:roomCode,typing:false}),700)};

let introPlayed=false, cueToken=0, finalRevealToken=0;
function tone(freq=660,duration=.12){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const c=window.__showAudio||(window.__showAudio=new C());const o=c.createOscillator(),g=c.createGain();o.type="sine";o.frequency.value=freq;g.gain.setValueAtTime(.0001,c.currentTime);g.gain.exponentialRampToValueAtTime(.045,c.currentTime+.015);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+duration);o.connect(g).connect(c.destination);o.start();o.stop(c.currentTime+duration+.02)}catch{}}
function cinematicCountdown(el,from,onDone){let n=from,id=++cueToken;el.classList.remove("hidden");el.setAttribute("aria-hidden","false");const tick=()=>{if(id!==cueToken)return;el.textContent=n;tone(n===1?880:540,.13);el.classList.remove("count-refresh");void el.offsetWidth;el.classList.add("count-refresh");if(n<=0){el.classList.add("hidden");el.setAttribute("aria-hidden","true");onDone?.();return}n--;setTimeout(tick,1000)};tick()}
function playIntro(done){if(introPlayed){done?.();return}introPlayed=true;const o=$("showIntro"),c=$("introCountdown");o.classList.remove("hidden");cinematicCountdown(c,5,()=>{setTimeout(()=>{o.classList.add("hidden");done?.()},350)});}
function playRoundCue(stage,done){const o=$("roundCue");$("cueRound").textContent=`ROUND ${String(stage+1).padStart(2,"0")}`;cinematicCountdown($("cueCountdown"),3,()=>{setTimeout(()=>{o.classList.add("hidden");done?.()},250)})}
function playMatchReveal(match){const o=$("matchReveal");$("matchHeadline").textContent=match?"IT'S A MATCH":"THANK YOU FOR THE DATE";$("matchSub").textContent=match?"THE STORY CONTINUES":"SOME STORIES END WITH A SMILE";$("matchReveal .match-heart").textContent=match?"♥":"♡";o.classList.remove("hidden");tone(match?880:440,.35);setTimeout(()=>o.classList.add("hidden"),4200)}
socket.on("show:stage",d=>{roundEnding=false;setRecordState("● ON AIR · READY TO RECORD");$("end").disabled=false;$("ratingModal").classList.add("hidden");show("show");$("stageName").textContent=`ROUND ${d.stage+1} · YOUR DATE`;$("roundHint").textContent="ANSWER THE QUESTION BEFORE THE CLOCK HITS ZERO";$("question").textContent=d.data.question;runTimer(d.endsAt); if(d.stage===0&&!introPlayed) playIntro(); else playRoundCue(d.stage);});
function runTimer(end){clearInterval(timerId);const tick=()=>{const left=Math.max(0,end-Date.now()),sec=Math.ceil(left/1000),m=Math.floor(sec/60),s=sec%60;$("timer").textContent=`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;$("progress").style.width=`${Math.min(100,100-left/(7*60*1000)*100)}%`;if(!left)clearInterval(timerId)};tick();timerId=setInterval(tick,250)}
socket.on("show:waitingForHost",d=>{$("stageName").textContent=`ROUND ${d.round} · WAITING FOR HOST`;$("roundHint").textContent="THE DIRECTOR WILL SEND THE NEXT SHOW CARD";setRecordState("● STANDBY · WAITING FOR NEXT CUE");$('question').textContent="The host will send the next question shortly.";clearInterval(timerId);$('timer').textContent="--:--";$('progress').style.width="0%";$('end').disabled=false;roundEnding=false;show("show")});
socket.on("round:ended",x=>{$("callStatus").textContent=x.reason||"Round ended"});

const ratingSelect=$("ratingSelect");
socket.on("show:rating",d=>{currentRatingRound=Number(d.round)||Number(d.stage)+1;roundEnding=true;$('ratingModal').classList.remove('hidden');$('ratingRound').textContent=d.reason?"ROUND ENDED":`ROUND ${d.round} COMPLETE`;$('ratingIntro').textContent="Choose a number from -100 to 10. Your rating is private until the end.";$('ratingStatus').textContent="";$('ratingComment').value="";ratingSelect.value="";$('sendRating').disabled=false;clearInterval(timerId);$('end').disabled=true;selectedRating=null});
$('sendRating').onclick=()=>{const rating=Number(ratingSelect.value);if(!RATING_VALUES.includes(rating))return toast("Choose a rating from -100 to 10.");$('sendRating').disabled=true;socket.emit('show:rating',{code:roomCode,rating,comment:$('ratingComment').value.trim(),round:currentRatingRound},r=>{if(r?.ok){$('ratingStatus').textContent="Rating submitted — waiting for your date…"}else{$('sendRating').disabled=false;toast(r?.error||"Could not submit rating.")}})};
socket.on('show:ratingStatus',x=>{if(x.count===2)$('ratingStatus').textContent="Both ratings received. Moving to the next round…"});

let pendingFinalResult=null;
socket.on('show:ratingsSummary',r=>{$('otherRatingTitle').textContent="YOUR DATE'S RATINGS";const rounds=Array.isArray(r.rounds)?r.rounds:[];$('otherStars').innerHTML=rounds.length?rounds.map(x=>`<div class="rating-summary-row"><strong>ROUND ${x.round}</strong><span>${x.rating===null?"—":Number(x.rating)}</span></div>`).join(""):"<p>No ratings received.</p>";$('otherComment').textContent=rounds.filter(x=>x.comment).map(x=>`Round ${x.round}: ${x.comment}`).join("\n");$('ratingsResultModal').classList.remove('hidden')});
function showResult(r){playMatchReveal(!!r.match);$('resultIcon').textContent=r.match?"♥":"♡";$('resultTitle').textContent=r.match?"IT'S A MATCH! ♥":"THANKS FOR BEING HONEST.";$('resultText').textContent=r.match?"You both chose YES. The story continues.":"Your answers were different. Every honest choice is part of the story.";show('result')}
socket.on('show:result',r=>{if(r.ratingsReady&&!r.finalReveal){pendingFinalResult=r;return}showResult(r)});
$('closeRatings').onclick=()=>{$('ratingsResultModal').classList.add('hidden');if(pendingFinalResult){const r=pendingFinalResult;pendingFinalResult=null;showResult(r)}};
socket.on('show:final',()=>{$('ratingModal').classList.add('hidden');$('ratingsResultModal').classList.add('hidden');$('yes').disabled=false;$('no').disabled=false;$('yes').classList.remove('selected');$('no').classList.remove('selected');$('choiceWait').textContent='Your choice is private. The other answer will stay hidden until the official reveal.';setRecordState('● FINAL · PRIVATE CHOICE');show('final')});
socket.on('show:choiceStatus',x=>{if(x.count===1)$('choiceWait').textContent='CHOICE LOCKED · WAITING FOR THE OTHER ANSWER';if(x.count===2)$('choiceWait').textContent='BOTH ANSWERS LOCKED · DIRECTOR IS READY TO REVEAL'});
function choice(c){socket.emit('show:choice',{code:roomCode,choice:c},r=>{if(r?.ok){$('yes').disabled=true;$('no').disabled=true;$('yes').classList.toggle('selected',c==='yes');$('no').classList.toggle('selected',c==='no');$('choiceWait').textContent="CHOICE LOCKED · YOUR ANSWER IS SAFE"}else toast(r?.error||"Could not save choice.")})}$('yes').onclick=()=>choice('yes');$('no').onclick=()=>choice('no');
function playFinalReveal({yourChoice,theirChoice,match,automatic}){const token=++finalRevealToken,o=$('answerReveal');if(!o)return;$('revealYour').textContent='YOUR ANSWER';$('revealTheir').textContent='THEIR ANSWER';$('yourRevealValue').textContent=yourChoice==='yes'?'YES':'NO';$('theirRevealValue').textContent=theirChoice==='yes'?'YES':'NO';$('revealResult').textContent=match?'MATCH':'DIFFERENT ANSWERS';$('revealResult').className='reveal-result '+(match?'match':'no-match');$('revealAuto').textContent=automatic?'AUTO REVEAL · SAFETY FALLBACK':'DIRECTOR REVEAL';o.classList.remove('hidden');$('revealCards').classList.add('hidden');cinematicCountdown($('revealCountdown'),3,()=>{if(token!==finalRevealToken)return;$('revealCountdown').classList.add('hidden');$('revealCards').classList.remove('hidden');tone(match?880:420,.35);setTimeout(()=>{if(token===finalRevealToken)o.classList.add('hidden')},4000)})}
socket.on('show:reveal',playFinalReveal);
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(roomCode);toast('Room code copied.')}catch{toast(roomCode)}};$('again').onclick=()=>location.reload();
$('cinematic').onclick=()=>{document.body.classList.toggle('cinematic');$('cinematic').textContent=document.body.classList.contains('cinematic')?'◉':'◌';toast(document.body.classList.contains('cinematic')?'Cinematic mode on — clean recording layout.':'Cinematic mode off.')};
$('fullscreen').onclick=async()=>{const card=$('localVideo').closest('.video-card');try{if(!document.fullscreenElement)await card.requestFullscreen();else await document.exitFullscreen()}catch{toast('Fullscreen is not available in this browser.')}};
$('flip').onclick=async()=>{if(!localStream)return;const next=videoFacingMode==='user'?'environment':'user';const old=localStream;videoFacingMode=next;try{const fresh=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:videoFacingMode},audio:false});const track=fresh.getVideoTracks()[0];const oldTrack=old.getVideoTracks()[0];if(oldTrack)old.removeTrack(oldTrack),oldTrack.stop();old.addTrack(track);$('localVideo').srcObject=old;syncLocalTracks();toast(videoFacingMode==='user'?'Front camera':'Rear camera')}catch{videoFacingMode=next==='user'?'environment':'user';toast('Could not switch camera.')}};socket.on('room:left',()=>{$('remotePlaceholder').style.display='grid';$('callStatus').textContent='Your date left the room.'});window.addEventListener('beforeunload',()=>{if(roomCode)socket.emit('room:leave',{code:roomCode})});
