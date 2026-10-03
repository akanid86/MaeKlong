const ALLOWED_ORIGINS = new Set([
  'https://maeklong.online',
  'https://www.maeklong.online',
  'https://akanid86.github.io'
]);

const RULES = {
  flood: { ttl: 360, precisions: ['exact','approximate'] },
  road_passable: { ttl: 360, precisions: ['exact','approximate'] },
  road_blocked: { ttl: 360, precisions: ['exact','approximate'] },
  shelter: { ttl: 1440, precisions: ['exact','approximate'] },
  food_water: { ttl: 720, precisions: ['exact','approximate'] },
  medical: { ttl: 720, precisions: ['exact','approximate'] },
  power_charging: { ttl: 720, precisions: ['exact','approximate'] },
  toilet: { ttl: 720, precisions: ['exact','approximate'] },
  shower: { ttl: 720, precisions: ['exact','approximate'] },
  help_request: { ttl: 360, precisions: ['approximate','near'] },
  recovered: { ttl: 720, precisions: ['exact','approximate'] }
};
const DEPTHS = new Set(['wet','ankle','shin','knee','waist','above_waist','unknown']);
const VEHICLES = new Set(['general_passable','small_not_recommended','general_impassable','high_clearance_only','unknown']);
const NEEDS = new Set(['water','food','medicine','evacuation','elderly_care','pets','other']);
const FLAG_REASONS = new Set(['wrong_location','wrong_level','duplicate','spam','outdated','other']);
const MOD_ACTIONS = new Set(['verify','hide','reject','restore']);
// Broad study envelope for the Mae Klong basin project. This intentionally does not use province boundaries.
const STUDY_BOUNDS = { south: 12.7, west: 98.3, north: 15.9, east: 100.65 };

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), origin);
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: 'Origin not allowed' }, 403, origin);

    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json({ ok: true, service: 'maeklong-api', moderation: true }, 200, origin);
      }

      if (url.pathname === '/api/admin/verify' && request.method === 'POST') {
        if (!isAdmin(request, env)) return json({ error: 'Admin token ไม่ถูกต้อง' }, 401, origin);
        return json({ ok: true }, 200, origin);
      }

      if (url.pathname === '/api/admin/reports' && request.method === 'GET') {
        if (!isAdmin(request, env)) return json({ error: 'Admin token ไม่ถูกต้อง' }, 401, origin);
        const view = cleanText(url.searchParams.get('view') || 'queue', 20);
        const where = view === 'all' ? '1=1' : `(r.moderation_status='visible' OR COALESCE(f.flag_count,0)>0)`;
        const rows = await env.DB.prepare(`
          SELECT r.id,r.type_code,r.latitude,r.longitude,r.location_precision,r.reported_at,r.created_at,r.updated_at,r.expires_at,r.resolved_at,r.emergency_status,r.source_type,r.water_depth,r.vehicle_access,r.need_code,r.people_count,r.note,r.moderation_status,r.moderation_note,r.moderated_at,COALESCE(f.flag_count,0) AS flag_count
          FROM reports r
          LEFT JOIN (SELECT report_id,COUNT(*) AS flag_count FROM report_flags GROUP BY report_id) f ON f.report_id=r.id
          WHERE ${where}
          ORDER BY COALESCE(f.flag_count,0) DESC, r.reported_at DESC
          LIMIT 500
        `).all();
        return json({ reports: rows.results || [] }, 200, origin);
      }

      if (url.pathname === '/api/admin/reports' && request.method === 'DELETE') {
        if (!isAdmin(request, env)) return json({ error: 'Admin token ไม่ถูกต้อง' }, 401, origin);
        const now = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO moderation_log(report_id,action,previous_status,new_status,detail,created_at) VALUES(NULL,'clear_all',NULL,NULL,'Admin cleared all reports',?)`).bind(now),
          env.DB.prepare('DELETE FROM report_flags'),
          env.DB.prepare('DELETE FROM reports'),
          env.DB.prepare('DELETE FROM rate_limits')
        ]);
        return json({ ok: true, cleared: true }, 200, origin);
      }

      if (url.pathname === '/api/reports' && request.method === 'GET') {
        const rows = await env.DB.prepare(`
          SELECT id,type_code,latitude,longitude,location_precision,reported_at,created_at,updated_at,expires_at,resolved_at,emergency_status,source_type,water_depth,vehicle_access,need_code,people_count,note,moderation_status,moderated_at
          FROM reports
          WHERE moderation_status NOT IN ('hidden','rejected')
          ORDER BY reported_at DESC LIMIT 2000
        `).all();
        return json({ reports: rows.results || [] }, 200, origin);
      }

      if (url.pathname === '/api/reports' && request.method === 'POST') {
        await enforceRateLimit(request, env, 'submit', 20);
        const body = await readJson(request);
        const clean = validateDraft(body);
        const now = new Date();
        const reportedAt = clean.reported_at ? new Date(clean.reported_at) : now;
        if (!Number.isFinite(reportedAt.getTime()) || Math.abs(now - reportedAt) > 24 * 3600 * 1000) throw bad('เวลารายงานไม่ถูกต้อง');
        const id = crypto.randomUUID();
        const ownerToken = randomToken();
        const ownerHash = await sha256(ownerToken);
        const expires = new Date(reportedAt.getTime() + RULES[clean.type_code].ttl * 60000).toISOString();
        const created = now.toISOString();
        await env.DB.prepare(`INSERT INTO reports (id,type_code,latitude,longitude,location_precision,reported_at,created_at,expires_at,emergency_status,source_type,water_depth,vehicle_access,need_code,people_count,note,owner_token_hash,moderation_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(id,clean.type_code,clean.latitude,clean.longitude,clean.location_precision,reportedAt.toISOString(),created,expires,'active','community',clean.water_depth||null,clean.vehicle_access||null,clean.need_code||null,clean.people_count||null,clean.note||null,ownerHash,'visible').run();
        const report = await getReport(env,id,false);
        return json({ report, owner_token: ownerToken }, 201, origin);
      }

      const flagMatch = url.pathname.match(/^\/api\/reports\/([^/]+)\/flag$/);
      if (flagMatch && request.method === 'POST') {
        await enforceRateLimit(request, env, 'flag', 30);
        const id = decodeURIComponent(flagMatch[1]);
        const existing = await env.DB.prepare('SELECT id,moderation_status FROM reports WHERE id=?').bind(id).first();
        if (!existing || ['hidden','rejected'].includes(existing.moderation_status)) return json({ error: 'ไม่พบรายงานที่แจ้งได้' }, 404, origin);
        const body = await readJson(request);
        const reason = FLAG_REASONS.has(body.reason_code) ? body.reason_code : 'other';
        const detail = cleanText(body.detail, 180);
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const reporterKey = await sha256(`${env.RATE_SALT||'maeklong-rate-v1'}:flag:${id}:${ip}`);
        try {
          await env.DB.prepare('INSERT INTO report_flags(report_id,reporter_key,reason_code,detail,created_at) VALUES(?,?,?,?,?)')
            .bind(id,reporterKey,reason,detail||null,new Date().toISOString()).run();
        } catch (e) {
          if (String(e?.message||e).toLowerCase().includes('unique')) return json({ ok: true, duplicate: true }, 200, origin);
          throw e;
        }
        return json({ ok: true }, 201, origin);
      }

      const moderateMatch = url.pathname.match(/^\/api\/admin\/reports\/([^/]+)\/moderate$/);
      if (moderateMatch && request.method === 'POST') {
        if (!isAdmin(request, env)) return json({ error: 'Admin token ไม่ถูกต้อง' }, 401, origin);
        const id = decodeURIComponent(moderateMatch[1]);
        const existing = await env.DB.prepare('SELECT * FROM reports WHERE id=?').bind(id).first();
        if (!existing) return json({ error: 'ไม่พบรายงาน' }, 404, origin);
        const body = await readJson(request);
        const action = cleanText(body.action, 20);
        if (!MOD_ACTIONS.has(action)) throw bad('คำสั่งผู้ดูแลไม่ถูกต้อง');
        const statusMap = { verify:'verified', hide:'hidden', reject:'rejected', restore:'visible' };
        const next = statusMap[action];
        const detail = cleanText(body.note, 300);
        const t = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare('UPDATE reports SET moderation_status=?,moderation_note=?,moderated_at=?,updated_at=? WHERE id=?').bind(next,detail||null,t,t,id),
          env.DB.prepare('DELETE FROM report_flags WHERE report_id=?').bind(id),
          env.DB.prepare('INSERT INTO moderation_log(report_id,action,previous_status,new_status,detail,created_at) VALUES(?,?,?,?,?,?)').bind(id,action,existing.moderation_status||'visible',next,detail||null,t)
        ]);
        return json({ report: await getReport(env,id,true) }, 200, origin);
      }

      const logMatch = url.pathname.match(/^\/api\/admin\/reports\/([^/]+)\/history$/);
      if (logMatch && request.method === 'GET') {
        if (!isAdmin(request, env)) return json({ error: 'Admin token ไม่ถูกต้อง' }, 401, origin);
        const id = decodeURIComponent(logMatch[1]);
        const rows = await env.DB.prepare('SELECT action,previous_status,new_status,detail,created_at FROM moderation_log WHERE report_id=? ORDER BY created_at DESC LIMIT 100').bind(id).all();
        return json({ history: rows.results || [] }, 200, origin);
      }

      const match = url.pathname.match(/^\/api\/reports\/([^/]+)$/);
      if (match && (request.method === 'PATCH' || request.method === 'DELETE')) {
        const id = decodeURIComponent(match[1]);
        const existing = await env.DB.prepare('SELECT * FROM reports WHERE id=?').bind(id).first();
        if (!existing) return json({ error: 'ไม่พบรายงาน' }, 404, origin);
        const admin = isAdmin(request, env);
        if (!(admin || await isOwner(request, existing))) return json({ error: 'ไม่มีสิทธิ์แก้ไขรายงานนี้' }, 403, origin);
        if (!admin && request.method === 'PATCH' && ['hidden','rejected'].includes(existing.moderation_status)) return json({ error: 'รายงานนี้ถูกผู้ดูแลพักการแสดงผล กรุณาติดต่อผู้ดูแล' }, 403, origin);
        if (request.method === 'DELETE') {
          const t = new Date().toISOString();
          if (admin) {
            await env.DB.prepare('INSERT INTO moderation_log(report_id,action,previous_status,new_status,detail,created_at) VALUES(?,?,?,?,?,?)')
              .bind(id,'delete',existing.moderation_status||'visible','deleted','Admin deleted report',t).run();
          }
          await env.DB.prepare('DELETE FROM reports WHERE id=?').bind(id).run();
          return json({ ok: true }, 200, origin);
        }
        const body = await readJson(request);
        if (body.emergency_status === 'resolved' && Object.keys(body).length === 1) {
          const t = new Date().toISOString();
          await env.DB.prepare(`UPDATE reports SET emergency_status='resolved', resolved_at=?, updated_at=? WHERE id=?`).bind(t,t,id).run();
          return json({ report: await getReport(env,id,admin) }, 200, origin);
        }
        const merged = validateDraft({ ...existing, ...body });
        const updated = new Date().toISOString();
        const reportedAt = new Date(merged.reported_at || existing.reported_at);
        const expires = new Date(reportedAt.getTime() + RULES[merged.type_code].ttl * 60000).toISOString();
        const status = ['active','resolved'].includes(body.emergency_status) ? body.emergency_status : existing.emergency_status;
        const resolvedAt = status === 'resolved' ? (existing.resolved_at || updated) : null;
        const nextModeration = admin ? 'corrected' : 'visible';
        await env.DB.prepare(`UPDATE reports SET type_code=?,latitude=?,longitude=?,location_precision=?,reported_at=?,updated_at=?,expires_at=?,resolved_at=?,emergency_status=?,water_depth=?,vehicle_access=?,need_code=?,people_count=?,note=?,moderation_status=?,moderated_at=? WHERE id=?`)
          .bind(merged.type_code,merged.latitude,merged.longitude,merged.location_precision,reportedAt.toISOString(),updated,expires,resolvedAt,status,merged.water_depth||null,merged.vehicle_access||null,merged.need_code||null,merged.people_count||null,merged.note||null,nextModeration,admin?updated:null,id).run();
        if (admin) {
          await env.DB.batch([
            env.DB.prepare('DELETE FROM report_flags WHERE report_id=?').bind(id),
            env.DB.prepare('INSERT INTO moderation_log(report_id,action,previous_status,new_status,detail,created_at) VALUES(?,?,?,?,?,?)').bind(id,'correct',existing.moderation_status||'visible','corrected','Admin edited report fields',updated)
          ]);
        }
        return json({ report: await getReport(env,id,admin) }, 200, origin);
      }
      return json({ error: 'Not found' }, 404, origin);
    } catch (err) {
      const status = Number(err?.status) || 500;
      console.error(err);
      return json({ error: status === 500 ? 'Server error' : String(err.message || err) }, status, origin);
    }
  }
};

