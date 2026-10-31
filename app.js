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
  const state = { authorized:!hasConfig, filter:'open', sort:'priority', search:'', tasks:[], loading:false, sending:false, sent:false, uploadWarning:false, fileUrl:null, expandedId:null, boardMode:localStorage.getItem('talabati-board-mode')==='white'?'white':'dark', reportOpen:false, reportPeriod:'week', reportFrom:'', reportTo:'', fontScale:(()=>{const value=Number(localStorage.getItem('talabati-font-scale'));return Number.isFinite(value)&&value>0?value:1})(), widths:(()=>{try{return JSON.parse(localStorage.getItem('talabati-board-widths')||'{}')||{}}catch{return {}}})() };

  function todayISO(offset=0) {
    const d = new Date(); d.setDate(d.getDate()+offset);
    return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  }
  function timeOffset(days){ return new Date(Date.now()+days*86400000).toISOString(); }
  function esc(v=''){return String(v??'').replace(/[&<>"']/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));}
  function when(v){ if(!v)return 'بدون موعد';const d=new Date(String(v).length===10 ? `${v}T12:00:00` : v);return Number.isNaN(d.getTime())?'بدون موعد':new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',{day:'numeric',month:'short',year:'numeric'}).format(d); }
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
  function isUrgent(t){return t.status!=='done'&&t.urgency==='urgent';}
  function urgencyTag(t){const v=t.urgency==='critical'?['critical','🚩','بالغ الأهمية']:t.urgency==='urgent'?['urgent','⚡','مستعجل']:['normal',svgIcon('leaf'),'عادي'];return `<span class="urgency-symbol ${v[0]}" title="${v[2]}" aria-label="${v[2]}">${v[1]}</span>`;}
  function isOverdue(t){return t.status!=='done'&&Boolean(t.due_date)&&t.due_date<todayISO();}
  function dueSoon(t){return t.status!=='done'&&Boolean(t.due_date)&&t.due_date>=todayISO()&&t.due_date<=todayISO(2);}
  function priorityWeight(t){return (isOverdue(t)?5:0)+(t.urgency==='critical'?8:isUrgent(t)?4:0)+(dueSoon(t)?3:0)+({high:2,medium:1,low:0}[t.priority]??1);}
  function safeFormatList(t){return (Array.isArray(t.formats)?t.formats:[]).filter(f=>FORMAT_NAMES[f]).map(f=>FORMAT_NAMES[f]);}
  function updateNav(){const admin=location.hash==='#admin';document.getElementById('nav-request').classList.toggle('active',!admin);document.getElementById('nav-admin')?.classList.toggle('active',admin);document.getElementById('demo-banner').hidden=connected;}
  async function checkAdmin(){if(!connected){state.authorized=true;return;}const {data:{user},error}=await db.auth.getUser();if(error||!user){state.authorized=false;return;}const result=await db.from('admins').select('user_id').eq('user_id',user.id).maybeSingle();state.authorized=Boolean(result.data&&!result.error);}
  async function loadTasks(){state.loading=true;render();try{if(!connected){state.tasks=loadDemo();}else{const {data,error}=await db.from('tasks').select('*').order('created_at',{ascending:false}).limit(1000);if(error)throw error;state.tasks=data||[];}}catch(e){console.error(e);toast('تعذر تحميل المهام. راجع الاتصال وصلاحياتك.');}finally{state.loading=false;render();}}
  async function route(){updateNav();closeFileUrl();if(hasConfig&&!connected){app.innerHTML='<div class="panel notice-panel">تعذر تحميل الاتصال بقاعدة البيانات. تأكد من الإنترنت وأعد تحميل الصفحة. لم ننتقل لوضع التجربة حتى لا تضيع طلبات العملاء.</div>';return;}if(location.hash==='#admin'){if(connected)await checkAdmin();if(state.authorized)await loadTasks();else render();}else{state.sent=false;render();}window.scrollTo({top:0,behavior:'instant'});}
  function render(){const oldStrip=document.getElementById('task-list');const prevScroll=oldStrip?oldStrip.scrollLeft:null;updateNav();if(location.hash==='#admin'){app.innerHTML=state.authorized?dashboardTemplate():loginTemplate();bindDashboard();if(prevScroll!==null){const next=document.getElementById('task-list');if(next)next.scrollLeft=prevScroll;}}else if(state.sent){app.innerHTML=successTemplate();document.getElementById('new-request')?.addEventListener('click',()=>{state.sent=false;render();});}else{app.innerHTML=requestTemplate();bindRequest();}}

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
  function filteredTasks(){const q=state.search.trim().toLocaleLowerCase();return state.tasks.filter(t=>state.filter==='all'||(state.filter==='open'?t.status!=='done':state.filter==='urgent'?isUrgent(t):state.filter==='critical'?t.status!=='done'&&t.urgency==='critical':state.filter==='soon'?isOverdue(t)||dueSoon(t):t.status===state.filter)).filter(t=>!q||[t.client_name,t.title,t.details,TYPES[t.type]].some(x=>String(x||'').toLocaleLowerCase().includes(q))).sort((a,b)=>{if(state.sort==='priority'){const p=priorityWeight(b)-priorityWeight(a);if(p)return p;}if(state.sort==='deadline'){const delta=(a.due_date||'9999').localeCompare(b.due_date||'9999');if(delta)return delta;}return new Date(b.created_at)-new Date(a.created_at);});}
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
  function workDays(start,end){
    if(!start||!end)return 0;
    const a=new Date(start),b=new Date(end); if(!Number.isFinite(+a)||!Number.isFinite(+b)||b<a)return 0;
    let count=0; const d=new Date(a.getFullYear(),a.getMonth(),a.getDate()+1); const last=new Date(b.getFullYear(),b.getMonth(),b.getDate());
    for(;d<=last;d.setDate(d.getDate()+1)){if(d.getDay()!==5)count++;}
    return count;
  }
  function svgIcon(kind){const shapes={leaf:'<path d="M20 4c-8.7 0-15 3.6-15 10a6 6 0 0 0 6 6c6.4 0 10-6.3 9-16Z"/><path d="M4 21c3-6 7-9 12-12"/>',play:'<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/>',trash:'<path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6m4-6v6"/>',check:'<path d="M5 12l4 4L19 6"/>',back:'<path d="M4 11a8 8 0 1 1 2 6M4 5v6h6"/>',print:'<path d="M6 9V3h12v6M6 18H4v-8h16v8h-2M6 15h12v6H6z"/>',report:'<path d="M4 20V5h16v15M8 16v-5m4 5V8m4 8v-3"/>',moon:'<path d="M20 15A8 8 0 0 1 9 4a8 8 0 1 0 11 11Z"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.5 1.5m11.2 11.2 1.5 1.5m0-14.2-1.5 1.5M6.4 17.6l-1.5 1.5"/>'};return `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[kind]||''}</svg>`;}
  // يقاس الزمن من لحظة إضافة الطلب حتى الضغط على علامة إنجازه. قبل الإنجاز المؤشر مؤقت.
  // لا تعرض تقييماً نهائياً قبل إتمام المهمة؛ نقارن يوم الإضافة بالتسليم الفعلي والموعد المحدد.
  function elapsedRating(t){
    if(t.status!=='done'||!t.completed_at)return '<span class="time-rating unrated" title="لم تُنجز المهمة بعد" aria-label="لم تُقيّم بعد"><span class="stars" aria-hidden="true">☆☆☆☆☆</span></span>';
    const created=Date.parse(t.created_at||'');const completed=Date.parse(t.completed_at);
    if(!Number.isFinite(created)||!Number.isFinite(completed))return '<span class="time-rating unrated">☆☆☆☆☆</span>';
    const days=workDays(t.created_at,t.completed_at);
    // إن كان الموعد متاحاً، تقاس دقة التسليم قياساً به؛ وإلا يُستخدم زمن التنفيذ.
    let score;
    if(t.due_date){const due=Date.parse(t.due_date+'T23:59:59');const late=completed<=due?0:workDays(t.due_date+'T00:00:00',t.completed_at);score=late<=0?5:late<=1?4:late<=2?3:late<=4?2:1;}
    else score=days<=1?5:days<=2?4:days<=4?3:days<=7?2:1;
    const label=t.due_date?`تم الإنجاز ${completed<=Date.parse(t.due_date+'T23:59:59')?'ضمن الموعد':'بعد الموعد'}`:`الإنجاز خلال ${Math.ceil(days)} يوم`;
    return `<span class="time-rating grade-${score}" title="${esc(label)}" aria-label="${esc(label)}: ${score} من 5"><span class="stars" aria-hidden="true">${'★'.repeat(score)}<span class="star-empty">${'☆'.repeat(5-score)}</span></span></span>`;
  }
  function miniTask(t){
    const done=t.status==='done';const due=t.due_date?when(t.due_date):'';
    const warning=dueSoon(t)?'<span class="compact-flag soon" title="تسليم خلال يومين" aria-label="تسليم قريب">'+svgIcon('clock')+'</span>':'';
    const phase=t.status==='progress'?'<span class="compact-stage progress-play" title="قيد التنفيذ">'+svgIcon('play')+'</span>':'';
    return `<article class="task-item" draggable="true" data-task="${esc(t.id)}">
      <div class="task-compact urgency-${esc(t.urgency||'normal')} ${done?'is-done':''}">
        <button type="button" class="check-task ${done?'checked':''}" data-status="${done?'new':'done'}" data-id="${esc(t.id)}" aria-label="${done?'إعادة فتح':'تحديد مكتمل'}: ${esc(t.title)}" title="${done?'إعادة فتح المهمة':'تم الإنجاز'}">${done?'✓':''}</button>
        <button type="button" class="mini-task-main" data-detail="${esc(t.id)}" aria-controls="task-details-${esc(t.id)}" aria-expanded="false"><span class="mini-title">${esc(t.title)} ${warning} ${phase}</span><span class="mini-date">${urgencyTag(t)} ${due?`<span class="due-caption">${due}</span>`:''}</span></button>
        ${elapsedRating(t)}
        <button class="expand-chevron" type="button" data-detail="${esc(t.id)}" aria-controls="task-details-${esc(t.id)}" aria-expanded="false" aria-label="فتح تفاصيل ${esc(t.title)}">⌄</button>
      </div>
      <div class="task-expand" id="task-details-${esc(t.id)}" hidden></div>
    </article>`;
  }
  function groupCard(group){
    const pending=group.tasks.filter(t=>t.status!=='done').length;
    return `<section class="client-board" data-client="${esc(group.name)}" style="--column-width:${Math.min(620,Math.max(260,Number(state.widths[group.name])||320))}px"><div class="client-heading"><div class="client-avatar">${esc(group.name.slice(0,1))}</div><div class="client-heading-copy"><h3>${esc(group.name)}</h3><span>${pending} غير منجزة · ${group.tasks.length} إجمالي</span></div></div><div class="client-task-list">${group.tasks.map(miniTask).join('')}</div><div class="resize-handle" title="اسحب لتغيير عرض العمود" role="separator" aria-label="تغيير عرض عمود ${esc(group.name)}">⋮⋮</div></section>`;
  }
  function circleStat(label,count,color,filter,icon,total){const ratio=total?Math.round(count/total*100):0;return `<button class="circle-stat" type="button" data-filter="${filter}" aria-label="${label}: ${count} من ${total}"><span class="donut" style="--progress:${ratio}%;--accent:${color}"><strong>${count}</strong><small>${ratio}%</small></span><span class="stat-label"><span class="stat-pict" style="color:${color}">${icon}</span>${label}</span></button>`;}
  function reportTasks(){const now=new Date(),d=new Date(now);d.setHours(0,0,0,0);let from;
    if(state.reportPeriod==='week'){d.setDate(d.getDate()-6);from=d;}else if(state.reportPeriod==='month'){d.setDate(d.getDate()-29);from=d;}else{from=state.reportFrom?new Date(state.reportFrom+'T00:00:00'):new Date('2000-01-01');}
    const to=state.reportPeriod==='custom'&&state.reportTo?new Date(state.reportTo+'T23:59:59'):now;
    return state.tasks.filter(t=>{const created=new Date(t.created_at);return created>=from&&created<=to;});
  }
  function reportMarkup(){const tasks=reportTasks(),completed=tasks.filter(x=>x.status==='done'&&x.completed_at),durations=completed.map(x=>workDays(x.created_at,x.completed_at));const mean=durations.length?(durations.reduce((a,b)=>a+b,0)/durations.length).toFixed(1):'—';const ontime=completed.filter(t=>!t.due_date||new Date(t.completed_at)<=new Date(t.due_date+'T23:59:59')).length;const overdue=tasks.filter(isOverdue).length;
    const clients=groupTasks(tasks).sort((a,b)=>b.tasks.length-a.tasks.length);
    return `<section class="report-panel" id="report-panel"><div class="report-title"><div><h2>تقرير أداء طلباتي</h2><p>المهام التي أُضيفت خلال الفترة المحددة، والتقييم يستثني أيام الجمعة</p></div><div class="report-title-actions"><button type="button" id="close-report" class="plain-btn report-close" aria-label="طي التقرير وإخفائه" title="طي التقرير وإخفائه">⌃</button><button type="button" id="print-report" class="plain-btn">${svgIcon('print')} طباعة</button></div></div><div class="report-controls"><select id="report-period"><option value="week" ${state.reportPeriod==='week'?'selected':''}>آخر 7 أيام</option><option value="month" ${state.reportPeriod==='month'?'selected':''}>آخر 30 يومًا</option><option value="custom" ${state.reportPeriod==='custom'?'selected':''}>تاريخ مخصص</option></select>${state.reportPeriod==='custom'?`<label>من <input type="date" id="report-from" value="${esc(state.reportFrom)}"></label><label>إلى <input type="date" id="report-to" value="${esc(state.reportTo)}"></label>`:''}</div><div class="report-metrics">${[['عدد المهام',tasks.length,100,'#78539b'],['عدد الجهات',clients.length,100,'#72549d'],['المنجزة',completed.length,tasks.length?completed.length/tasks.length*100:0,'#24a370'],['نسبة الإنجاز',tasks.length?Math.round(completed.length/tasks.length*100)+'%':'0%',tasks.length?completed.length/tasks.length*100:0,'#24a370'],['متوسط أيام العمل',mean,completed.length?Math.min(100,100/(1+Number(mean)||1)*3):0,'#965abd'],['أُنجزت في الموعد',completed.length?Math.round(ontime/completed.length*100)+'%':'—',completed.length?ontime/completed.length*100:0,'#268e9e'],['متأخرة حاليًا',overdue,tasks.length?overdue/tasks.length*100:0,'#d55256']].map(([k,v,pct,color])=>`<div class="report-metric"><span class="report-donut" style="--metric-progress:${Math.min(100,Math.max(0,pct))}%;--metric-color:${color}"><strong>${v}</strong></span><span class="report-metric-label">${k}</span></div>`).join('')}</div><h3>المهام حسب الجهة</h3><table class="report-table"><thead><tr><th>الجهة</th><th>العدد</th><th>المنجزة</th></tr></thead><tbody>${clients.map(g=>`<tr><td>${esc(g.name)}</td><td>${g.tasks.length}</td><td>${g.tasks.filter(t=>t.status==='done').length}</td></tr>`).join('')||'<tr><td colspan="3">لا توجد مهام في الفترة</td></tr>'}</tbody></table></section>`;
  }
  function dashboardTemplate(){const pending=state.tasks.filter(t=>t.status!=='done'),total=state.tasks.length;const groups=groupTasks(filteredTasks());return `<section class="dashboard v9-dashboard" style="--task-font-scale:${state.fontScale}"><div class="dashboard-head"><div><span class="eyebrow">لوحة تحكم خاصة</span><h1>مهامي</h1><p>كل جهة لها قائمتها، والمهام تنفتح تحتها مباشرة.</p></div><div class="dashboard-actions"><button class="plain-btn" id="refresh" type="button">↻ تحديث</button>${connected?'<button class="plain-btn" id="logout" type="button">خروج</button>':''}<a class="primary-btn" href="#request">+ طلب جديد</a></div></div>
    <div class="v9-stats"><div class="v9-stat-grid">${circleStat('مستعجل',pending.filter(t=>t.urgency==='urgent').length,'#e45047','urgent','⚡',total)}${circleStat('بالغ الأهمية',pending.filter(t=>t.urgency==='critical').length,'#8653ad','critical','🚩',total)}${circleStat('منجزة',state.tasks.filter(t=>t.status==='done').length,'#25a772','done','✓',total)}${circleStat('تسليم قريب',pending.filter(t=>dueSoon(t)||isOverdue(t)).length,'#e49b2b','soon','◷',total)}</div><button type="button" id="toggle-report" aria-expanded="${state.reportOpen}" class="report-toggle">${svgIcon('report')} التقارير</button></div>
    <p class="stats-hint">تسليم قريب يشمل المهام المتأخرة والمهام المستحقة خلال يومين. كل نسبة من إجمالي ${total} مهمة.</p>
    ${state.reportOpen?reportMarkup():''}
    <div class="board-toolbar"><div class="filter-tabs"><span class="client-total" title="عدد الجهات في القائمة">الجهات: ${groupTasks(state.tasks).length}</span>${[['open','المفتوحة'],['all','الكل'],['progress','قيد التنفيذ'],['done','المنجزة']].map(([key,label])=>`<button class="filter-tab ${state.filter===key?'active':''}" type="button" data-filter="${key}">${label}</button>`).join('')}</div><div class="board-inputs"><div class="font-controls" role="group" aria-label="حجم خط المهام"><button type="button" id="font-plus" title="تكبير خط المهام" aria-label="تكبير خط المهام">A+</button><button type="button" id="font-reset" title="الحجم الأصلي" aria-label="إعادة حجم الخط">A</button><button type="button" id="font-minus" title="تصغير خط المهام" aria-label="تصغير خط المهام">A−</button></div><button type="button" class="mode-toggle" id="board-mode" title="تغيير خلفية البورد" aria-label="تبديل خلفية البورد">${svgIcon(state.boardMode==='dark'?'sun':'moon')} ${state.boardMode==='dark'?'White':'Dark'}</button><input aria-label="بحث" id="search" placeholder="ابحث عن جهة أو مهمة" value="${esc(state.search)}"><select aria-label="ترتيب المهام" id="sort"><option value="priority" ${state.sort==='priority'?'selected':''}>الأولوية أولاً</option><option value="deadline" ${state.sort==='deadline'?'selected':''}>أقرب تسليم</option><option value="newest" ${state.sort==='newest'?'selected':''}>الأحدث أولاً</option></select></div></div>
    <div class="kanban-surface ${state.boardMode==='white'?'board-white':'board-dark'}"><div class="client-grid" id="task-list">${state.loading?'<div class="empty-state">جارٍ التحميل...</div>':groups.length?groups.map(groupCard).join(''):'<div class="empty-state">لا توجد مهام في هذا القسم</div>'}</div></div></section>`;}
  function detailTemplate(t){
    const formats=safeFormatList(t);const done=t.status==='done';
    return `<div class="detail-sheet">
      <div class="details-meta"><span>${esc(STATUSES[t.status]||'جديد')}</span><span>أُضيف ${when(t.created_at)}</span>${done&&t.completed_at?`<span>أُنجز ${when(t.completed_at)}</span>`:''}</div>
      <div class="detail-section"><h3>النوع</h3><p>${esc(TYPES[t.type]||'تصميم آخر')}${formats.length?' · '+formats.map(esc).join(' + '):''}</p></div>
      <div class="detail-section"><h3>التفاصيل</h3><p class="preserve">${esc(t.details)}</p></div>
      ${t.contact?`<div class="detail-section"><h3>التواصل</h3><p>${esc(t.contact)}</p></div>`:''}
      ${t.reference_path?`<div class="detail-section"><h3>المرفق</h3><div data-attachment-for="${esc(t.id)}"><span class="muted">جارٍ تجهيز المرفق...</span></div></div>`:''}
      <div class="dialog-actions icon-actions">
        ${t.status==='new'?`<button type="button" class="icon-action" data-status="progress" data-id="${esc(t.id)}" title="بدء العمل" aria-label="بدء العمل">${svgIcon('play')}</button>`:''}
        <button type="button" class="icon-action complete-action" data-status="${done?'new':'done'}" data-id="${esc(t.id)}" title="${done?'إعادة فتح':'تم الإنجاز'}" aria-label="${done?'إعادة فتح':'تم الإنجاز'}">${svgIcon(done?'back':'check')}</button>
        <button type="button" class="icon-action delete-action" data-delete="${esc(t.id)}" title="حذف المهمة" aria-label="حذف المهمة">${svgIcon('trash')}</button>
      </div>
      <div class="detail-section notes-section"><label for="notes-${esc(t.id)}">ملاحظاتي الخاصة <small>(لا يراها العميل)</small></label><textarea id="notes-${esc(t.id)}" data-notes-input="${esc(t.id)}" placeholder="اكتب الملاحظات أو سبب نقص الطلب... (تُحفظ تلقائيًا)" maxlength="5000">${esc(t.internal_notes||'')}</textarea><small class="notes-autosave-status" data-notes-status="${esc(t.id)}">تُحفظ تلقائيًا</small></div>
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
    [['font-plus',.1],['font-minus',-.1],['font-reset',0]].forEach(([id,delta])=>document.getElementById(id)?.addEventListener('click',()=>{state.fontScale=delta===0?1:(delta>0?state.fontScale*1.12:state.fontScale/1.12);localStorage.setItem('talabati-font-scale',String(state.fontScale));document.querySelector('.v9-dashboard')?.style.setProperty('--task-font-scale',state.fontScale);document.querySelectorAll('.font-controls button').forEach(button=>{button.title=(button.id==='font-plus'?'تكبير':button.id==='font-minus'?'تصغير':'إعادة الحجم')+' · '+Math.round(state.fontScale*100)+'%';});}));
    document.getElementById('board-mode')?.addEventListener('click',()=>{state.boardMode=state.boardMode==='dark'?'white':'dark';localStorage.setItem('talabati-board-mode',state.boardMode);render();});
    document.getElementById('toggle-report')?.addEventListener('click',()=>{state.reportOpen=!state.reportOpen;render();});
    document.getElementById('close-report')?.addEventListener('click',()=>{state.reportOpen=false;render();});
    document.getElementById('report-period')?.addEventListener('change',e=>{state.reportPeriod=e.target.value;render();});
    document.getElementById('report-from')?.addEventListener('change',e=>{state.reportFrom=e.target.value;render();});
    document.getElementById('report-to')?.addEventListener('change',e=>{state.reportTo=e.target.value;render();});
    document.getElementById('print-report')?.addEventListener('click',()=>window.print());
    document.getElementById('logout')?.addEventListener('click',async()=>{await db.auth.signOut();state.authorized=false;state.tasks=[];render();});
    bindTaskButtons();bindBoardMovement();
    const strip=document.getElementById('task-list');
    // Vertical mouse-wheel scrolls the horizontal lane; text fields keep natural behavior.
    strip?.addEventListener('wheel',e=>{if(strip.scrollWidth<=strip.clientWidth+2)return;if(e.target.closest('textarea,input,select,[contenteditable="true"]'))return;const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;if(!delta)return;e.preventDefault();strip.scrollLeft+=delta;},{passive:false});
    // Allow click-and-drag panning from the board background AND client headings.
    // Task cards still use native drag/drop to move between clients.
    let pan=null;
    strip?.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('.task-item,.resize-handle,button,input,textarea,select,a'))return;if(strip.scrollWidth<=strip.clientWidth+2)return;pan={x:e.clientX,left:strip.scrollLeft,moved:false};strip.setPointerCapture(e.pointerId);strip.classList.add('panning');});
    strip?.addEventListener('pointermove',e=>{if(!pan)return;const dx=e.clientX-pan.x;if(Math.abs(dx)>4)pan.moved=true;strip.scrollLeft=pan.left-dx;});
    const stopPan=e=>{if(!pan)return;const moved=pan.moved;pan=null;strip?.classList.remove('panning');if(e?.pointerId!=null&&strip?.hasPointerCapture(e.pointerId))strip.releasePointerCapture(e.pointerId);if(moved)strip.dataset.justPanned='true';};
    strip?.addEventListener('pointerup',stopPan);strip?.addEventListener('pointercancel',stopPan);
    strip?.addEventListener('click',e=>{if(strip.dataset.justPanned==='true'){delete strip.dataset.justPanned;e.preventDefault();e.stopPropagation();}},true);
  }
  function renderTasksOnly(){const list=document.getElementById('task-list');if(!list)return;const groups=groupTasks(filteredTasks());list.innerHTML=groups.length?groups.map(groupCard).join(''):'<div class="empty-state">ما لقينا نتائج للبحث</div>';bindTaskButtons();bindBoardMovement();}
  function bindTaskButtons(root=document){root.querySelectorAll('[data-detail]').forEach(b=>b.addEventListener('click',()=>openDetail(b.dataset.detail)));
    root.querySelectorAll('[data-status]').forEach(b=>b.addEventListener('click',()=>changeStatus(b.dataset.id,b.dataset.status)));
    root.querySelectorAll('[data-delete]').forEach(b=>b.addEventListener('click',()=>removeTask(b.dataset.delete)));
    root.querySelectorAll('[data-notes-input]').forEach(area=>{area.addEventListener('input',()=>{const id=area.dataset.notesInput;const status=area.parentElement.querySelector('[data-notes-status]');if(status)status.textContent='جارٍ الحفظ…';clearTimeout(notesTimers.get(id));notesTimers.set(id,setTimeout(()=>saveNotesQuietly(id,area),650));});area.addEventListener('blur',()=>{const id=area.dataset.notesInput;clearTimeout(notesTimers.get(id));saveNotesQuietly(id,area);});});
    root.querySelectorAll('[data-priority-id]').forEach(b=>b.addEventListener('change',()=>changePriority(b.dataset.priorityId,b.value)));
  }
  function bindBoardMovement(){
    document.querySelectorAll('.task-item[draggable]').forEach(item=>{item.addEventListener('dragstart',e=>{if(e.target.closest('button')){e.preventDefault();return;}e.dataTransfer.setData('text/plain',item.dataset.task);e.dataTransfer.effectAllowed='move';item.classList.add('dragging');});item.addEventListener('dragend',()=>item.classList.remove('dragging'));});
    document.querySelectorAll('.client-board').forEach(board=>{board.addEventListener('dragover',e=>{e.preventDefault();board.classList.add('drag-over');});board.addEventListener('dragleave',e=>{if(!board.contains(e.relatedTarget))board.classList.remove('drag-over');});board.addEventListener('drop',e=>{e.preventDefault();board.classList.remove('drag-over');const id=e.dataTransfer.getData('text/plain');const t=state.tasks.find(x=>x.id===id);if(t&&t.client_name!==board.dataset.client)saveTaskField(id,{client_name:board.dataset.client},'نُقلت المهمة إلى '+board.dataset.client);});
      const grip=board.querySelector('.resize-handle');grip?.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();const x=e.clientX,start=board.getBoundingClientRect().width,name=board.dataset.client;grip.setPointerCapture(e.pointerId);const move=ev=>{const delta=(document.documentElement.dir==='rtl'?-1:1)*(ev.clientX-x);const width=Math.min(620,Math.max(260,start+delta));board.style.setProperty('--column-width',width+'px');};const up=()=>{state.widths[name]=Math.round(board.getBoundingClientRect().width);localStorage.setItem('talabati-board-widths',JSON.stringify(state.widths));grip.removeEventListener('pointermove',move);grip.removeEventListener('pointerup',up);};grip.addEventListener('pointermove',move);grip.addEventListener('pointerup',up);});
    });
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
  const notesTimers=new Map();
  const notesSaving=new Map();
  async function saveNotesQuietly(id,area){
    if(!area)return;
    const task=state.tasks.find(t=>t.id===id);if(!task)return;
    const notes=area.value;const prior=task.internal_notes||'';
    if(notes===prior)return;
    const status=area.parentElement.querySelector('[data-notes-status]');
    // Chain writes to avoid older autosave requests overwriting newer edits.
    const previous=notesSaving.get(id)||Promise.resolve();
    const current=previous.catch(()=>{}).then(async()=>{
      try{
        if(connected){const {error}=await db.from('tasks').update({internal_notes:notes}).eq('id',id);if(error)throw error;}
        task.internal_notes=notes;if(!connected)saveDemo();
        if(status?.isConnected)status.textContent=area.value===notes?'تم الحفظ ✓':'جارٍ الحفظ…';
      }catch(err){console.error(err);if(status?.isConnected)status.textContent='تعذر الحفظ، حاول تعديل النص مجددًا';}
    });
    notesSaving.set(id,current);await current;
  }
  async function saveNotes(id){const area=document.querySelector(`[data-notes-input="${id}"]`);if(!area)return;const notes=area.value.trim();if(notes.length>5000){toast('الملاحظات طويلة جدًا');return;}await saveTaskField(id,{internal_notes:notes},'تم حفظ ملاحظاتك الخاصة');}
  function changeStatus(id,status){if(!STATUSES[status])return;return saveTaskField(id,{status,completed_at:status==='done'?new Date().toISOString():null},status==='done'?'✓ تم إنجاز المهمة':'تم تحديث حالة المهمة');}
  function changePriority(id,priority){if(!PRIORITIES[priority])return;return saveTaskField(id,{priority},'تم تغيير أولوية المهمة');}
  async function removeTask(id){const t=state.tasks.find(x=>x.id===id);if(!t||!confirm(`حذف مهمة «${t.title}» نهائيًا؟`))return;const index=state.tasks.indexOf(t);state.tasks.splice(index,1);state.expandedId=null;closeFileUrl();render();try{if(connected){const {error}=await db.from('tasks').delete().eq('id',id);if(error)throw error;}else{saveDemo();try{await fileStore('delete',id);}catch{}}toast('تم حذف المهمة');}catch(e){state.tasks.splice(index,0,t);render();toast('تعذر حذف المهمة');}}
  window.addEventListener('hashchange',route);
  if(!location.hash)location.hash='#request';else route();
})();
