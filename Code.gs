/* Data-free authorization and validation core. Store and identity are injected. */
(function(root){
'use strict';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const clean=(s,max)=>{if(typeof s!=='string'||s.length>max)fail('invalid_text');return s.trim();};
const key=(p,d,s)=>[p,d,s].join('|');
const copy=x=>JSON.parse(JSON.stringify(x));
function belongs(data,id,period){const p=data.people.find(p=>p.id===id);return !!(p?.createdInApp&&p.periods.includes(period))||data.attendance.some(a=>a.personId===id&&a.period===period)||data.assignments.some(a=>a.personId===id&&a.period===period);}
function reason(data,id,period,date,slot){
 const person=data.people.find(p=>p.id===id);if(!person||!belongs(data,id,period))return 'wrong_period';
 if(data.assignments.some(a=>a.date===date&&a.personId===id&&key(a.period,a.date,a.shift)!==key(period,date,slot)))return 'already_assigned';
 const bounds=(data.noteCategories?.availability||[]).find(n=>n.name===person.name)?.items.filter(n=>n.period===period&&n.from&&n.to)||[];
 if(bounds.length&&!bounds.some(n=>date>=n.from&&date<=n.to))return 'unavailable';
 // Self-entered structured exclusions supplement, never overwrite, confirmed availability.
 if(person.plannedAvailableDates&&!person.plannedAvailableDates.includes(date))return 'unavailable';
 if((person.availability?.unavailableDates||[]).includes(date))return 'unavailable';return '';
}
function projection(state,who){
 const d=copy(state.data),me=who.personId||null;
 if(who.role!=='coord'){
  d.people=d.people.map(p=>({id:p.id,name:p.name,periods:p.periods,...(p.id===me?{availability:p.availability||{unavailableDates:[]},selfNote:p.selfNote||''}:{})}));
  d.assignments=d.assignments.map(a=>({id:a.id,period:a.period,date:a.date,shift:a.shift,personId:a.personId,...(a.role?{role:a.role}:{})}));
  d.attendance=[];d.notes=[];d.noteCategories={chefs:[],availability:[],leads:[],unclear:[]};d.mergeAudit=[];delete d.sourceSpreadsheetId;
  d.days=d.days.map(x=>({period:x.period,date:x.date,roles:x.roles,notes:[]}));
 }
 return {ok:true,schemaVersion:2,revision:state.revision,role:who.role,me,data:d,board:(state.board||[]).map(p=>({id:p.id,author:p.author,text:p.text,at:p.at,editedAt:p.editedAt,own:p.by===who.id,reactions:Object.entries(p.reactions||{}).map(([emoji,ids])=>({emoji,count:ids.length,mine:ids.includes(who.id)}))})),features:{addVolunteer:true,selfUpdate:!!state.features?.selfUpdate,moderation:!!state.features?.moderation}};
}
function normalizePhone(value){let p=String(value||'').replace(/[\s\-().]/g,'');if(p.startsWith('00'))p='+'+p.slice(2);if(/^05[0-9]{8}$/.test(p))p='+972'+p.slice(1);else if(/^9725[0-9]{8}$/.test(p))p='+'+p;return /^\+[1-9][0-9]{7,14}$/.test(p)?p:null;}
function normalizedName(value){return String(value||'').normalize('NFKC').replace(/[\u0591-\u05c7]/g,'').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();}
function personMatches(people,name,phone){const n=normalizedName(name);return people.filter(p=>{const pn=normalizedName(p.name);return (phone&&normalizePhone(p.phone)===phone)||(n&&pn&&(n===pn||(Math.min(n.length,pn.length)>=3&&(n.includes(pn)||pn.includes(n)))));});}
function request(state,who,b,env){
 if(!who||!['coord','vol'].includes(who.role))fail('unauthorized');
 if(who.role==='vol'&&!state.data.people.some(p=>p.id===who.personId))fail('unmatched_account');
 if(!b||b.a==='state')return projection(state,who);
 if(!Number.isInteger(b.revision)||b.revision!==state.revision)fail('conflict');
 const next=copy(state),d=next.data;
 if(b.a==='addVolunteer'){
  if(who.role!=='coord')fail('forbidden');
  const fullName=clean(b.name,120),phoneRaw=clean(b.phone||'',25),phone=phoneRaw?normalizePhone(phoneRaw):null;
  if(!fullName||!normalizedName(fullName))fail('empty_name');if(phoneRaw&&!phone)fail('invalid_phone');
  if(!Array.isArray(b.periods)||!b.periods.length||new Set(b.periods).size!==b.periods.length||b.periods.some(p=>!d.periods.some(t=>t.id===p)))fail('invalid_periods');
  const allowed=[...new Set(d.periods.filter(t=>b.periods.includes(t.id)).flatMap(t=>t.dates))];
  if(!Array.isArray(b.availableDates)||!b.availableDates.length||new Set(b.availableDates).size!==b.availableDates.length||b.availableDates.some(date=>!allowed.includes(date)))fail('invalid_dates');
  if(typeof b.chef!=='boolean')fail('invalid_chef');const note=clean(b.note||'',1000);
  if(phone&&(d.people.some(p=>normalizePhone(p.phone)===phone)||env.phoneUsedByOther(phone,'')))fail('phone_already_used');
  const matches=personMatches(d.people,fullName,phone),confirmed=b.confirmedMatches||[];
  if(!Array.isArray(confirmed)||matches.some(p=>!confirmed.includes(p.id)))fail('duplicate_review_required');
  d.people.push({id:env.id(),name:fullName,phone:phone||'',periods:[...b.periods],plannedAvailableDates:[...b.availableDates].sort(),chef:b.chef,coordinatorNote:note,createdInApp:true,source:'app',createdAt:env.now()});
 }else if(b.a==='setShift'){
  if(who.role!=='coord')fail('forbidden');
  const period=d.periods.find(p=>p.id===b.period),slot=d.shiftDefs.find(s=>s.id===b.slot);
  if(!period||!period.dates.includes(b.date)||!slot||(b.period==='אירוע'?!['festival','mpatz'].includes(b.slot):['festival','mpatz'].includes(b.slot)))fail('invalid_slot');
  if(!Array.isArray(b.ids)||new Set(b.ids).size!==b.ids.length||b.ids.some(id=>typeof id!=='string'||!d.people.some(p=>p.id===id)))fail('invalid_people');
  if(b.chef!=null&&(typeof b.chef!=='string'||!d.people.some(p=>p.id===b.chef&&p.chef)||b.ids.includes(b.chef)))fail('invalid_people');
  const old=d.assignments.filter(a=>key(a.period,a.date,a.shift)===key(b.period,b.date,b.slot));
  b.ids.forEach(id=>{if(!old.some(a=>a.personId===id)){const r=reason(d,id,b.period,b.date,b.slot);if(r)fail(r);}});
  if(b.chef&&!old.some(a=>a.personId===b.chef)){const r=reason(d,b.chef,b.period,b.date,b.slot);if(r)fail(r);}
  d.assignments=d.assignments.filter(a=>key(a.period,a.date,a.shift)!==key(b.period,b.date,b.slot));
  b.ids.forEach(id=>{const oa=old.find(a=>a.personId===id);if(oa){delete oa.role;d.assignments.push(oa);}else d.assignments.push({id:env.id(),period:b.period,date:b.date,shift:b.slot,personId:id,source:'app'});});
  if(b.chef){const oa=old.find(a=>a.personId===b.chef);d.assignments.push(oa?{...oa,role:'chef'}:{id:env.id(),period:b.period,date:b.date,shift:b.slot,personId:b.chef,role:'chef',source:'app'});}
 }else if(b.a==='saveMe'){
  if(who.role!=='vol'||!next.features?.selfUpdate)fail('forbidden');
  if(b.personId&&b.personId!==who.personId)fail('forbidden');
  const p=d.people.find(p=>p.id===who.personId);if(!p)fail('unmatched_account');
  if(!Array.isArray(b.unavailableDates)||b.unavailableDates.length>60||b.unavailableDates.some(date=>!d.periods.some(t=>belongs(d,p.id,t.id)&&t.dates.includes(date))))fail('invalid_dates');
  p.availability={unavailableDates:[...new Set(b.unavailableDates)]};p.selfNote=clean(b.note,1000);
 }else if(b.a==='boardAdd'){
  const text=clean(b.text,2000);if(!text)fail('empty_text');
  const author=who.role==='coord'?'רכז/ת':d.people.find(p=>p.id===who.personId).name;
  next.board.unshift({id:env.id(),by:who.id,author,text,at:env.now(),reactions:{}});
 }else if(['boardEdit','boardDelete','react'].includes(b.a)){
  const post=next.board.find(p=>p.id===b.id);if(!post)fail('missing_post');
  if(b.a==='boardEdit'&&post.by!==who.id)fail('forbidden');
  if(b.a==='boardDelete'&&post.by!==who.id&&!(who.role==='coord'&&next.features?.moderation))fail('forbidden');
  if(b.a==='boardEdit'){post.text=clean(b.text,2000);if(!post.text)fail('empty_text');post.editedAt=env.now();}
  if(b.a==='boardDelete')next.board=next.board.filter(p=>p.id!==post.id);
  if(b.a==='react'){
   if(!['👍','❤️','🙏','😂','🔥','🎉'].includes(b.emoji))fail('invalid_emoji');
   const r=post.reactions[b.emoji]||[],on=r.includes(who.id);post.reactions[b.emoji]=on?r.filter(id=>id!==who.id):[...r,who.id];
  }
 }else if(b.a==='createLink'||b.a==='revokeLink'){
  if(who.role!=='coord')fail('forbidden');
  const person=d.people.find(p=>p.id===b.personId);if(!person)fail('invalid_people');
  if(b.a==='createLink'){
   if(env.isCoordinator(person.id))fail('coordinator_link_protected');
   let phone=clean(b.phone,25).replace(/[\s\-().]/g,'');if(phone.indexOf('00')===0)phone='+'+phone.slice(2);if(phone.charAt(0)!=='+'){if(/^05[0-9]{8}$/.test(phone))phone='+972'+phone.slice(1);else if(/^9725[0-9]{8}$/.test(phone))phone='+'+phone;}if(!/^\+[1-9][0-9]{7,14}$/.test(phone))fail('invalid_phone');
   if(env.phoneUsedByOther(phone,person.id))fail('phone_already_used');
   env.linkAfterCommit={personId:person.id,phone};
  }else env.revokeAfterCommit=person.id;
 }else fail('bad_action');
 next.revision++;next.updatedAt=env.now();
 env.commit(next);return projection(next,who);
}
const api={request,projection,belongs,reason,normalizePhone,normalizedName,personMatches};if(typeof module!=='undefined')module.exports=api;else root.KitchenV2=api;
})(this);