function cors(response, origin) {
  const h = new Headers(response.headers);
  if (origin && ALLOWED_ORIGINS.has(origin)) h.set('Access-Control-Allow-Origin', origin);
  h.set('Vary','Origin');
  h.set('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
  h.set('Access-Control-Allow-Headers','Content-Type, Authorization, X-Report-Token');
  h.set('Access-Control-Max-Age','86400');
  return new Response(response.body,{status:response.status,headers:h});
}
function json(data,status=200,origin=''){return cors(new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}}),origin);}
function bad(message,status=400){const e=new Error(message);e.status=status;return e;}
async function readJson(request){try{return await request.json();}catch{throw bad('ข้อมูลไม่ถูกต้อง');}}
function cleanText(v,max=300){return String(v??'').trim().slice(0,max);}
function validateDraft(d){
  const type = cleanText(d?.type_code,40); const rule = RULES[type]; if(!rule)throw bad('ประเภทข้อมูลไม่ถูกต้อง');
  const precision = cleanText(d.location_precision,30); if(!rule.precisions.includes(precision))throw bad('ความละเอียดตำแหน่งไม่ถูกต้อง');
  const lat=Number(d.latitude), lng=Number(d.longitude); if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)throw bad('พิกัดไม่ถูกต้อง');
  if(lat<STUDY_BOUNDS.south||lat>STUDY_BOUNDS.north||lng<STUDY_BOUNDS.west||lng>STUDY_BOUNDS.east) throw bad('ตำแหน่งอยู่นอกกรอบศึกษาลุ่มน้ำแม่กลอง');
  const out={type_code:type,location_precision:precision,latitude:lat,longitude:lng,reported_at:d.reported_at||new Date().toISOString(),note:cleanText(d.note,300)};
  if(type==='flood'){
    out.water_depth=DEPTHS.has(d.water_depth)?d.water_depth:'unknown';
    out.vehicle_access=VEHICLES.has(d.vehicle_access)?d.vehicle_access:'unknown';
  }else if(type==='road_passable'||type==='road_blocked'){
    out.vehicle_access=VEHICLES.has(d.vehicle_access)?d.vehicle_access:'unknown';
  }else if(type==='help_request'){
    out.need_code=NEEDS.has(d.need_code)?d.need_code:'other';
    const pc=d.people_count==null||d.people_count===''?null:Number(d.people_count); if(pc!=null&&(!Number.isInteger(pc)||pc<1||pc>999))throw bad('จำนวนคนต้องอยู่ระหว่าง 1–999'); out.people_count=pc;
  }
  return out;
}
async function getReport(env,id,admin=false){
  const cols=`id,type_code,latitude,longitude,location_precision,reported_at,created_at,updated_at,expires_at,resolved_at,emergency_status,source_type,water_depth,vehicle_access,need_code,people_count,note,moderation_status,moderated_at`;
  const row=await env.DB.prepare(`SELECT ${cols}${admin?',moderation_note':''} FROM reports WHERE id=?`).bind(id).first();
  if(admin&&row){const f=await env.DB.prepare('SELECT COUNT(*) AS c FROM report_flags WHERE report_id=?').bind(id).first();row.flag_count=Number(f?.c||0);}
  return row;
}
function authBearer(request){const h=request.headers.get('Authorization')||'';return h.startsWith('Bearer ')?h.slice(7).trim():'';}
function safeEqual(a,b){a=String(a||'');b=String(b||'');if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
function isAdmin(request,env){return !!env.ADMIN_TOKEN && safeEqual(authBearer(request),env.ADMIN_TOKEN);}
async function isOwner(request,row){const token=request.headers.get('X-Report-Token')||'';if(!token)return false;return safeEqual(await sha256(token),row.owner_token_hash);}
function randomToken(){const b=new Uint8Array(32);crypto.getRandomValues(b);return [...b].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function sha256(s){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(s)));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function enforceRateLimit(request,env,scope='submit',limit=20){
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  const key=await sha256(`${env.RATE_SALT||'maeklong-rate-v1'}:${scope}:${ip}`);
  const now=Date.now(); const row=await env.DB.prepare('SELECT count,reset_at FROM rate_limits WHERE key=?').bind(key).first();
  if(!row || new Date(row.reset_at).getTime()<=now){
    const reset=new Date(now+3600000).toISOString();
    await env.DB.prepare('INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=1,reset_at=excluded.reset_at').bind(key,reset).run(); return;
  }
  if(Number(row.count)>=limit)throw bad('ใช้งานถี่เกินไป กรุณาลองใหม่ภายหลัง',429);
  await env.DB.prepare('UPDATE rate_limits SET count=count+1 WHERE key=?').bind(key).run();
}
