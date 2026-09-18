const ALLOWED_RATINGS = new Set([-100,0,1,2,3,4,5,6,7,8,9,10]);
const express=require("express");
const http=require("http");
const path=require("path");
const crypto=require("crypto");
const {Server}=require("socket.io");

const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:true,credentials:true},pingInterval:25000,pingTimeout:20000});
const PORT=Number(process.env.PORT)||3000;
const HOST=process.env.HOST||"0.0.0.0";
const rooms=new Map();
const TURN_URL=process.env.TURN_URL||"";
const TURN_USERNAME=process.env.TURN_USERNAME||"";
const TURN_CREDENTIAL=process.env.TURN_CREDENTIAL||"";
const ROUND_SECONDS=7*60;
const ADMIN_KEY=process.env.ADMIN_KEY||"BlindDateHost-2026-Secret-8472";
const stages=[{name:"ROUND 1"},{name:"ROUND 2"},{name:"ROUND 3"},{name:"ROUND 4"},{name:"ROUND 5"}];
const clean=(v,n)=>String(v??"").replace(/[<>]/g,"").trim().slice(0,n);
function makeCode(){let c;do c=crypto.randomBytes(5).toString("hex").toUpperCase().slice(0,6);while(rooms.has(c));return c}
function emitState(r){io.to(r.code).emit("room:state",{code:r.code,stage:r.stage,started:r.started,final:r.final,ended:r.ended,endsAt:r.endsAt,ratingOpen:r.ratingOpen,revealReady:r.revealReady||false,revealed:r.revealed||false,participants:[...r.players.values()].map(p=>({id:p.id,role:p.role,label:p.role==="host"?"You":"Your date"}))})}
function notifyDirectors(code,event,payload={}){for(const s of io.sockets.sockets.values())if(s.data?.controller&&s.data?.director&&s.data?.directorRoom===code)s.emit(event,payload)}
function notifyChoiceState(r){const count=Object.keys(r.choices||{}).length;io.to(r.code).emit("show:choiceStatus",{count,locked:count===2});notifyDirectors(r.code,"director:choiceStatus",{count,ready:count===2,revealed:!!r.revealed,choices:count===2?Object.fromEntries(Object.entries(r.choices||{})):null});emitState(r)}
function revealFinal(r,automatic=false){if(!rooms.has(r.code)||r.ended||!r.final||Object.keys(r.choices||{}).length!==2)return false;clearTimeout(r.revealTimer);r.revealTimer=null;r.revealReady=true;r.revealed=true;r.ended=true;r.final=false;const entries=[...r.players.values()];const match=entries.every(p=>r.choices[p.id]==="yes");for(const p of entries){const other=entries.find(x=>x.id!==p.id);io.to(p.id).emit("show:reveal",{yourChoice:r.choices[p.id],theirChoice:r.choices[other.id],match,automatic});}notifyDirectors(r.code,"director:choiceRevealed",{choices:{...r.choices},match,automatic});emitState(r);setTimeout(()=>{if(rooms.has(r.code))io.to(r.code).emit("show:result",{match,ratingsReady:false,finalReveal:true})},5200);return true}
function startStage(r){
 if(r.stage>=stages.length)return finalStage(r);
 const question=clean(r.questions[r.stage],500); if(!question)return;
 clearTimeout(r.timer);
 r.answers={}; r.ratings={}; r.ratingOpen=false; r.ratingReason=""; r.roundEnded=false;
 r.endsAt=Date.now()+ROUND_SECONDS*1000;
 io.to(r.code).emit("show:stage",{stage:r.stage,data:{...stages[r.stage],question,seconds:ROUND_SECONDS},endsAt:r.endsAt});
 emitState(r);
 r.timer=setTimeout(()=>beginRatings(r,"Time is up"),ROUND_SECONDS*1000+150);
}
function beginRatings(r,reason="Round ended"){
 if(!rooms.has(r.code)||r.ended||r.ratingOpen)return;
 clearTimeout(r.timer); r.timer=null; r.endsAt=null; r.answers={}; r.ratings={}; r.ratingReason=reason; r.ratingOpen=true; r.roundEnded=true;
 io.to(r.code).emit("round:ended",{reason,stage:r.stage,round:r.stage+1});
 io.to(r.code).emit("show:rating",{stage:r.stage,round:r.stage+1,reason});
 emitState(r);
}
function advance(r){
 if(!rooms.has(r.code)||r.ended)return;
 r.ratingOpen=false;
 r.stage++;
 if(r.stage>=stages.length){sendRatingsSummary(r);return setTimeout(()=>finalStage(r),350)}
 r.answers={};r.ratings={};r.endsAt=null;r.roundEnded=false;
 io.to(r.code).emit("show:waitingForHost",{stage:r.stage,round:r.stage+1});
 emitState(r);
}
function finalStage(r){clearTimeout(r.timer);r.timer=null;clearTimeout(r.revealTimer);r.revealTimer=null;r.final=true;r.ended=false;r.revealReady=false;r.revealed=false;r.ratingOpen=false;r.endsAt=null;r.answers={};r.ratings={};r.choices={};io.to(r.code).emit("show:final");notifyChoiceState(r);emitState(r)}
function maybeStart(r){if(r.players.size===2&&!r.started){r.started=true;io.to(r.code).emit("show:waitingForHost",{stage:r.stage,round:r.stage+1});emitState(r)}}
function sendRatingsSummary(r){
 const entries=[...r.players.values()]; if(entries.length<2)return;
 for(const p of entries){
  const other=entries.find(x=>x.id!==p.id);
  const rounds=r.ratingHistory.map(item=>({round:item.round,rating:item.ratings[other.id]?.rating??null,comment:item.ratings[other.id]?.comment||""}));
  io.to(p.id).emit("show:ratingsSummary",{rounds});
 }
}
app.use((req,res,next)=>{res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");res.setHeader("Pragma","no-cache");res.setHeader("Expires","0");next()});
app.use(express.static(path.join(__dirname,"public")));
app.get("/health",(req,res)=>res.status(200).json({ok:true,service:"blind-date-show"}));
app.get("/rtc-config",(req,res)=>{const iceServers=[{urls:["stun:stun.l.google.com:19302","stun:stun.cloudflare.com:3478"]}];if(TURN_URL&&TURN_USERNAME&&TURN_CREDENTIAL)iceServers.push({urls:TURN_URL.split(",").map(x=>x.trim()).filter(Boolean),username:TURN_USERNAME,credential:TURN_CREDENTIAL});res.json({iceServers})});
app.get("/control",(req,res)=>res.sendFile(path.join(__dirname,"public","director.html")));
app.get("/director",(req,res)=>res.sendFile(path.join(__dirname,"public","director.html")));
app.get("/overlay",(req,res)=>res.sendFile(path.join(__dirname,"public","overlay.html")));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

io.on("connection",socket=>{
 socket.on("control:auth",({key}={},cb)=>{const ok=typeof key==="string"&&key===ADMIN_KEY;socket.data.controller=ok;cb?.({ok,error:ok?undefined:"Invalid controller key."})});
 socket.on("control:rooms",(_,cb)=>{if(!socket.data.controller)return cb?.({ok:false,error:"Unauthorized"});cb?.({ok:true,rooms:[...rooms.values()].map(r=>({code:r.code,count:r.players.size,started:r.started,stage:r.stage,ended:r.ended,ratingOpen:r.ratingOpen,final:r.final,revealReady:!!r.revealReady,revealed:!!r.revealed}))})});
 socket.on("control:start",({code}={},cb)=>{if(!socket.data.controller)return cb?.({ok:false,error:"Unauthorized"});const r=rooms.get(clean(code,6).toUpperCase());if(!r||r.players.size!==2)return cb?.({ok:false,error:"Room not found or not full."});if(r.final||r.ended)return cb?.({ok:false,error:"Show has ended."});startStage(r);cb?.({ok:true})});
 socket.on("control:end",({code}={},cb)=>{if(!socket.data.controller)return cb?.({ok:false,error:"Unauthorized"});const r=rooms.get(clean(code,6).toUpperCase());if(!r)return cb?.({ok:false,error:"Room not found."});beginRatings(r,"Round ended by director");cb?.({ok:true})});
 socket.on("control:final",({code}={},cb)=>{if(!socket.data.controller)return cb?.({ok:false,error:"Unauthorized"});const r=rooms.get(clean(code,6).toUpperCase());if(!r)return cb?.({ok:false,error:"Room not found."});sendRatingsSummary(r);finalStage(r);cb?.({ok:true})});
 socket.on("control:reveal",({code}={},cb)=>{if(!socket.data.controller)return cb?.({ok:false,error:"Unauthorized"});const r=rooms.get(clean(code,6).toUpperCase());if(!r)return cb?.({ok:false,error:"Room not found."});if(!r.final||Object.keys(r.choices||{}).length!==2)return cb?.({ok:false,error:"Both final choices must be locked before reveal."});revealFinal(r,false);cb?.({ok:true})});
 socket.on("control:overlay",({code,overlay}={},cb)=>{if(!socket.data.controller)return cb?.({ok:false,error:"Unauthorized"});const r=rooms.get(clean(code,6).toUpperCase());if(!r)return cb?.({ok:false,error:"Room not found."});const cleanOverlay={type:clean(overlay?.type,30),title:clean(overlay?.title,80),subtitle:clean(overlay?.subtitle,140),visible:overlay?.visible!==false};io.to(code).emit("director:overlay",cleanOverlay);cb?.({ok:true})});
 socket.on("control:question",({code,question,stage}={},cb)=>{if(!socket.data.controller)return cb?.({ok:false,error:"Unauthorized"});const r=rooms.get(clean(code,6).toUpperCase()),q=clean(question,500);if(!r||r.players.size!==2)return cb?.({ok:false,error:"Room not found or not full."});if(!q)return cb?.({ok:false,error:"Write a question first."});const idx=r.stage;if(Number.isInteger(Number(stage))&&Number(stage)!==idx)return cb?.({ok:false,error:`This room is waiting for Round ${idx+1}.`});r.questions[idx]=q;startStage(r);cb?.({ok:true})});
 socket.on("room:create",(_,cb)=>{const c=makeCode(),r={code:c,players:new Map(),stage:0,started:false,final:false,ended:false,answers:{},ratings:{},choices:{},questions:{},ratingHistory:[],endsAt:null,timer:null,ratingReason:"",ratingOpen:false,roundEnded:false,mediaReady:new Set(),revealReady:false,revealed:false,revealTimer:null};r.players.set(socket.id,{id:socket.id,role:"host"});rooms.set(c,r);socket.join(c);cb?.({ok:true,code:c,id:socket.id});emitState(r)});
 socket.on("room:join",({code}={},cb)=>{code=clean(code,6).toUpperCase();const r=rooms.get(code);if(!r)return cb?.({ok:false,error:"Room not found. Check the code and try again."});if(r.players.size>=2)return cb?.({ok:false,error:"This room is already full."});if(r.started)return cb?.({ok:false,error:"This show has already started."});r.players.set(socket.id,{id:socket.id,role:"date"});socket.join(code);cb?.({ok:true,code,id:socket.id});emitState(r);maybeStart(r)});
 socket.on("director:join",({code}={},cb)=>{
  if(!socket.data.controller)return cb?.({ok:false,error:"Unauthorized"});
  const r=rooms.get(clean(code,6).toUpperCase());
  if(!r)return cb?.({ok:false,error:"Room not found."});
  socket.data.director=true; socket.data.directorRoom=r.code; socket.join(r.code);
  const participants=[...r.players.values()].map(p=>({id:p.id,role:p.role,label:"Camera "+(p.role==="host"?"01":"02")}));
  socket.emit("director:participants",{code:r.code,participants});
  const choiceCount=Object.keys(r.choices||{}).length;
  socket.emit("director:choiceStatus",{count:choiceCount,ready:choiceCount===2,revealed:!!r.revealed,choices:choiceCount===2?Object.fromEntries(Object.entries(r.choices||{})):null});
  cb?.({ok:true,code:r.code,participants});
});
socket.on("director:leave",({code}={},cb)=>{if(socket.data.director){socket.leave(clean(code,6).toUpperCase());socket.data.director=false;socket.data.directorRoom=null}cb?.({ok:true})});
socket.on("webrtc:director-offer",({code,target,offer}={})=>{if(!socket.data.controller||!socket.data.director)return;const r=rooms.get(clean(code,6).toUpperCase());if(!r||!r.players.has(target))return;io.to(target).emit("webrtc:director-offer",{offer,from:socket.id});});
socket.on("webrtc:director-answer",({code,target,answer}={})=>{if(!routedParticipant(socket,code))return;io.to(target).emit("webrtc:director-answer",{answer,from:socket.id});});
socket.on("webrtc:director-ice",({code,target,candidate}={})=>{if(!routedParticipant(socket,code))return;io.to(target).emit("webrtc:director-ice",{candidate,from:socket.id});});
socket.on("webrtc:director-talk-offer",({code,target,offer}={})=>{if(!socket.data.controller||!socket.data.director)return;const r=rooms.get(clean(code,6).toUpperCase());if(!r||!r.players.has(target))return;io.to(target).emit("webrtc:director-talk-offer",{offer,from:socket.id});});
socket.on("webrtc:director-talk-answer",({code,target,answer}={})=>{if(!routedParticipant(socket,code))return;io.to(target).emit("webrtc:director-talk-answer",{answer,from:socket.id});});
socket.on("webrtc:director-talk-ice",({code,target,candidate}={})=>{if(!routedParticipant(socket,code))return;io.to(target).emit("webrtc:director-talk-ice",{candidate,from:socket.id});});
function routedParticipant(socket,code){const r=rooms.get(clean(code,6).toUpperCase());return !!(r&&r.players.has(socket.id)&&socket.rooms.has(r.code));}
socket.on("media:ready",({code}={},cb)=>{const r=rooms.get(code),p=r?.players.get(socket.id);if(!r||!p)return cb?.({ok:false,error:"Room not found."});r.mediaReady.add(socket.id);io.to(code).emit("media:status",{count:r.mediaReady.size});if(r.mediaReady.size===2){const host=[...r.players.values()].find(x=>x.role==="host");if(host)io.to(host.id).emit("webrtc:start")}cb?.({ok:true,count:r.mediaReady.size})});
 socket.on("chat:send",({code,text}={},cb)=>{const r=rooms.get(code),p=r?.players.get(socket.id);text=clean(text,500);if(!r||!p||!text)return cb?.({ok:false});io.to(code).emit("chat:message",{id:socket.id,label:"Your date",text,time:Date.now()});cb?.({ok:true})});
 socket.on("chat:typing",({code,typing}={})=>{const r=rooms.get(code),p=r?.players.get(socket.id);if(r&&p)socket.to(code).emit("chat:typing",{label:"Your date",typing:!!typing})});
 socket.on("show:rating",({code,rating,comment,round}={},cb)=>{const r=rooms.get(code),p=r?.players.get(socket.id);rating=Number(rating);comment=clean(comment,300);if(!r||!p||!r.ratingOpen||Number(round)!==r.stage+1||!Number.isInteger(rating)||!ALLOWED_RATINGS.has(rating))return cb?.({ok:false,error:"Choose a rating from -100 to 10."});if(r.ratings[socket.id])return cb?.({ok:false,error:"Your rating was already submitted."});r.ratings[socket.id]={rating,comment};io.to(code).emit("show:ratingStatus",{count:Object.keys(r.ratings).length});cb?.({ok:true});if(Object.keys(r.ratings).length===2){r.ratingHistory.push({round:r.stage+1,ratings:{...r.ratings}});setTimeout(()=>advance(r),250)}});
 socket.on("round:end",({code}={},cb)=>{const r=rooms.get(code),p=r?.players.get(socket.id);if(!r||!p)return cb?.({ok:false,error:"Room not found."});if(!r.started||r.final)return cb?.({ok:false,error:"The round is not active."});beginRatings(r,"Round ended by a participant");cb?.({ok:true})});
 socket.on("call:end",({code}={},cb)=>{const r=rooms.get(code),p=r?.players.get(socket.id);if(!r||!p)return cb?.({ok:false,error:"Room not found."});beginRatings(r,"Round ended by a participant");cb?.({ok:true})});
 socket.on("show:choice",({code,choice}={},cb)=>{const r=rooms.get(code),p=r?.players.get(socket.id);if(!r||!p||!r.final||r.revealed||!["yes","no"].includes(choice))return cb?.({ok:false,error:"Final choice is not available."});if(r.choices[socket.id])return cb?.({ok:false,error:"Your final choice is already locked."});r.choices[socket.id]=choice;notifyChoiceState(r);cb?.({ok:true});if(Object.keys(r.choices).length===2){r.revealReady=true;clearTimeout(r.revealTimer);r.revealTimer=setTimeout(()=>revealFinal(r,true),30000);notifyDirectors(r.code,"director:choiceReady",{autoRevealIn:30});emitState(r)}});
 socket.on("webrtc:offer",({code,offer}={})=>socket.to(code).emit("webrtc:offer",{offer}));
 socket.on("webrtc:answer",({code,answer}={})=>socket.to(code).emit("webrtc:answer",{answer}));
 socket.on("webrtc:ice",({code,candidate}={})=>socket.to(code).emit("webrtc:ice",{candidate}));
 socket.on("room:leave",({code}={})=>leave(socket,code));
 socket.on("disconnect",()=>{for(const [c,r] of rooms)if(r.players.has(socket.id))leave(socket,c)});
});
function leave(socket,code){const r=rooms.get(code);if(!r)return;r.players.delete(socket.id);r.mediaReady.delete(socket.id);socket.leave(code);if(!r.players.size){clearTimeout(r.timer);rooms.delete(code)}else{r.started=false;r.final=false;r.ratingOpen=false;r.endsAt=null;clearTimeout(r.timer);r.timer=null;io.to(code).emit("room:left");emitState(r)}}
server.listen(PORT,HOST,()=>console.log(`Blind Date Show listening on ${HOST}:${PORT}`));
