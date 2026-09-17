const RATING_VALUES = [-100,0,1,2,3,4,5,6,7,8,9,10];
let mode="join", roomCode="", myUid="", pc=null, localStream=null, timerId=null, endedLocally=false;
let roomRef=null, roomState=null, pendingIce=[];
const $=id=>document.getElementById(id);
const show=id=>document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id===id));
const toast=t=>{const x=$('toast');x.textContent=t;x.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>x.classList.remove('show'),2800)};
const esc=t=>{const d=document.createElement('div');d.textContent=String(t??'');return d.innerHTML};

function initTheme(){
  $('theme').onclick=()=>{document.body.classList.toggle('dark');localStorage.theme=document.body.classList.contains('dark')?'dark':'light';$('theme').textContent=document.body.classList.contains('dark')?'☀':'☾'};
  if(localStorage.theme==='dark'){document.body.classList.add('dark');$('theme').textContent='☀'}
}
function setMode(next){mode=next;document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.mode===next));$('codeWrap').classList.toggle('hidden',next!=='join');$('enter').textContent=next==='join'?'JOIN ROOM →':'CREATE A ROOM →'}
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
initTheme();

function randomCode(){return Math.random().toString(36).slice(2,8).toUpperCase()}
async function signIn(){
  if(firebase.auth().currentUser)return firebase.auth().currentUser;
  const res=await auth.signInAnonymously(); return res.user;
}
async function createRoom(){
  const user=await signIn();
  let code;
  for(let i=0;i<8;i++){code=randomCode();const snap=await db.ref(`rooms/${code}`).once('value');if(!snap.exists())break;}
  const now=Date.now();
  const data={createdAt:now,hostUid:null,phase:'waiting',currentRound:0,question:'Waiting for the host to send the question…',endsAt:null,ended:false,final:false,participants:{[user.uid]:{role:'date',joinedAt:now,mediaReady:false}},chat:{}};
  await db.ref(`rooms/${code}`).set(data);
  return {code,user};
}
async function joinRoom(code){
  const user=await signIn(); code=code.trim().toUpperCase();
  const ref=db.ref(`rooms/${code}`); const snap=await ref.once('value');
  if(!snap.exists())throw new Error('Room not found. Check the code.');
  const room=snap.val(); const participants=room.participants||{};
  if(participants[user.uid])return {code,user};
  if(Object.keys(participants).length>=2)throw new Error('This room is already full.');
  if(room.phase!=='waiting' || room.ended)throw new Error('This show has already started.');
  await ref.child(`participants/${user.uid}`).set({role:'date',joinedAt:Date.now(),mediaReady:false});
  return {code,user};
}

$('enter').onclick=async()=>{
  try{
    $('enter').disabled=true;
    const result=mode==='join'?await joinRoom($('code').value):await createRoom();
    roomCode=result.code; myUid=result.user.uid; roomRef=db.ref(`rooms/${roomCode}`);
    $('roomCode').textContent=roomCode; show('show');
    addSystem(mode==='join'?'You joined the room.':'Room created. Share the code with your date.');
    subscribeRoom();
    await startMedia();
  }catch(e){toast(e.message||'Could not enter the room.')}finally{$('enter').disabled=false}
};

function subscribeRoom(){
  roomRef.on('value',snap=>{roomState=snap.val(); if(!roomState)return;
    $('roomCode').textContent=roomCode;
    const participants=roomState.participants||{};
    const count=Object.keys(participants).length;
    if(count<2 && roomState.phase==='waiting')$('callStatus').textContent='Waiting for your date…';
    if(count===2 && localStream) markMediaReady();
    renderPhase(roomState);
    syncPeer(participants);
  });
  roomRef.child('chat').limitToLast(100).on('child_added',snap=>{const m=snap.val(); if(!m)return; renderChat(m)});
  roomRef.child('chat').on('child_changed',snap=>{ });
}
function renderPhase(r){
  if(r.phase==='round'){
    endedLocally=false; $('ratingModal').classList.add('hidden'); show('show');
    $('stageName').textContent=`ROUND ${(r.currentRound||0)+1}`; $('question').textContent=r.question||'Waiting for the host…';
    runTimer(r.endsAt); return;
  }
  clearInterval(timerId);
  if(r.phase==='rating'){
    openRating(r.currentRound||0,r.ratingReason||'ROUND COMPLETE'); return;
  }
  if(r.phase==='waiting'){
    $('stageName').textContent=`ROUND ${(r.currentRound||0)+1} · WAITING FOR HOST`; $('question').textContent='The host will send the next question shortly.'; $('timer').textContent='--:--'; $('progress').style.width='0%'; show('show'); return;
  }
  if(r.phase==='final'){
    $('ratingModal').classList.add('hidden'); show('final'); return;
  }
  if(r.phase==='result'){
    showResultWithRatings(r.match===true); return;
  }
}
function runTimer(end){
  clearInterval(timerId); if(!end){$('timer').textContent='--:--';return;}
  const total=7*60*1000;
  const tick=()=>{const left=Math.max(0,end-Date.now()),sec=Math.ceil(left/1000),m=Math.floor(sec/60),s=sec%60;$('timer').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;$('progress').style.width=`${Math.max(0,Math.min(100,100-left/total*100))}%`;if(!left)clearInterval(timerId)};
  tick();timerId=setInterval(tick,250);
}

