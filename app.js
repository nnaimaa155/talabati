(() => {
  'use strict';
  const config = window.DESIGN_DESK_CONFIG || {};
  const hasConfig = Boolean(config.supabaseUrl && config.supabasePublishableKey);
  const connected = hasConfig && Boolean(window.supabase?.createClient);
  const db = connected ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey) : null;
  const app = document.getElementById('app');
  const DEMO_KEY = 'design-desk-demo-tasks-v2';
  const FILE_LIMIT = 15 * 1024 * 1024;
  const VALID_EXT = new Set(['png','jpg','jpeg','webp','gif','pdf','zip']);
  const TYPES = { social:'بوست سوشيال ميديا', identity:'شعار / هوية', ad:'إعلان', print:'مطبوعات', other:'تصميم آخر' };
  const STATUSES = { new:'جديد', progress:'قيد التنفيذ', done:'مكتمل' };
  const PRIORITIES = { low:'منخفض', medium:'متوسط', high:'عالي' };
  const FORMAT_NAMES = { post:'بوست', story:'ستوري' };
  const state = { authorized:!hasConfig, filter:'open', sort:'priority', search:'', tasks:[], loading:false, sending:false, sent:false, uploadWarning:false, fileUrl:null, expandedId:null };

  function todayISO(offset=0) {
    const d = new Date(); d.setDate(d.getDate()+offset);
    return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  }
  function timeOffset(days){ return new Date(Date.now()+days*86400000).toISOString(); }
  function esc(v=''){return String(v??'').replace(/[&<>"']/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));}
  function when(v){ if(!v)return 'بدون موعد';const d=new Date(String(v).length===10 ? `${v}T12:00:00` : v);return Number.isNaN(d.getTime())?'بدون موعد':new Intl.DateTimeFormat('ar-SA-u-ca-gregory',{day:'numeric',month:'short',year:'numeric'}).format(d); }
  function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('shown');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('shown'),3500);}
  function exampleTasks(){return [
    {id:'sample-1',client_name:'متجر نيمة',contact:'',type:'social',formats:['post','story'],title:'إعلان افتتاح المتجر',details:'بوست وستوري بمناسبة الافتتاح، مع مساحة لاسم المتجر والتاريخ.',due_date:todayISO(1),urgency:'urgent',priority:'high',reference_path:null,reference_name:null,status:'new',created_at:timeOffset(-1),completed_at:null},
    {id:'sample-2',client_name:'متجر نيمة',contact:'',type:'social',formats:['story'],title:'ستوري خصم 20٪',details:'تصميم ستوري بسيط لعرض نهاية الأسبوع.',due_date:todayISO(4),urgency:'normal',priority:'medium',reference_path:null,reference_name:null,status:'progress',created_at:timeOffset(-2),completed_at:null},
    {id:'sample-3',client_name:'نادي أفق',contact:'',type:'identity',formats:[],title:'تعديل شعار النادي',details:'ضبط المحاذاة والخطوط ثم تسليم النسخة النهائية.',due_date:null,urgency:'normal',priority:'low',reference_path:null,reference_name:null,status:'new',created_at:timeOffset(-1),completed_at:null},
    {id:'sample-4',client_name:'مدرسة الإبداع',contact:'',type:'print',formats:[],title:'شهادة مشاركة',details:'شهادة A4 مع مساحة لاسم الطالب.',due_date:todayISO(-1),urgency:'normal',priority:'medium',reference_path:null,reference_name:null,status:'done',created_at:timeOffset(-5),completed_at:timeOffset(-1)}
  ];}
  function loadDemo(){try{const data=JSON.parse(localStorage.getItem(DEMO_KEY));if(Array.isArray(data))return data;}catch{}const v=exampleTasks();localStorage.setItem(DEMO_KEY,JSON.stringify(v));return v;}
  function saveDemo(){localStorage.setItem(DEMO_KEY,JSON.stringify(state.tasks));}
  function openFileDB(){return new Promise((resolve,reject)=>{if(!window.indexedDB){reject(new Error('IndexedDB unsupported'));return;}const req=indexedDB.open('design-desk-attachments-v2',1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('files'))req.result.createObjectStore('files');};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  async function fileStore(operation,key,file){const idb=await openFileDB();try{return await new Promise((resolve,reject)=>{const t=idb.transaction('files',operation==='read'?'readonly':'readwrite');const store=t.objectStore('files');const req=operation==='write'?store.put(file,key):operation==='delete'?store.delete(key):store.get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}finally{idb.close();}}
  function isUrgent(t){return t.status!=='done'&&['urgent','critical'].includes(t.urgency);}
  function urgencyTag(t){const v=t.urgency==='critical'?['critical','🚩 بالغ الأهمية']:t.urgency==='urgent'?['urgent','⚡ مستعجل']:['normal','● عادي'];return `<span class="urgency-pill ${v[0]}">${v[1]}</span>`;}
  function isOverdue(t){return t.status!=='done'&&Boolean(t.due_date)&&t.due_date<todayISO();}
  function dueSoon(t){return t.status!=='done'&&Boolean(t.due_date)&&t.due_date>=todayISO()&&t.due_date<=todayISO(2);}
  function priorityWeight(t){return (isOverdue(t)?5:0)+(t.urgency==='critical'?8:isUrgent(t)?4:0)+(dueSoon(t)?3:0)+({high:2,medium:1,low:0}[t.priority]??1);}
  function safeFormatList(t){return (Array.isArray(t.formats)?t.formats:[]).filter(f=>FORMAT_NAMES[f]).map(f=>FORMAT_NAMES[f]);}
  function updateNav(){const admin=location.hash==='#admin';document.getElementById('nav-request').classList.toggle('active',!admin);document.getElementById('nav-admin')?.classList.toggle('active',admin);document.getElementById('demo-banner').hidden=connected;}
  async function checkAdmin(){if(!connected){state.authorized=true;return;}const {data:{user},error}=await db.auth.getUser();if(error||!user){state.authorized=false;return;}const result=await db.from('admins').select('user_id').eq('user_id',user.id).maybeSingle();state.authorized=Boolean(result.data&&!result.error);}
  async function loadTasks(){state.loading=true;render();try{if(!connected){state.tasks=loadDemo();}else{const {data,error}=await db.from('tasks').select('*').order('created_at',{ascending:false}).limit(1000);if(error)throw error;state.tasks=data||[];}}catch(e){console.error(e);toast('تعذر تحميل المهام. راجع الاتصال وصلاحياتك.');}finally{state.loading=false;render();}}
  async function route(){updateNav();closeFileUrl();if(hasConfig&&!connected){app.innerHTML='<div class="panel notice-panel">تعذر تحميل الاتصال بقاعدة البيانات. تأكد من الإنترنت وأعد تحميل الصفحة. لم ننتقل لوضع التجربة حتى لا تضيع طلبات العملاء.</div>';return;}if(location.hash==='#admin'){if(connected)await checkAdmin();if(state.authorized)await loadTasks();else render();}else{state.sent=false;render();}window.scrollTo({top:0,behavior:'instant'});}
  function render(){updateNav();if(location.hash==='#admin'){app.innerHTML=state.authorized?dashboardTemplate():loginTemplate();bindDashboard();}else if(state.sent){app.innerHTML=successTemplate();document.getElementById('new-request')?.addEventListener('click',()=>{state.sent=false;render();});}else{app.innerHTML=requestTemplate();bindRequest();}}

  function requestTemplate(){return `<section class="request-area">
    <div class="page-intro"><span class="eyebrow">طلب تصميم جديد</span><h1><span class="flower-mark" aria-hidden="true"><img src="logo-flower.png" alt=""></span>اطلب تصميمك</h1><p>اكتب اللي تحتاجه وارفق مرجعك، وباقي التفاصيل علينا.</p></div>
    <div class="panel request-panel"><form id="request-form" class="form-grid">
      <div class="field"><label for="client_name">الجهة أو الاسم <b>*</b></label><input id="client_name" name="client_name" placeholder="اسم العميل او الجهة" maxlength="100" minlength="2" required></div>
      <div class="field"><label for="type">نوع العمل <b>*</b></label><select id="type" name="type" required><option value="" disabled selected>اختر نوع التصميم</option>${Object.entries(TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field full social-format" id="social-format" hidden><span class="inline-label">المقاس المطلوب <b>*</b> <small>تقدر تختار الاثنين</small></span><div class="format-options"><label class="choice"><input type="checkbox" name="formats" value="post"><span class="choice-check" aria-hidden="true"></span><span class="choice-content"><strong>بوست</strong><small>بوست 3:4</small></span></label><label class="choice"><input type="checkbox" name="formats" value="story"><span class="choice-check" aria-hidden="true"></span><span class="choice-content"><strong>ستوري</strong><small>طولي 9:16</small></span></label></div></div>
      <div class="field full"><label for="title">عنوان الطلب <b>*</b></label><input id="title" name="title" placeholder="تصميم لوجو ، بوست ، بنر" minlength="3" maxlength="120" required></div>
      <div class="field full"><label for="details">تفاصيل الطلب <b>*</b></label><textarea id="details" name="details" placeholder="اشرح المطلوب، النصوص، الألوان، وعدد التصاميم. وإذا كان التصميم مطبوعات، يرجى ذكر المقاس بدقة." minlength="5" maxlength="3000" required></textarea></div>
      <div class="field"><label for="reference">ارفع المرجع <small>(اختياري)</small></label><label class="upload-zone" for="reference"><span class="upload-icon">↑</span><span id="file-label">اضغط لاختيار ملف من جهازك</span><small>صورة، PDF أو ZIP · حتى 15 MB</small></label><input class="sr-only" id="reference" name="reference" type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.zip"></div>
      <div class="field"><label for="due_date">موعد التسليم <small>(اختياري)</small></label><input type="date" name="due_date" id="due_date"><label for="urgency" class="second-label">الأولوية المطلوبة</label><select name="urgency" id="urgency"><option value="normal">عادي</option><option value="urgent">⚡ مستعجل</option><option value="critical">🚩 بالغ الأهمية</option></select></div>
      <div class="form-footer full"><span class="privacy-note">🔒 الطلب لا يظهر للعملاء الآخرين.</span><button id="submit-btn" class="primary-btn" type="submit">إرسال الطلب <span>←</span></button></div>
    </form></div>
  </section>`;}
  function successTemplate(){return `<section class="success-panel panel"><div class="success-ring">✓</div><h1>تم استلام طلبك</h1><p>وصل الطلب إلى القائمة بنجاح.${state.uploadWarning?' لكن تعذر حفظ المرفق؛ أرسله للمصمم بطريقة أخرى.':''}</p><button class="primary-btn" id="new-request">إرسال طلب آخر</button></section>`;}
  function loginTemplate(){return `<section class="login-panel panel"><span class="eyebrow">خاصة بالمصمم</span><h1>الدخول للوحة المهام</h1><p>سجل دخولك عشان تشوف طلبات الجهات.</p><form id="login-form"><div class="field"><label for="email">البريد الإلكتروني</label><input id="email" type="email" autocomplete="username" required></div><div class="field"><label for="password">كلمة المرور</label><input id="password" type="password" minlength="6" autocomplete="current-password" required></div><button class="primary-btn" id="login-btn" type="submit">دخول</button></form></section>`;}
  function filteredTasks(){const q=state.search.trim().toLocaleLowerCase();return state.tasks.filter(t=>state.filter==='all'||(state.filter==='open'?t.status!=='done':state.filter==='urgent'?isUrgent(t):state.filter==='soon'?isOverdue(t)||dueSoon(t):t.status===state.filter)).filter(t=>!q||[t.client_name,t.title,t.details,TYPES[t.type]].some(x=>String(x||'').toLocaleLowerCase().includes(q))).sort((a,b)=>{if(state.sort==='priority'){const p=priorityWeight(b)-priorityWeight(a);if(p)return p;}if(state.sort==='deadline'){const delta=(a.due_date||'9999').localeCompare(b.due_date||'9999');if(delta)return delta;}return new Date(b.created_at)-new Date(a.created_at);});}
  function groupTasks(tasks){
    const groups=new Map();
    for(const task of tasks){
      const name=String(task.client_name||'بدون اسم').trim().replace(/\s+/g,' ');
      const key=name.normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[إأآ]/g,'ا').toLocaleLowerCase('ar');
      if(!groups.has(key))groups.set(key,{name,tasks:[]});
      groups.get(key).tasks.push(task);
    }
    return [...groups.values()].sort((a,b)=>{
      const pa=Math.max(...a.tasks.map(priorityWeight));const pb=Math.max(...b.tasks.map(priorityWeight));
      return pb-pa;
    });
  }
  function statusChip(t){if(isOverdue(t))return '<span class="task-flag overdue">متأخر</span>';if(dueSoon(t))return '<span class="task-flag soon">قريب</span>';return '';}
  // يقاس الزمن من لحظة إضافة الطلب حتى الضغط على علامة إنجازه. قبل الإنجاز المؤشر مؤقت.
  // لا تعرض تقييماً نهائياً قبل إتمام المهمة؛ نقارن يوم الإضافة بالتسليم الفعلي والموعد المحدد.
  function elapsedRating(t){
    if(t.status!=='done'||!t.completed_at)return '<span class="time-rating unrated" title="لم تُنجز المهمة بعد" aria-label="لم تُقيّم بعد"><span class="stars" aria-hidden="true">☆☆☆☆☆</span></span>';
    const created=Date.parse(t.created_at||'');const completed=Date.parse(t.completed_at);
    if(!Number.isFinite(created)||!Number.isFinite(completed))return '<span class="time-rating unrated">☆☆☆☆☆</span>';
    const days=Math.max(0,(completed-created)/86400000);
    // إن كان الموعد متاحاً، تقاس دقة التسليم قياساً به؛ وإلا يُستخدم زمن التنفيذ.
    let score;
    if(t.due_date){const due=Date.parse(t.due_date+'T23:59:59');const late=(completed-due)/86400000;score=late<=0?5:late<=1?4:late<=2?3:late<=4?2:1;}
    else score=days<=1?5:days<=2?4:days<=4?3:days<=7?2:1;
    const label=t.due_date?`تم الإنجاز ${completed<=Date.parse(t.due_date+'T23:59:59')?'ضمن الموعد':'بعد الموعد'}`:`الإنجاز خلال ${Math.ceil(days)} يوم`;
    return `<span class="time-rating grade-${score}" title="${esc(label)}" aria-label="${esc(label)}: ${score} من 5"><span class="stars" aria-hidden="true">${'★'.repeat(score)}<span class="star-empty">${'☆'.repeat(5-score)}</span></span></span>`;
  }
  function miniTask(t){
    const done=t.status==='done';const due=t.due_date?`◷ ${when(t.due_date)}`:'';
    const warning=t.due_date&&isOverdue(t)?'<span class="compact-flag overdue" title="متأخر">!</span>':dueSoon(t)?'<span class="compact-flag soon" title="تسليم قريب">◷</span>':'';
    const phase=t.status==='progress'?'<span class="compact-stage" title="قيد العمل">◉</span>':'';
    return `<article class="task-item" data-task="${esc(t.id)}">
      <div class="task-compact urgency-${esc(t.urgency||'normal')} ${done?'is-done':''}">
        <button type="button" class="check-task ${done?'checked':''}" data-status="${done?'new':'done'}" data-id="${esc(t.id)}" aria-label="${done?'إعادة فتح':'تحديد مكتمل'}: ${esc(t.title)}" title="${done?'إعادة فتح المهمة':'تم الإنجاز'}">${done?'✓':''}</button>
        <button type="button" class="mini-task-main" data-detail="${esc(t.id)}" aria-controls="task-details-${esc(t.id)}" aria-expanded="false"><span class="mini-title">${esc(t.title)}</span><span class="mini-date">${urgencyTag(t)} ${warning} ${phase} ${due?`<span class="due-caption">${due}</span>`:''}</span></button>
        ${elapsedRating(t)}
        <button class="expand-chevron" type="button" data-detail="${esc(t.id)}" aria-controls="task-details-${esc(t.id)}" aria-expanded="false" aria-label="فتح تفاصيل ${esc(t.title)}">⌄</button>
      </div>
      <div class="task-expand" id="task-details-${esc(t.id)}" hidden></div>
    </article>`;
  }
  function groupCard(group){
    const pending=group.tasks.filter(t=>t.status!=='done').length;
    return `<section class="client-board"><div class="client-heading"><div class="client-avatar">${esc(group.name.slice(0,1))}</div><div class="client-heading-copy"><h3>${esc(group.name)}</h3><span>${pending} غير منجزة · ${group.tasks.length} إجمالي</span></div></div><div class="client-task-list">${group.tasks.map(miniTask).join('')}</div></section>`;
  }
  function dashboardTemplate(){
    const pending=state.tasks.filter(t=>t.status!=='done');
    const stats=[['الطلبات المفتوحة',pending.length,'all'],['المستعجل',pending.filter(isUrgent).length,'urgent'],['تسليم قريب أو متأخر',pending.filter(t=>dueSoon(t)||isOverdue(t)).length,'soon'],['المنجزة',state.tasks.length-pending.length,'done']];
    const groups=groupTasks(filteredTasks());
    return `<section class="dashboard"><div class="dashboard-head"><div><span class="eyebrow">لوحة تحكم خاصة</span><h1>مهامي <span>✳</span></h1><p>كل جهة لها قائمتها. اضغط عنوان المهمة لتظهر تفاصيلها تحتها مباشرة.</p></div><div class="dashboard-actions"><button class="plain-btn" id="refresh" type="button">↻ تحديث</button>${connected?'<button class="plain-btn" id="logout" type="button">خروج</button>':''}<a class="primary-btn" href="#request">+ طلب جديد</a></div></div>
      <div class="stats-grid">${stats.map(([label,count,key])=>`<button type="button" class="stat-box stat-${key} ${state.filter===(key==='all'?'open':key)?'active':''}" data-filter="${key==='all'?'open':key}"><span>${label}</span><strong>${count}</strong></button>`).join('')}</div>
      <div class="rating-guide">☆ التقييم بالرمادي حتى الإنجاز، وبعده يُحسب من تاريخ الإضافة إلى التسليم الفعلي مقارنةً بالموعد المطلوب.</div>
      <div class="board-toolbar"><div class="filter-tabs">${[['open','المفتوحة'],['all','الكل'],['progress','قيد التنفيذ'],['done','المنجزة']].map(([key,label])=>`<button class="filter-tab ${state.filter===key?'active':''}" type="button" data-filter="${key}">${label}</button>`).join('')}</div><div class="board-inputs"><input aria-label="ابحث عن جهة أو مهمة" id="search" placeholder="⌕ ابحث عن جهة أو مهمة" value="${esc(state.search)}"><select aria-label="ترتيب المهام" id="sort"><option value="priority" ${state.sort==='priority'?'selected':''}>الأولوية أولاً</option><option value="deadline" ${state.sort==='deadline'?'selected':''}>أقرب تسليم</option><option value="newest" ${state.sort==='newest'?'selected':''}>الأحدث أولاً</option></select></div></div>
      <div class="kanban-surface"><div class="client-grid" id="task-list">${state.loading?'<div class="empty-state">جارٍ تحميل المهام...</div>':groups.length?groups.map(groupCard).join(''):'<div class="empty-state"><span>✳</span><h3>ما فيه مهام في هذا القسم</h3><p>كل طلب يظهر تحت اسم الجهة الموجودة في نموذج العميل.</p></div>'}</div></div>
    </section>`;
  }
  function detailTemplate(t){
    const formats=safeFormatList(t);const done=t.status==='done';
    return `<div class="detail-sheet">
      <div class="details-meta"><span>${esc(STATUSES[t.status]||'جديد')}</span><span>أُضيف ${when(t.created_at)}</span>${done&&t.completed_at?`<span>أُنجز ${when(t.completed_at)}</span>`:''}</div>
      <div class="detail-section"><h3>النوع</h3><p>${esc(TYPES[t.type]||'تصميم آخر')}${formats.length?' · '+formats.map(esc).join(' + '):''}</p></div>
      <div class="detail-section"><h3>التفاصيل</h3><p class="preserve">${esc(t.details)}</p></div>
      ${t.contact?`<div class="detail-section"><h3>التواصل</h3><p>${esc(t.contact)}</p></div>`:''}
      ${t.reference_path?`<div class="detail-section"><h3>المرفق</h3><div data-attachment-for="${esc(t.id)}"><span class="muted">جارٍ تجهيز المرفق...</span></div></div>`:''}
      <div class="dialog-actions icon-actions">
        ${t.status==='new'?`<button type="button" class="icon-action" data-status="progress" data-id="${esc(t.id)}" title="بدء العمل" aria-label="بدء العمل">▶</button>`:''}
        <button type="button" class="icon-action complete-action" data-status="${done?'new':'done'}" data-id="${esc(t.id)}" title="${done?'إعادة فتح':'تم الإنجاز'}" aria-label="${done?'إعادة فتح':'تم الإنجاز'}">${done?'↺':'✓'}</button>
        <button type="button" class="icon-action delete-action" data-delete="${esc(t.id)}" title="حذف المهمة" aria-label="حذف المهمة">▤</button>
      </div>
      <div class="detail-section notes-section"><label for="notes-${esc(t.id)}">ملاحظاتي الخاصة <small>(لا يراها العميل)</small></label><textarea id="notes-${esc(t.id)}" data-notes-input="${esc(t.id)}" placeholder="اكتب الملاحظات أو سبب نقص الطلب..." maxlength="5000">${esc(t.internal_notes||'')}</textarea><button class="save-notes-btn" type="button" data-save-notes="${esc(t.id)}" title="حفظ الملاحظات" aria-label="حفظ الملاحظات">✓ حفظ</button></div>
    </div>`;
  }

  function bindRequest(){const form=document.getElementById('request-form');form?.addEventListener('submit',submitRequest);const type=document.getElementById('type');type?.addEventListener('change',()=>{const social=type.value==='social';document.getElementById('social-format').hidden=!social;if(!social)document.querySelectorAll('[name="formats"]').forEach(c=>c.checked=false);});document.getElementById('reference')?.addEventListener('change',ev=>{const f=ev.target.files[0];document.getElementById('file-label').textContent=f?f.name:'اضغط لاختيار ملف من جهازك';});}
  function validFile(file){if(!file)return true;const ext=(file.name.split('.').pop()||'').toLowerCase();return file.size<=FILE_LIMIT&&file.size>0&&VALID_EXT.has(ext);}
  async function submitRequest(event){event.preventDefault();if(state.sending)return;const form=event.currentTarget;const values=new FormData(form);const file=values.get('reference') instanceof File&&values.get('reference').size?values.get('reference'):null;const type=String(values.get('type')||'');const formats=values.getAll('formats').filter(x=>FORMAT_NAMES[x]);if(type==='social'&&!formats.length){toast('اختر بوست أو ستوري أو الاثنين.');return;}if(!validFile(file)){toast('المرجع يجب أن يكون صورة أو PDF أو ZIP وبحجم لا يتجاوز 15 MB.');return;}
    const id=window.crypto?.randomUUID?.();if(!id){toast('متصفحك لا يدعم إرسال طلب آمن. جرّب تحديثه.');return;}
    const extension=file?file.name.split('.').pop().toLowerCase():null;
    const payload={id,client_name:String(values.get('client_name')||'').trim(),contact:null,type,title:String(values.get('title')||'').trim(),details:String(values.get('details')||'').trim(),formats:type==='social'?formats:[],due_date:String(values.get('due_date')||'')||null,urgency:['normal','urgent','critical'].includes(values.get('urgency'))?values.get('urgency'):'normal',priority:values.get('urgency')==='critical'?'high':values.get('urgency')==='urgent'?'high':'medium',reference_path:file?`${id}/reference.${extension}`:null,reference_name:file?file.name.slice(0,180):null,status:'new'};
    if(payload.client_name.length<2||!TYPES[payload.type]||payload.title.length<3||payload.details.length<5){toast('أكمل الاسم ونوع العمل والعنوان والتفاصيل.');return;}
    state.sending=true;const btn=document.getElementById('submit-btn');btn.disabled=true;btn.textContent='جارٍ إرسال الطلب...';state.uploadWarning=false;
    try{if(connected){const {error}=await db.from('tasks').insert(payload);if(error)throw error;}else{state.tasks=loadDemo();state.tasks.unshift({...payload,created_at:new Date().toISOString(),completed_at:null});saveDemo();}
      if(file){try{if(connected){const {error}=await db.storage.from('design-references').upload(payload.reference_path,file,{upsert:false,contentType:file.type||undefined});if(error)throw error;}else{await fileStore('write',id,file);}}catch(e){console.error('Attachment upload:',e);state.uploadWarning=true;}}
      state.sent=true;render();if(state.uploadWarning)toast('تم تسجيل الطلب، لكن لم يكتمل رفع المرفق.');window.scrollTo({top:0,behavior:'smooth'});
    }catch(e){console.error(e);toast('تعذر إرسال الطلب. راجع الاتصال أو إعدادات الموقع.');}finally{state.sending=false;if(btn.isConnected){btn.disabled=false;btn.textContent='إرسال الطلب ←';}}}
  function bindDashboard(){if(!state.authorized){document.getElementById('login-form')?.addEventListener('submit',login);return;}
    document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.filter;render();}));
    document.getElementById('sort')?.addEventListener('change',e=>{state.sort=e.target.value;render();});
    document.getElementById('search')?.addEventListener('input',e=>{state.search=e.target.value;renderTasksOnly();});
    document.getElementById('refresh')?.addEventListener('click',loadTasks);
    document.getElementById('logout')?.addEventListener('click',async()=>{await db.auth.signOut();state.authorized=false;state.tasks=[];render();});
    bindTaskButtons();
  }
  function renderTasksOnly(){const list=document.getElementById('task-list');if(!list)return;const groups=groupTasks(filteredTasks());list.innerHTML=groups.length?groups.map(groupCard).join(''):'<div class="empty-state">ما لقينا نتائج للبحث</div>';bindTaskButtons();}
  function bindTaskButtons(root=document){root.querySelectorAll('[data-detail]').forEach(b=>b.addEventListener('click',()=>openDetail(b.dataset.detail)));
    root.querySelectorAll('[data-status]').forEach(b=>b.addEventListener('click',()=>changeStatus(b.dataset.id,b.dataset.status)));
    root.querySelectorAll('[data-delete]').forEach(b=>b.addEventListener('click',()=>removeTask(b.dataset.delete)));
    root.querySelectorAll('[data-save-notes]').forEach(b=>b.addEventListener('click',()=>saveNotes(b.dataset.saveNotes)));
    root.querySelectorAll('[data-priority-id]').forEach(b=>b.addEventListener('change',()=>changePriority(b.dataset.priorityId,b.value)));
  }
  function closeFileUrl(){if(state.fileUrl){URL.revokeObjectURL(state.fileUrl);state.fileUrl=null;}}
  async function openDetail(id){
    const t=state.tasks.find(x=>x.id===id);if(!t)return;
    const panel=document.getElementById(`task-details-${id}`);
    if(!panel)return;
    const alreadyOpen=!panel.hidden;
    document.querySelectorAll('.task-expand:not([hidden])').forEach(el=>{el.hidden=true;el.innerHTML='';});
    document.querySelectorAll('[data-detail]').forEach(el=>el.setAttribute('aria-expanded','false'));
    closeFileUrl();state.expandedId=null;
    if(alreadyOpen)return;
    panel.innerHTML=detailTemplate(t);panel.hidden=false;state.expandedId=id;
    document.querySelectorAll('[data-detail]').forEach(el=>{if(el.dataset.detail===id)el.setAttribute('aria-expanded','true');});
    bindTaskButtons(panel);
    if(t.reference_path){
      const link=panel.querySelector('[data-attachment-for]');
      try{
        let url;
        if(connected){const {data,error}=await db.storage.from('design-references').createSignedUrl(t.reference_path,600);if(error)throw error;url=data?.signedUrl;}
        else{const file=await fileStore('read',t.id);if(!file)throw new Error('no stored file');state.fileUrl=URL.createObjectURL(file);url=state.fileUrl;}
        if(url&&!panel.hidden&&link?.isConnected)link.innerHTML=`<a class="attachment-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">📎 فتح المرفق: ${esc(t.reference_name||'ملف مرجعي')}</a>`;
      }catch(e){if(!panel.hidden&&link?.isConnected)link.textContent='تعذر فتح المرفق؛ قد لا يكون اكتمل رفعه.';}
    }
  }
  async function login(event){event.preventDefault();const btn=document.getElementById('login-btn');btn.disabled=true;try{const email=document.getElementById('email').value.trim();const password=document.getElementById('password').value;const {error}=await db.auth.signInWithPassword({email,password});if(error)throw error;await checkAdmin();if(!state.authorized){await db.auth.signOut();throw new Error('not admin');}await loadTasks();}catch(e){toast('تعذر تسجيل الدخول. تحقق من الحساب وصلاحية المدير.');}finally{if(btn.isConnected)btn.disabled=false;}}
  async function saveTaskField(id,changes,success){const task=state.tasks.find(t=>t.id===id);if(!task)return;const before={...task};Object.assign(task,changes);state.expandedId=null;closeFileUrl();render();try{if(connected){const {error}=await db.from('tasks').update(changes).eq('id',id);if(error)throw error;}else saveDemo();toast(success);}catch(e){Object.assign(task,before);render();toast('ما قدرنا نحفظ التغيير.');console.error(e);}}
  async function saveNotes(id){const area=document.querySelector(`[data-notes-input="${id}"]`);if(!area)return;const notes=area.value.trim();if(notes.length>5000){toast('الملاحظات طويلة جدًا');return;}await saveTaskField(id,{internal_notes:notes},'تم حفظ ملاحظاتك الخاصة');}
  function changeStatus(id,status){if(!STATUSES[status])return;return saveTaskField(id,{status,completed_at:status==='done'?new Date().toISOString():null},status==='done'?'✓ تم إنجاز المهمة':'تم تحديث حالة المهمة');}
  function changePriority(id,priority){if(!PRIORITIES[priority])return;return saveTaskField(id,{priority},'تم تغيير أولوية المهمة');}
  async function removeTask(id){const t=state.tasks.find(x=>x.id===id);if(!t||!confirm(`حذف مهمة «${t.title}» نهائيًا؟`))return;const index=state.tasks.indexOf(t);state.tasks.splice(index,1);state.expandedId=null;closeFileUrl();render();try{if(connected){const {error}=await db.from('tasks').delete().eq('id',id);if(error)throw error;}else{saveDemo();try{await fileStore('delete',id);}catch{}}toast('تم حذف المهمة');}catch(e){state.tasks.splice(index,0,t);render();toast('تعذر حذف المهمة');}}
  window.addEventListener('hashchange',route);
  if(!location.hash)location.hash='#request';else route();
})();