/* Apps Script wrapper. Review and deploy into the existing Mekorvim V2 project only.
 * DB_ID stays in Script Properties. No state or account data belongs in this file.
 */
function db_(){var id=PropertiesService.getScriptProperties().getProperty('DB_ID');if(!id)throw Error('not_configured');return SpreadsheetApp.openById(id);}
function stateLoad_(){var sheet=db_().getSheetByName('State');for(var attempt=0;attempt<3;attempt++){var raw=sheet.getRange('B1').getValue(),pointer=JSON.parse(raw);if(!pointer||!pointer.column||!pointer.count)throw Error('invalid_store');var text=sheet.getRange(2,pointer.column,pointer.count,1).getValues().map(function(r){return r[0];}).join('');if(sheet.getRange('B1').getValue()===raw)return JSON.parse(text);}throw Error('busy');}
function stateCommit_(state){var sheet=db_().getSheetByName('State'),old=sheet.getRange('B1').getValue(),pointer=old?JSON.parse(old):{column:3},column=pointer.column===2?3:2,text=JSON.stringify(state),chunks=[];for(var i=0;i<text.length;i+=30000)chunks.push([text.slice(i,i+30000)]);if(sheet.getMaxRows()<chunks.length+1)sheet.insertRowsAfter(sheet.getMaxRows(),chunks.length+1-sheet.getMaxRows());sheet.getRange(2,column,chunks.length,1).setValues(chunks);SpreadsheetApp.flush();sheet.getRange('B1').setValue(JSON.stringify({column:column,count:chunks.length,version:Utilities.getUuid()}));SpreadsheetApp.flush();}
function hash_(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
function accountRows_(){var s=db_().getSheetByName('Accounts');return s.getLastRow()<2?[]:s.getRange(2,1,s.getLastRow()-1,7).getValues();}
function account_(id){var r=accountRows_().filter(function(r){return r[0]===id;})[0];return r?{id:r[0],role:r[1],personId:r[2]||null,phone:r[3],tokenHash:r[4],expiresAt:r[5],revoked:r[6]===true}:null;}
function auth_(token){if(typeof token!=='string'||token.length<24||token.length>256)return null;var h=hash_(token);var r=accountRows_().filter(function(r){return r[4]===h&&!r[6]&&new Date(r[5]).getTime()>Date.now();})[0];return r?account_(r[0]):null;}
function accountMatch_(id,personId){var rs=accountRows_(),i=rs.findIndex(function(r){return r[0]===id;});if(i<0)throw Error('missing_account');db_().getSheetByName('Accounts').getRange(i+2,3).setValue(personId);}
function output_(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
function doGet(e){return output_({ok:false,error:'use_post'});}
function doPost(e){var lock=LockService.getScriptLock();try{
 var b=JSON.parse(e.postData.contents);if(b.a==='phoneStart'||b.a==='phoneVerify')return output_({ok:false,error:'phone_verification_not_configured'});
 if(b.a!=='state'&&!lock.tryLock(15000))return output_({ok:false,error:'busy'});var w=auth_(b.token);if(!w)return output_({ok:false,error:'unauthorized'});
 var env={id:function(){return Utilities.getUuid();},now:function(){return new Date().toISOString();},account:account_,matchedElsewhere:function(id,pid){return accountRows_().some(function(r){return (r[0]===id&&r[2]&&r[2]!==pid)||(r[0]!==id&&r[2]===pid);});},commit:stateCommit_};
 env.isCoordinator=function(pid){return accountRows_().some(function(r){return r[1]==='coord'&&r[2]===pid&&!r[6]&&new Date(r[5]).getTime()>Date.now();});};
 env.phoneUsedByOther=function(phone,pid){return accountRows_().some(function(r){return r[3]===phone&&r[2]!==pid&&!r[6];});};
 var result=KitchenV2.request(stateLoad_(),w,b,env);
 if(env.revokeAfterCommit)revokePerson_(env.revokeAfterCommit);
 if(env.linkAfterCommit){var link=env.linkAfterCommit;revokePerson_(link.personId);var token=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');db_().getSheetByName('Accounts').appendRow([Utilities.getUuid(),'vol',link.personId,link.phone,hash_(token),new Date(Date.now()+60*86400000).toISOString(),false]);result.personalLink={token:token,personId:link.personId,phone:link.phone};}
 if(w.role==='coord')result.accounts=accountRows_().map(function(r){return {role:r[1],personId:r[2],phone:r[3],revoked:r[6]===true,expiresAt:r[5]};});
 return output_(result);
 }catch(err){return output_({ok:false,error:err.code||(err.message==='busy'?'busy':'server')});}finally{if(lock.hasLock())lock.releaseLock();}}

function revokePerson_(pid){var rs=accountRows_(),sheet=db_().getSheetByName('Accounts');rs.forEach(function(r,i){if(r[2]===pid&&r[1]==='vol')sheet.getRange(i+2,7).setValue(true);});SpreadsheetApp.flush();}