async function startMedia(){
  try{
    if(!window.isSecureContext && location.hostname!=='localhost'){toast('Camera and microphone require HTTPS. GitHub Pages provides HTTPS.');return false}
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera/microphone are not available in this browser.');
    let v=null,a=null;
    try{v=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30},facingMode:'user'}})}catch(e){console.warn('camera',e)}
    try{a=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})}catch(e){console.warn('audio',e)}
    const tracks=[...(v?.getVideoTracks()||[]),...(a?.getAudioTracks()||[])];
    if(!tracks.length){$('callStatus').textContent='Camera and microphone permission is needed';$('permissionModal').classList.remove('hidden');return false}
    localStream=new MediaStream(tracks);$('localVideo').srcObject=localStream;await $('localVideo').play().catch(()=>{});
    const hasVideo=!!localStream.getVideoTracks().length,hasAudio=!!localStream.getAudioTracks().length;
    $('localOff').style.display=hasVideo?'none':'grid';$('cam').style.opacity=hasVideo?'1':'.45';$('mic').style.opacity=hasAudio?'1':'.45';
    $('permissionModal').classList.add('hidden');$('callStatus').textContent=hasVideo&&hasAudio?'Camera & microphone ready':hasVideo?'Camera ready — microphone unavailable':'Microphone ready — camera unavailable';
    await markMediaReady();
    syncPeer(roomState?.participants||{});
    return true;
  }catch(e){console.error(e);toast(e.message||'Could not access camera/microphone.');return false}
}
$('allowMedia').onclick=async()=>{const b=$('allowMedia');b.disabled=true;await startMedia();b.disabled=false};
async function markMediaReady(){if(!roomRef||!myUid)return;await roomRef.child(`participants/${myUid}/mediaReady`).set(true).catch(()=>{})}

async function syncPeer(participants){
  if(!localStream)return;
  const ids=Object.keys(participants||{}); if(ids.length!==2)return;
  const other=ids.find(id=>id!==myUid); if(!other)return;
  if(pc)return;
  const amHost=(roomState?.hostUid===myUid);
  await makePeer(amHost);
}
async function makePeer(offerer){
  if(pc)return;
  pc=new RTCPeerConnection({iceServers:[{urls:['stun:stun.l.google.com:19302','stun:stun.cloudflare.com:3478']} ]});
  localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  pc.ontrack=e=>{if(e.streams[0]){$('remoteVideo').srcObject=e.streams[0];$('remotePlaceholder').style.display='none';$('remoteVideo').play().catch(()=>{})}};
  pc.onicecandidate=e=>{if(e.candidate)pushSignal('ice',e.candidate.toJSON())};
  pc.onconnectionstatechange=()=>{const s=pc?.connectionState;$('callStatus').textContent=s==='connected'?'Connected':s==='connecting'?'Connecting…':(s==='disconnected'||s==='failed')?'Connection unstable — checking network…':s||'Waiting for connection'};
  listenSignals();
  if(offerer){const o=await pc.createOffer({offerToReceiveAudio:true,offerToReceiveVideo:true});await pc.setLocalDescription(o);await pushSignal('offer',o)}
}
function signalRef(){return roomRef?.child(`signals/${myUid}`)}
async function pushSignal(type,payload){if(!roomRef||!myUid)return;const id=roomRef.child('signals').push().key;await roomRef.child(`signals/${id}`).set({from:myUid,type,payload,createdAt:Date.now()})}
function listenSignals(){
  roomRef.child('signals').orderByChild('createdAt').on('child_added',async snap=>{
    const s=snap.val();if(!s||s.from===myUid||!pc)return;
    try{
      if(s.type==='offer'){await pc.setRemoteDescription(new RTCSessionDescription(s.payload));while(pendingIce.length)await pc.addIceCandidate(pendingIce.shift());const a=await pc.createAnswer();await pc.setLocalDescription(a);await pushSignal('answer',a)}
      else if(s.type==='answer'){await pc.setRemoteDescription(new RTCSessionDescription(s.payload));while(pendingIce.length)await pc.addIceCandidate(pendingIce.shift())}
      else if(s.type==='ice'){if(pc.remoteDescription)await pc.addIceCandidate(new RTCIceCandidate(s.payload));else pendingIce.push(new RTCIceCandidate(s.payload))}
    }catch(e){console.warn('WebRTC signaling',e)}
  });
}

$('mic').onclick=async()=>{const t=localStream?.getAudioTracks()[0];if(!t){await startMedia();return}t.enabled=!t.enabled;$('mic').textContent=t.enabled?'🎙':'🔇'};
$('cam').onclick=async()=>{const t=localStream?.getVideoTracks()[0];if(!t){await startMedia();return}t.enabled=!t.enabled;$('cam').textContent=t.enabled?'📷':'🚫';$('localOff').style.display=t.enabled?'none':'grid'};
$('end').onclick=async()=>{if(endedLocally)return;endedLocally=true;localStream?.getTracks().forEach(t=>t.stop());pc?.close();pc=null;$('remoteVideo').srcObject=null;$('remotePlaceholder').style.display='flex';await roomRef?.child(`endedBy/${myUid}`).set(true);toast('Call ended. Please rate your date.')};

