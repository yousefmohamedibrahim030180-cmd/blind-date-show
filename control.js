const ADMIN_KEY = 'BlindDateHost-2026-Secret-8472';
const $=id=>document.getElementById(id);
const toast=t=>{const x=$('toast');x.textContent=t;x.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>x.classList.remove('show'),2600)};
let uid=null, authed=false, selectedCode='';
async function signIn(){const res=await auth.signInAnonymously();uid=res.user.uid;return res.user}
async function loadRooms(){
  if(!authed)return;
  const snap=await db.ref('rooms').once('value');const rooms=snap.val()||{};const sel=$('roomSelect'),old=sel.value;
  sel.innerHTML='<option value="">Select a room…</option>';
  const live=Object.values(rooms).filter(r=>r&&r.participants&&Object.keys(r.participants).length===2&&!r.ended).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  for(const r of live){
    const code=findCode(rooms,r);
    if(r.hostUid===uid && r.phase==='rating' && (r.currentRound||0)>=4){
      const rs=await db.ref(`rooms/${code}/ratings/${r.currentRound||0}`).once('value');
      if(Object.keys(rs.val()||{}).length===2){await db.ref(`rooms/${code}`).update({phase:'final',endsAt:null});r.phase='final';}
    }
    const o=document.createElement('option');o.value=code;o.textContent=`${code} · 2/2 · ${r.phase==='round'?`Round ${(r.currentRound||0)+1}`:r.phase==='rating'?`Rating Round ${(r.currentRound||0)+1}`:r.phase}`;sel.appendChild(o);
  }
  if([...sel.options].some(o=>o.value===old))sel.value=old;
  $('roomStatus').textContent=sel.options.length>1?`${sel.options.length-1} live room(s).`:'No live rooms yet.';
}
function findCode(rooms,target){return Object.keys(rooms).find(k=>rooms[k]===target)||''}
$('login').onclick=async()=>{
  const key=$('key').value.trim();if(key!==ADMIN_KEY)return $('loginStatus').textContent='Invalid controller key.';
  try{await signIn();authed=true;$('loginCard').classList.add('hidden');$('panel').classList.remove('hidden');loadRooms();toast('Controller connected.')}catch(e){$('loginStatus').textContent=e.message||'Could not connect.'}
};
$('key').onkeydown=e=>{if(e.key==='Enter')$('login').click()};$('refresh').onclick=loadRooms;
$('roomSelect').onchange=()=>selectedCode=$('roomSelect').value;
$('sendQuestion').onclick=async()=>{
  const code=$('roomSelect').value,q=$('questionInput').value.trim(),stage=Number($('stageSelect').value);
  if(!code)return toast('Select a room first.');if(!q)return toast('Write a question first.');
  const ref=db.ref(`rooms/${code}`),snap=await ref.once('value');if(!snap.exists())return toast('Room not found.');const r=snap.val();
  if(Object.keys(r.participants||{}).length!==2)return toast('The room needs two participants.');
  if(r.hostUid&&r.hostUid!==uid)return toast('This room is controlled by another host.');
  const round=r.currentRound||0;
  const expectedStage=r.phase==='rating'?round+1:round;
  if(stage!==expectedStage)return toast(`This room is waiting for Round ${expectedStage+1}.`);
  if(r.phase==='rating'){
    const ratingSnap=await ref.child(`privateRatings/${round}`).once('value');
    const ratingCount=Object.keys(ratingSnap.val()||{}).length;
    if(ratingCount<2)return toast('Wait until both participants submit their ratings.');
    if(round>=4)return toast('All rounds are complete. The final choice is next.');
  }
  await ref.update({hostUid:uid,phase:'round',currentRound:stage,question:q,endsAt:Date.now()+7*60*1000,ratingReason:'',endedBy:null});
  $('questionStatus').textContent='Question sent to both participants.';toast('Question sent.');
  $('questionInput').value='';loadRooms();
};
setInterval(loadRooms,5000);
