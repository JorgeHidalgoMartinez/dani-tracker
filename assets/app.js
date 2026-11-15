/* Dani Tracker — browser-only family dashboard. No player records leave this browser. */
'use strict';
const $ = id => document.getElementById(id);
const RIVAS = 'RIVAS FUTBOL CLUB C';
const STORE = 'dani-tracker-registros-v1'; // same key as MVP; preserves existing entries on the same origin
const norm = val => String(val ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const safe = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct = n => `${Math.round(n)} %`;
const fmt = n => Number(n).toLocaleString('es-ES', {maximumFractionDigits: 2});
const today = () => new Date().toLocaleDateString('sv-SE');
const longDate = v => v ? new Date(`${v}T12:00:00`).toLocaleDateString('es-ES', {day:'numeric',month:'short',year:'numeric'}) : 'Día sin confirmar';
const labelTime = f => f.time ? ` · ${f.time.replace(/h$/,'')} h` : ' · Hora por confirmar';
const score = f => f.gf == null ? '—' : f.home ? `${f.gf} – ${f.gc}` : `${f.gc} – ${f.gf}`;
const outcome = f => f.gf == null ? null : f.gf > f.gc ? 'G' : f.gf < f.gc ? 'P' : 'E';
const outcomeClass = x => x === 'G' ? 'win' : x === 'P' ? 'loss' : 'draw';
const sourceSafe = value => {
  try { const u = new URL(value); return u.protocol === 'https:' ? u.href : null; }
  catch { return null; }
};
let SNAP = window.DANI_BUNDLED_SNAPSHOT || null;
let sourceMode = 'incluido';
let records = {};
try { const fromStore = JSON.parse(localStorage.getItem(STORE) || '{}'); if (fromStore && typeof fromStore === 'object' && !Array.isArray(fromStore)) records = fromStore; } catch {}

function isValidSnapshot(s) {
  if (!s || !Array.isArray(s.teams) || !Array.isArray(s.fixtures) || s.teams.length !== 18 || s.fixtures.length !== 34) return false;
  if (Number(s.official?.group_id) !== 26737733) return false;
  if (s.fixtures.some(f => !Number.isInteger(Number(f.j)) || Number(f.j) < 1 || Number(f.j) > 34)) return false;
  return s.teams.some(t => norm(t.name) === RIVAS);
}
function ownTeam() { return SNAP.teams.find(t => norm(t.name) === RIVAS); }
function resolveTeam(friendly) {
  return SNAP.teams.find(t => (friendly.id && t.id && String(t.id) === String(friendly.id)) || norm(t.name) === norm(friendly.name || friendly.rival || friendly));
}
function usableRival(f) {
  if (f.rival_id) { const match = SNAP.teams.find(t => String(t.id) === String(f.rival_id)); if (match) return match; }
  return SNAP.teams.find(t => norm(t.name) === norm(f.rival)) || null;
}
function isUnknownPast(f) { return f.gf == null && f.date && f.date < today(); }
function upcomingFixture() {
  const candidates = SNAP.fixtures.filter(f => f.gf == null && (!f.date || f.date >= today()));
  return candidates[0] || SNAP.fixtures.find(f => f.gf == null) || null;
}
function percentPoisson(k, l) {
  let result = Math.exp(-l);
  for (let n=1; n<=k; n++) result *= l / n;
  return result;
}
function forecast(rival, atHome) {
  const own = ownTeam();
  if (!rival || !own || own.pj < 4 || rival.pj < 4) return null;
  const completed = (SNAP.league_matches || []).filter(x => x.hg != null && x.ag != null);
  const mean = completed.length >= 30 ? completed.reduce((s,x)=>s+x.hg+x.ag,0) / (2*completed.length)
    : SNAP.teams.reduce((s,t)=>s+t.gf,0) / Math.max(1, SNAP.teams.reduce((s,t)=>s+t.pj,0));
  if (!(mean > 0)) return null;
  const sm = v => .72*v + .28*mean;
  const attackOwn = sm(own.gf/own.pj), defenseOwn = sm(own.gc/own.pj);
  const attackOpp = sm(rival.gf/rival.pj), defenseOpp = sm(rival.gc/rival.pj);
  const lambdaOwn = Math.max(.12, attackOwn*defenseOpp/mean * (atHome?1.10:.96));
  const lambdaOpp = Math.max(.12, attackOpp*defenseOwn/mean * (atHome?.96:1.10));
  let w=0,d=0,l=0;
  for(let a=0;a<=19;a++)for(let b=0;b<=19;b++) {
    const probability=percentPoisson(a,lambdaOwn)*percentPoisson(b,lambdaOpp);
    if (a>b)w+=probability;else if(a===b)d+=probability;else l+=probability;
  }
  const sum=w+d+l;
  if (sum <= 0) return null;
  return {w:100*w/sum,d:100*d/sum,l:100*l/sum,own:lambdaOwn,opponent:lambdaOpp};
}
function predMarkup(p) {
  if (!p) return '<div class="empty">Muestra insuficiente para construir una simulación.</div>';
  const w=p.w, d=p.d, l=p.l;
  return `<div class="prob"><div><b style="color:var(--lime)">${pct(w)}</b><small>Gana Rivas</small></div><div><b style="color:var(--gold)">${pct(d)}</b><small>Empate</small></div><div><b style="color:var(--red)">${pct(l)}</b><small>Gana rival</small></div></div>
  <div class="bar"><i class="winbar" style="width:${w.toFixed(3)}%"></i><i class="drawbar" style="width:${d.toFixed(3)}%"></i><i class="lossbar" style="width:${l.toFixed(3)}%"></i></div>
  <div class="statsnote">Media estimada de goles: Rivas ${fmt(p.own)} · Rival ${fmt(p.opponent)}. Modelo experimental sin validación histórica.</div>`;
}
function latestGamesFor(team) {
  if (Array.isArray(SNAP.league_matches) && SNAP.league_matches.length) {
    return SNAP.league_matches.filter(m => m.hg != null && m.ag != null &&
      ((team.id && String(m.home_id) === String(team.id)) || (team.id && String(m.away_id) === String(team.id)) ||
       norm(m.home) === norm(team.name) || norm(m.away) === norm(team.name)))
      .map(m => {
        const home = (team.id && String(m.home_id) === String(team.id)) || norm(m.home) === norm(team.name);
        const gf=home?m.hg:m.ag, gc=home?m.ag:m.hg;
        return {j:m.j, gf, gc, date:m.date, rival:home?m.away:m.home};
      }).sort((a,b) => (a.date || '').localeCompare(b.date || '') || a.j-b.j).slice(-5).reverse();
  }
  return norm(team.name) === RIVAS ? SNAP.fixtures.filter(f=>f.gf != null)
    .sort((a,b)=>(a.date || '').localeCompare(b.date || '')).slice(-5).reverse() : [];
}
function renderTop() {
  const t=ownTeam();
  $('mPos').textContent = `${t.pos}º`;
  $('mPosNote').textContent = `De ${SNAP.teams.length} equipos`;
  $('mPts').textContent = t.pts;
  $('mRecord').textContent = `${t.pg} V · ${t.pe} E · ${t.pp} D`;
  $('mDiff').textContent = `${t.gf-t.gc>0?'+':''}${t.gf-t.gc}`;
  $('mGoals').textContent = `${t.gf} a favor · ${t.gc} en contra`;
  $('mPlayed').textContent = `${t.pj}/34`;
  $('teamInsight').innerHTML = `<div class="rowkpis"><div><b>${fmt(t.gf/Math.max(1,t.pj))}</b><span class="tiny muted">Goles / partido</span></div><div><b>${fmt(t.gc/Math.max(1,t.pj))}</b><span class="tiny muted">Encajados / partido</span></div><div><b>${fmt(100*t.pg/Math.max(1,t.pj))}%</b><span class="tiny muted">Victorias</span></div></div><p class="small muted">Datos agregados. Los partidos ante rivales muy débiles o muy fuertes pueden distorsionar los promedios.</p>`;
  let points=0;
  $('teamEvolution').innerHTML='<div class="tablewrap"><table><thead><tr><th>Jornada</th><th>Resultado</th><th>Puntos acumulados</th></tr></thead><tbody>'+SNAP.fixtures.filter(f=>f.gf!=null).map(f=>{points+=f.gf>f.gc?3:f.gf===f.gc?1:0;return `<tr><td>J${f.j}</td><td>${f.gf}–${f.gc}</td><td>${points}</td></tr>`;}).join('')+'</tbody></table></div><p class="tiny muted">Solo resultados disponibles, sin sanciones ni partidos pendientes.</p>';
  const list=latestGamesFor(t);
  $('recentForm').innerHTML = list.length ? list.map(g=>{
    const x = g.gf > g.gc ? 'G' : g.gf < g.gc ? 'P':'E';
    return `<div class="statline"><span class="tag ${outcomeClass(x)}">${x}</span><div class="grow"><b>${safe(g.rival)}</b><div class="date">J${g.j} · ${longDate(g.date)}</div></div><b>${g.gf} – ${g.gc}</b></div>`;
  }).join('') : '<div class="empty">No hay resultados confirmados.</div>';
  const pastMissing=SNAP.fixtures.filter(isUnknownPast);
  const futures=SNAP.fixtures.filter(f=>f.gf==null && !isUnknownPast(f));
  const selected=[...pastMissing.slice(0,2),...futures.slice(0,4)];
  $('coming').innerHTML = selected.length ? selected.map(f=>{
    const label=isUnknownPast(f)?'<span class="tag draw">Marcador pendiente</span>':'<span class="tag">Programado</span>';
    return `<div class="statline"><span class="tag">J${f.j}</span><div class="grow"><b>${safe(f.rival)}</b><div class="date">${longDate(f.date)}${labelTime(f)} · ${f.home?'Casa':'Fuera'}</div></div>${label}</div>`;
  }).join('') : '<div class="empty">No quedan jornadas pendientes.</div>';
  const next=upcomingFixture();
  const rival=next && usableRival(next);
  if (next) {
    $('nextLabel').textContent=`J${next.j} · ${longDate(next.date)}`;
    $('nextOpponent').textContent=next.rival;
    $('nextMeta').textContent=rival?`${rival.pos}º · ${rival.pts} pts · ${rival.gf} GF · ${rival.gc} GC`: 'Estadísticas no asociadas todavía al rival';
    $('homePred').innerHTML=predMarkup(forecast(rival, next.home));
  } else {
    $('nextLabel').textContent='Sin próximos partidos';
    $('nextOpponent').textContent='Temporada completa';
    $('nextMeta').textContent=''; $('homePred').innerHTML='';
  }
}
function renderFixtures() {
  const filter=$('fixtureFilter').value;
  const all=SNAP.fixtures.filter(f=>filter==='all'||(filter==='played'?f.gf!=null:f.gf==null));
  $('fixtureRows').innerHTML = all.map(f=>{
    const x=outcome(f), done=x!==null;
    const state=done?`<span class="tag ${outcomeClass(x)}">${x==='G'?'Victoria':x==='E'?'Empate':'Derrota'}</span>`:
      isUnknownPast(f)?'<span class="tag draw">Resultado pendiente</span>':'<span class="tiny muted">Programado / no confirmado</span>';
    return `<div class="statline"><span class="tag">J${f.j}</span><div class="grow"><b>${safe(f.rival)}</b><div class="date">${longDate(f.date)}${labelTime(f)} · ${f.home?'Casa':'Fuera'}${f.venue?' · '+safe(f.venue):''}</div></div><div style="text-align:right"><div class="score">${score(f)}</div>${state}</div></div>`;
  }).join('') || '<div class="empty">Sin partidos con ese filtro.</div>';
}
function renderLeague() {
  $('standings').innerHTML = [...SNAP.teams].sort((a,b)=>a.pos-b.pos).map(t=>{
    return `<tr class="${norm(t.name)===RIVAS?'highlight':''}"><td>${t.pos}</td><td style="text-align:left">${safe(t.name)}</td><td><b>${t.pts}</b></td><td>${t.pj}</td><td>${t.pg}</td><td>${t.pe}</td><td>${t.pp}</td><td>${t.gf}</td><td>${t.gc}</td><td>${t.gf-t.gc>0?'+':''}${t.gf-t.gc}</td></tr>`;
  }).join('');
  $('tableCut').textContent = `Fotografía consultada: ${SNAP.checked_at ? new Date(SNAP.checked_at).toLocaleString('es-ES',{timeZone:'Europe/Madrid'}) : 'sin comprobación automática'} · ${ownTeam().pj} partidos disputados por Rivas.`;
  $('fixtureCut').textContent = `${SNAP.fixtures.filter(f=>f.gf!=null).length} partidos del Rivas con resultado · ${SNAP.fixtures.filter(isUnknownPast).length} fechas pasadas sin marcador confirmado.`;
}
function headToHead(rival) {
  const own=ownTeam();
  const games=(SNAP.league_matches||[]).filter(m=>m.hg!=null && m.ag!=null &&
    [String(m.home_id),String(m.away_id)].includes(String(own.id)) &&
    [String(m.home_id),String(m.away_id)].includes(String(rival.id)));
  return games.length?games.map(m=>`${longDate(m.date)} · ${safe(m.home)} ${m.hg}–${m.ag} ${safe(m.away)}`).join('<p class="small muted">') : 'No consta un enfrentamiento previo en los resultados cargados.';
}
function formStrip(team) {
  const last=latestGamesFor(team);
  return last.length?`<div class="flexwrap">${last.map(g=>{
    const x=g.gf>g.gc?'G':g.gf<g.gc?'P':'E';return `<span class="tag ${outcomeClass(x)}" title="J${g.j}">${x}</span>`;}).join('')}</div>`:
    '<div class="small muted">Sin secuencia de resultados del rival en esta fotografía.</div>';
}
function renderRival() {
  const id=$('rivalSelect').value;
  const rival=SNAP.teams.find(t=>String(t.id||t.name)===id);
  if (!rival) return;
  const mine=ownTeam();
  const future=SNAP.fixtures.find(f=>usableRival(f)?.name===rival.name && f.gf==null);
  if (future) $('locationSelect').value = future.home?'home':'away';
  $('rivalAnalysis').innerHTML = `
    <div class="rowkpis"><div><b>${mine.pts}</b><span class="tiny muted">Rivas · ${mine.pos}º</span></div><div><b>${rival.pts}</b><span class="tiny muted">${safe(rival.name)} · ${rival.pos}º</span></div><div><b>${rival.pj}</b><span class="tiny muted">Partidos del rival</span></div></div>
    <div class="duet"><div class="teamstat"><div class="kicker">Ataque · goles/partido</div><b>${fmt(mine.gf/Math.max(1,mine.pj))} <span class="tiny muted">vs</span> ${fmt(rival.gf/Math.max(1,rival.pj))}</b></div><div class="teamstat"><div class="kicker">Defensa · encajados/partido</div><b>${fmt(mine.gc/Math.max(1,mine.pj))} <span class="tiny muted">vs</span> ${fmt(rival.gc/Math.max(1,rival.pj))}</b></div></div>
    <h3>Últimos resultados del rival</h3>${formStrip(rival)}
    <h3>Enfrentamientos directos en 2026/27</h3><div class="small muted">${headToHead(rival)}</div>
    <h3>Lectura estadística</h3><p class="analysis small">${rival.gf/Math.max(1,rival.pj)>mine.gf/Math.max(1,mine.pj)?'El rival ha marcado más goles por encuentro.':'El Rivas ha marcado tantos o más goles por encuentro.'} ${rival.gc/Math.max(1,rival.pj)<mine.gc/Math.max(1,mine.pj)?'El rival encaja menos, estadísticamente.':'El Rivas encaja tantos o menos goles por partido.'} Los números no aportan evidencia sobre el sistema táctico, las bajas ni los convocados.</p>`;
  $('rivalForecast').innerHTML=predMarkup(forecast(rival, $('locationSelect').value === 'home'));
}
function dataStatus() {
  const remote=sourceMode==='federacion';
  const last=SNAP.checked_at ? `Última consulta correcta (Madrid): ${new Date(SNAP.checked_at).toLocaleString('es-ES',{timeZone:'Europe/Madrid'})}.` : `Fotografía histórica del ${longDate(SNAP.as_of)}.`;
  const j=SNAP.data_through_jornada || Math.max(...SNAP.fixtures.filter(f=>f.gf!=null).map(f=>f.j),0);
  const pending=SNAP.fixtures.filter(isUnknownPast).length;
  $('dataBanner').innerHTML=`<div class="statusbar"><span class="tag ${remote?'win':'draw'}">${remote?'Fuente federativa procesada':'Fotografía guardada · no actualizada en vivo'}</span><b>${last}</b><span class="small">J${j} con resultado · ${pending} partidos con fecha pasada sin marcador en la copia.</span><button class="button secondary" id="reloadData">Revisar datos</button></div>`;
  if (SNAP.consistency_note) $('dataBanner').insertAdjacentHTML('beforeend',`<p>${safe(SNAP.consistency_note)}</p>`);
  $('reloadData').addEventListener('click',refreshData);
  const src=SNAP.sources||[];
  $('sourceStatus').innerHTML=`<div class="note"><b>${remote?'Copia obtenida de la fuente federativa':'Copia de datos incluida en el proyecto'}</b><p>${safe(SNAP.status)}</p><p>${safe(SNAP.consistency_note || '')}</p><p>${last}</p><p>Se han registrado ${SNAP.teams.length} equipos, ${SNAP.fixtures.length} jornadas del Rivas y ${(SNAP.league_matches||[]).length} partidos del grupo para análisis.</p></div>`;
  $('sourceList').innerHTML=src.map(s=>{
    const link=sourceSafe(s.url);
    return link?`<div class="source"><b><a href="${safe(link)}" rel="noopener noreferrer" target="_blank">${safe(s.name)}</a></b><div class="small muted">${safe(s.role)}</div></div>`:'';
  }).join('');
}
function populateOptions(){
  const current=$('rivalSelect').value;
  const upcoming=upcomingFixture();
  const preferred=upcoming && usableRival(upcoming);
  const teams=SNAP.teams.filter(t=>norm(t.name)!==RIVAS).sort((a,b)=>a.pos-b.pos);
  $('rivalSelect').innerHTML=teams.map(t=>`<option value="${safe(t.id||t.name)}">${t.pos}º · ${safe(t.name)}</option>`).join('');
  if (teams.some(t=>String(t.id||t.name)===current)) $('rivalSelect').value=current;
  else if (preferred) $('rivalSelect').value=String(preferred.id||preferred.name);
  const selected=$('inputJ').value;
  $('inputJ').innerHTML=SNAP.fixtures.map(f=>`<option value="${f.j}">J${f.j} · ${safe(f.rival)} · ${longDate(f.date)}</option>`).join('');
  if (selected && SNAP.fixtures.some(f=>String(f.j)===selected)) $('inputJ').value=selected;
  else { const f=upcoming||SNAP.fixtures[0];if(f)$('inputJ').value=String(f.j); }
}
function renderAll() {
  dataStatus();populateOptions();renderTop();renderLeague();renderFixtures();renderRival();updatePersonal();loadRecord();
}
async function refreshData() {
  const btn=$('reloadData');if(btn){btn.disabled=true;btn.textContent='Comprobando…';}
  try {
    const res=await fetch(`data/snapshot.json?v=${Date.now()}`,{cache:'no-store'});
    if(!res.ok) throw Error(`HTTP ${res.status}`);
    const json=await res.json();
    if(!isValidSnapshot(json)) throw Error('La fotografía recibida no supera las comprobaciones de estructura.');
    SNAP=json;
    sourceMode = SNAP.sync_mode==='rffm_calendar_and_standings' && SNAP.checked_at ? 'federacion':'incluido';
    renderAll();
    try {
      const stateResponse=await fetch(`data/sync_status.json?v=${Date.now()}`,{cache:'no-store'});
      if(stateResponse.ok){const state=await stateResponse.json();if(state.ok===false) $('dataBanner').insertAdjacentHTML('beforeend',`<p>Último intento fallido: ${safe(state.attempted_at)}. ${safe(state.message)}</p>`);}
    } catch {}
  } catch(error) {
    if (!SNAP || !isValidSnapshot(SNAP)) {
      $('dataBanner').textContent='No se puede recuperar ningún conjunto de datos válido.';
      return;
    }
    sourceMode='incluido';renderAll();
    $('dataBanner').insertAdjacentHTML('beforeend',`<div class="tiny">No se ha podido comprobar una versión más reciente: ${safe(error.message)}. Se mantiene la copia disponible.</div>`);
  }
}
function validateRecord(value){
  if(!value || !['no','bench','starter'].includes(value.status)) return null;
  const mn=value.minutes==null||value.minutes===''?null:Number(value.minutes);
  const gl=value.goals==null||value.goals===''?null:Number(value.goals);
  if(mn!=null && (!Number.isInteger(mn)||mn<0||mn>130)) return null;
  if(gl!=null && (!Number.isInteger(gl)||gl<0||gl>10)) return null;
  if(value.status==='no' && ((mn||0)>0 || (gl||0)>0)) return null;
  return {status:value.status,minutes:mn,goals:gl};
}
function saveToStorage(){
  try {localStorage.setItem(STORE,JSON.stringify(records));return true;}
  catch { $('saveInfo').textContent='No se puede guardar: almacenamiento local deshabilitado o lleno.';return false; }
}
function loadRecord(){
  const row=validateRecord(records[$('inputJ').value])||{};
  $('inputStatus').value=row.status||'';
  $('inputMinutes').value=row.minutes??'';
  $('inputGoals').value=row.goals??'';
  $('saveInfo').textContent='';
}
function updatePersonal(){
  const entries=Object.entries(records).map(([j,r])=>({j:Number(j), ...validateRecord(r)}))
    .filter(x=>Number.isInteger(x.j)&&x.j>=1&&x.j<=34&&x.status);
  entries.sort((a,b)=>a.j-b.j);
  const n=entries.length, called=entries.filter(x=>x.status!=='no').length;
  const started=entries.filter(x=>x.status==='starter').length;
  const minutes=entries.reduce((s,x)=>s+(x.minutes||0),0);
  const goals=entries.reduce((s,x)=>s+(x.goals||0),0);
  $('manualCount').textContent=n;
  $('manualCalled').textContent=called;
  $('manualCall').textContent=n?`${called}/${n}`:'—';
  $('manualStart').textContent=called?`${started}/${called}`:'—';
  $('personalSummary').textContent=n?`${n} partidos registrados: ${called} convocatorias, ${started} titularidades y ${minutes} minutos anotados.`:'No has anotado todavía ninguna jornada. Puedes registrar las anteriores con los datos que sepas.';
  $('personalAnalysis').innerHTML=n ? `<div class="rowkpis"><div><b>${called}/${n}</b><span class="tiny muted">Convocado</span></div><div><b>${started}/${called||'—'}</b><span class="tiny muted">Titular / convocado</span></div><div><b>${goals}</b><span class="tiny muted">Goles anotados</span></div></div>
  <p class="small muted">Frecuencias observadas en las jornadas anotadas; no se calculan probabilidades de próxima convocatoria o titularidad.</p>
  <div class="note">Estas tendencias solo resumen las jornadas anotadas. No permiten conocer la próxima convocatoria ni atribuir decisiones al entrenador.</div>`:
    '<div class="empty">Sin jornadas anotadas. El histórico privado se va construyendo poco a poco.</div>';
  const statusMap={no:'No convocado',bench:'Convocado · suplente',starter:'Titular'};
  $('recordList').innerHTML=entries.length?entries.map(x=>{
    const f=SNAP.fixtures.find(f=>f.j===x.j);
    return `<div class="statline"><span class="tag">J${x.j}</span><div class="grow"><b>${safe(f?.rival||'Partido sin datos')}</b><div class="date">${statusMap[x.status]} · ${x.minutes==null?'Minutos no anotados':x.minutes+' min'}${x.goals==null?'':' · '+x.goals+' gol(es)'}</div></div></div>`;
  }).join(''):'<div class="small muted">Sin datos todavía.</div>';
}
function download(content,name,type){
  const a=document.createElement('a');const url=URL.createObjectURL(new Blob([content],{type}));
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function getValidatedRecords() {
  const clean={};
  Object.entries(records).forEach(([j,r])=>{const nr=validateRecord(r);if(/^([1-9]|[12]\d|3[0-4])$/.test(j)&&nr)clean[j]=nr;});
  return clean;
}
function downloadCSV(){
  const clean=getValidatedRecords();
  const rows=[['jornada','fecha','rival','convocatoria','minutos','goles']];
  Object.entries(clean).sort((a,b)=>+a[0]-+b[0]).forEach(([j,r])=>{
    const f=SNAP.fixtures.find(x=>x.j===+j);rows.push([j,f?.date||'',f?.rival||'',r.status,r.minutes??'',r.goals??'']);
  });
  const cell=x=>`"${String(x).replace(/"/g,'""')}"`;
  download('\ufeff'+rows.map(r=>r.map(cell).join(';')).join('\r\n'),'dani_jornadas.csv','text/csv;charset=utf-8');
}
function downloadJSON(){
  download(JSON.stringify({schema:'dani-tracker-personal-v1',exportedAt:new Date().toISOString(),records:getValidatedRecords()},null,2),
    'dani_copia_privada.json','application/json;charset=utf-8');
}
async function importJSON(file){
  if (!file) return;
  try{
    if(file.size>200000)throw Error('Archivo demasiado grande.');
    const parsed=JSON.parse(await file.text());
    if(parsed.schema!=='dani-tracker-personal-v1'||!parsed.records||Array.isArray(parsed.records)||typeof parsed.records!=='object')throw Error('Formato de copia no reconocido.');
    const imported={};
    for(const [j,r] of Object.entries(parsed.records)){
      if(!/^([1-9]|[12]\d|3[0-4])$/.test(j))throw Error(`Jornada inválida: ${j}`);
      const valid=validateRecord(r);
      if(!valid)throw Error(`Registro inválido en jornada ${j}`);
      imported[j]=valid;
    }
    const count=Object.keys(imported).length;
    if (!window.confirm(`La copia contiene ${count} jornadas. ¿Sustituir los registros actuales en este navegador?`))return;
    const previous=records;records=imported;
    if(!saveToStorage()){records=previous;throw Error('No fue posible escribir en el almacenamiento local.');}
    updatePersonal();loadRecord();$('importInfo').textContent=`Copia restaurada: ${count} jornadas.`;
  }catch(err){$('importInfo').textContent=`No se ha importado: ${err.message}`;}
  finally{$('importJSON').value='';}
}
function attachEvents(){
  document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>showTab(btn.dataset.tab)));
  document.querySelectorAll('[data-goto]').forEach(btn=>btn.addEventListener('click',()=>showTab(btn.dataset.goto)));
  $('fixtureFilter').addEventListener('change',renderFixtures);
  $('rivalSelect').addEventListener('change',renderRival);
  $('locationSelect').addEventListener('change',()=>{
    const rival=SNAP.teams.find(t=>String(t.id||t.name)===$('rivalSelect').value);
    $('rivalForecast').innerHTML=predMarkup(forecast(rival,$('locationSelect').value==='home'));
  });
  $('inputJ').addEventListener('change',loadRecord);
  $('saveRecord').addEventListener('click',()=>{
    const j=$('inputJ').value;
    const status=$('inputStatus').value;
    const r=validateRecord({status,minutes:$('inputMinutes').value,goals:$('inputGoals').value});
    if(!r){$('saveInfo').textContent='Datos incompletos o incoherentes. Selecciona una situación y revisa minutos y goles.';return;}
    const old=records[j];records[j]=r;
    if(!saveToStorage()){if(old===undefined)delete records[j];else records[j]=old;return;}
    $('saveInfo').textContent='Jornada guardada únicamente en este navegador.';
    updatePersonal();
  });
  $('removeRecord').addEventListener('click',()=>{
    const j=$('inputJ').value, old=records[j];
    delete records[j];
    if(saveToStorage()){loadRecord();updatePersonal();$('saveInfo').textContent='Jornada eliminada de este navegador.';}
    else if(old!==undefined) records[j]=old;
  });
  $('exportJSON').addEventListener('click',downloadJSON);
  $('exportCSV').addEventListener('click',downloadCSV);
  $('importJSON').addEventListener('change',ev=>importJSON(ev.target.files?.[0]));
}
function showTab(id){
  document.querySelectorAll('[data-tab]').forEach(btn=>btn.classList.toggle('active',btn.dataset.tab===id));
  document.querySelectorAll('.section').forEach(section=>section.classList.toggle('active',section.id===id));
  window.scrollTo({top:0,behavior:'smooth'});
}
async function init(){
  attachEvents();
  if (isValidSnapshot(SNAP)) {renderAll();await refreshData();}
  else await refreshData();
}
init();