function addSystem(t){const d=document.createElement('div');d.className='msg system';d.innerHTML=`<div class="bubble">${esc(t)}</div>`;$('messages').appendChild(d);$('messages').scrollTop=999999}
const renderedChat=new Set();
function renderChat(m){if(!m.id||renderedChat.has(m.id))return;renderedChat.add(m.id);const d=document.createElement('div');d.className='msg '+(m.uid===myUid?'me':'');d.innerHTML=`<strong>${m.uid===myUid?'You':'Your date'}</strong><div class="bubble">${esc(m.text)}</div><time>${new Date(m.time||Date.now()).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time>`;$('messages').appendChild(d);$('messages').scrollTop=999999}
async function sendChat(){const text=$('chatText').value.trim();if(!text||!roomRef)return;const id=roomRef.child('chat').push().key;await roomRef.child(`chat/${id}`).set({id,uid:myUid,text:text.slice(0,500),time:Date.now()});$('chatText').value=''}
$('sendChat').onclick=sendChat;$('chatText').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat()}};

function openRating(round,reason){
  if($('ratingModal').classList.contains('hidden')===false)return;
  $('ratingRound').textContent=reason==='CALL COMPLETE'?'CALL COMPLETE':`ROUND ${round+1} COMPLETE`;
  $('ratingStatus').textContent='';$('ratingComment').value='';$('ratingSelect').value='';$('sendRating').disabled=false;$('ratingModal').classList.remove('hidden');
}
$('sendRating').onclick=async()=>{
  const rating=Number($('ratingSelect').value);if(!RATING_VALUES.includes(rating))return toast('Choose a rating from -100 to 10.');
  if(!roomRef||!myUid)return;
  $('sendRating').disabled=true;$('ratingStatus').textContent='Rating submitted — waiting for the other person…';
  const round=roomState?.currentRound||0;
  await db.ref(`privateRatings/${roomCode}/${round}/${myUid}`).set({rating,comment:$('ratingComment').value.trim().slice(0,300),at:Date.now()});
};

async function choose(c){if(!roomRef||!myUid)return;await db.ref(`privateChoices/${roomCode}/${myUid}`).set(c);$('yes').disabled=true;$('no').disabled=true;$('choiceWait').textContent='Choice locked — waiting for your date…';setTimeout(finalizeResultIfReady,250)}
async function finalizeResultIfReady(){
  if(!roomRef)return;const snap=await roomRef.once('value');const r=snap.val();const choiceSnap=await db.ref(`privateChoices/${roomCode}`).once('value');const choices=choiceSnap.val()||{};const ids=Object.keys(r?.participants||{});if(ids.length===2&&ids.every(id=>choices[id])){const match=choices[ids[0]]==='yes'&&choices[ids[1]]==='yes';await roomRef.update({phase:'result',match,ended:true,endsAt:null});}
}
$('yes').onclick=()=>choose('yes');$('no').onclick=()=>choose('no');
async function showResultWithRatings(match){
  $('resultIcon').textContent=match?'♥':'♡';$('resultTitle').textContent=match?'IT’S A MATCH! ♥':'THANKS FOR BEING HONEST.';$('resultText').textContent=match?'You both chose to meet again. The story continues.':'Not every connection is a match — and that’s okay.';
  try{
    const snap=await roomRef.once('value');const r=snap.val()||{};const pids=Object.keys(r.participants||{});const ratingSnap=await db.ref(`privateRatings/${roomCode}`).once('value');const allRatings=ratingSnap.val()||{};
    const rows=[];
    for(let round=0;round<5;round++){
      const vals=allRatings?.[round]||{};
      const parts=pids.map(uid=>vals[uid]?`${uid===myUid?'You':'Your date'}: ${vals[uid].rating}`:'').filter(Boolean);
      const comments=pids.map(uid=>vals[uid]?.comment?`${uid===myUid?'You':'Your date'}: ${vals[uid].comment}`:'').filter(Boolean);
      rows.push(`<div class="rating-summary-row"><strong>ROUND ${round+1}</strong><span>${parts.join(' · ')||'—'}</span></div>${comments.map(c=>`<div style="text-align:left;font-size:12px;margin:4px 0 10px;color:var(--muted)">${esc(c)}</div>`).join('')}`);
    }
    $('otherRatingTitle').textContent='ALL ROUND RATINGS';$('otherStars').innerHTML=rows.join('');$('otherComment').textContent='';$('ratingsResultModal').classList.remove('hidden');
  }catch(e){console.warn('rating summary',e);show('result')}
}


$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(roomCode);toast('Room code copied.')}catch{toast(roomCode)}};
$('again').onclick=()=>location.reload();
window.addEventListener('beforeunload',()=>{try{roomRef?.child(`participants/${myUid}/mediaReady`).set(false)}catch{}});

auth.onAuthStateChanged(user=>{if(user)myUid=user.uid});
