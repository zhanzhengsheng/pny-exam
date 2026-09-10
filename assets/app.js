/* ============================================================
 * 小王早日上岸 主逻辑
 * 数据存 localStorage，零后端，可直接静态托管
 * ============================================================ */
(function(){
"use strict";

/* ---------- 常量 ---------- */
var LS_KEY = "pny_exam_v1";
var ROLE_ME = "me", ROLE_WIFE = "wife";
var DATASET = { me: window.PY_DATA, wife: window.HL_DATA };
var DEFAULT_EXAM_DATE = "2026-12-27"; // 笔试时间以官方通知为准，可在设置中修改
var SIGNUP_END = "2026-09-16";

/* ---------- 云同步（可选·Supabase 免费计划） ---------- */
var CLOUD_KEY = "pny_cloud_v1";         // 云端配置存储 key
var CLOUD_TABLE = "pny_sync";            // 数据库表名（需按 README 建表）
var supabaseClient = null;               // supabase-js 客户端实例
var cloudSub = null;                     // 实时订阅 channel
var cloudQueue = null;                   // 防抖定时器
var cloudStatus = "off";                 // off / loading / on / error
var cloudInitStarted = false;

/* ---------- 工具 ---------- */
function $(sel, root){ return (root||document).querySelector(sel); }
function el(tag, cls, html){ var e=document.createElement(tag); if(cls)e.className=cls; if(html!==undefined)e.innerHTML=html; return e; }
function today(){ var d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function daysUntil(dateStr){ if(!dateStr) return null; var t=new Date(dateStr+"T23:59:59").getTime(); if(isNaN(t))return null; return Math.ceil((t-Date.now())/86400000); }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c];}); }

/* ---------- 默认数据 ---------- */
function defaultUser(role){
  return {
    role: role,
    name: role==="me" ? "我（药学）" : "老婆（护理）",
    avatar: role==="me" ? "🐴" : "🌹",
    examDate: DEFAULT_EXAM_DATE,
    correct: {},   // 已答题: {qid: true/false}
    wrong: {},     // 错题: {qid: firstWrongTime}
    doneCh: {},    // 章节读完: {chId:true}
    checkins: [],  // 打卡日期串
    msgs: []       // 留言
  };
}
function loadDB(){
  try{ var d = JSON.parse(localStorage.getItem(LS_KEY)); if(d&&d.users) return d; }catch(e){}
  return { users:{ me:defaultUser("me"), wife:defaultUser("wife") }, active:"me", msgBoard:[] };
}
var DB = loadDB();
function save(){
  localStorage.setItem(LS_KEY, JSON.stringify(DB));
  cloudQueuePush(false); // 云端已启用时自动实时推送本机进度
}
function activeUser(){ return DB.users[DB.active]; }
function otherRole(){ return DB.active==="me" ? "wife" : "me"; }
function otherUser(){ return DB.users[otherRole()]; }

/* ---------- 状态 ---------- */
var state = { tab: "home", quiz:{ pool:[], idx:0, answers:{}, finished:false }, wrongQuizMode:false };

/* ============================================================
 * 渲染：导航/顶栏
 * ============================================================ */
function renderTop(){
  var u = activeUser();
  $("#userChip").textContent = u.name + " " + u.avatar;
}
function renderTabs(){
  $$(".tab-btn").forEach(function(b){
    b.classList.toggle("active", b.dataset.tab===state.tab);
  });
  var n = Object.keys(activeUser().wrong||{}).length;
  var badge = $("#wrongBadge");
  if(n>0){ badge.textContent=n; badge.classList.remove("hidden"); } else badge.classList.add("hidden");
}
function $$(s,r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); }

/* ============================================================
 * 首页
 * ============================================================ */
function renderHome(){
  var u = activeUser(); var data = DATASET[u.role];
  var examD = daysUntil(u.examDate); var signD = daysUntil(SIGNUP_END);
  var cnt = Object.keys(u.correct).length;
  var right = Object.values(u.correct).filter(function(v){return v;}).length;
  var acc = cnt ? Math.round(right/cnt*100) : 0;
  var streak = calcStreak(u.checkins);
  var checked = u.checkins.indexOf(today()) > -1;
  var totalQ = data.questions.length;

  var me = u, wife = otherUser();
  var mePct = cnt ? Math.round(cnt/totalQ*100) : 0;
  var wifeImp = (DB.imported||{})[wife.role];
  var wifeCnt = wifeImp ? Object.keys(wifeImp.correct||{}).length : Object.keys(wife.correct).length;
  var wifePct = wifeCnt ? Math.round(wifeCnt/data.questions.length*100) : 0;

  var c = $(".content"); c.innerHTML = "";

  // Hero
  var hero = el("div","hero");
  hero.innerHTML =
    "<h2>💊 "+esc(u.name)+" · "+esc(data.meta.subject)+"</h2>"+
    "<div class='meta'>📖 内容："+esc(data.meta.content)+"<br>✍️ 满分"+data.meta.fullScore+"分 · 合格线"+data.meta.passLine+"分 · 约"+data.meta.totalMinutes+"分钟 · "+esc(data.meta.weight)+"</div>"+
    "<div class='countdown'>"+
      "<div class='cd-box'><div class='num'>"+(examD!=null&&examD>=0?examD:"?" )+"</div><div class='lbl'>距笔试(日)</div></div>"+
      "<div class='cd-box'><div class='num'>"+(signD!=null&&signD>=0?signD:"已结束")+"</div><div class='lbl'>报名截止(日)</div></div>"+
      "<div class='cd-box'><div class='num'>"+totalQ+"</div><div class='lbl'>题库总题数</div></div>"+
    "</div>";
  c.appendChild(hero);

  // 打卡
  var check = el("div","card");
  check.innerHTML =
    "<h3>📅 每日打卡</h3>"+
    "<p class='sub'>连续打卡 <b style='color:var(--primary)'>"+streak+"</b> 天"+(checked?" · 今日已打卡 ✅":"")+"</p><br>"+
    "<button class='btn block' id='btnCheck'>"+(checked?"已打卡（再次点击+1）":"✅ 今日打卡")+"</button>";
  c.appendChild(check);
  $("#btnCheck").onclick = function(){
    u.checkins.push(today()); save(); toast("打卡成功，连续 "+calcStreak(u.checkins)+" 天 🎉"); renderHome();
  };

  // 统计
  var stats = el("div","stat-grid");
  stats.innerHTML =
    "<div class='stat-box'><div class='num'>"+cnt+"</div><div class='lbl'>已刷题</div></div>"+
    "<div class='stat-box'><div class='num'>"+right+"</div><div class='lbl'>答对</div></div>"+
    "<div class='stat-box'><div class='num'>"+acc+"%</div><div class='lbl'>正确率</div></div>"+
    "<div class='stat-box'><div class='num'>"+Object.keys(u.wrong).length+"</div><div class='lbl'>待复习错题</div></div>";
  c.appendChild(stats);

  // 双人对比
  var pc = el("div","pair-compare");
  pc.innerHTML =
    "<h3>👀 双人进度对比</h3>"+
    pairRow("🐴 "+esc(me.name), mePct, mePct, "me")+
    pairRow("🌹 "+esc(wife.name), wifePct, wifePct, "wife")+
    "<div id='cloudBadgeHome' class='cloud-badge' style='display:none;margin-top:8px'></div>"+
    "<p class='sub' style='margin-top:6px'>对方进度：开启云端实时同步后自动更新；未开启时请在「监督」页导入对方的同步码。</p>";
  c.appendChild(pc);
  refreshCloudUi();

  // 快捷操作
  var quick = el("div","card");
  quick.innerHTML =
    "<h3>⚡ 快捷操作</h3>"+
    "<div style='display:flex;gap:10px;flex-wrap:wrap'>"+
      "<button class='btn' id='goQuiz'>开始刷题</button>"+
      "<button class='btn warn' id='goStudy'>去看复习要点</button>"+
      "<button class='btn ghost' id='goSuper'>监督页</button>"+
    "</div>";
  c.appendChild(quick);
  $("#goQuiz").onclick=function(){ showTab("quiz"); };
  $("#goStudy").onclick=function(){ showTab("study"); };
  $("#goSuper").onclick=function(){ showTab("super"); };
}

function pairRow(name, value, text, cls){
  var v = Math.min(value,100);
  return "<div class='pair-row'><div class='pair-name'><span>"+name+"</span><span>"+text+"%</span></div>"+
    "<div class='bar-wrap'><div class='bar-fill "+(cls==="me"?"me":"")+"' style='width:"+v+"%'></div>"+
    "<div class='bar-text'>"+text+"%</div></div></div>";
}

function calcStreak(arr){
  var s=new Set(arr); var d=new Date(); var n=0;
  while(true){ var ds=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); if(s.has(ds)){n++; d.setDate(d.getDate()-1);} else break; }
  return n;
}

/* ============================================================
 * 复习
 * ============================================================ */
function pointsHtml(ch){
  // 若该章节已拆分子科目（subs），按小科目分组集中展示，每个知识点单独一行
  if(ch.subs && ch.subs.length){
    return ch.subs.map(function(sg){
      var pts = (sg.points||[]).map(function(p){
        return "<div class='point'><span class='dot'>•</span><span>"+esc(p)+"</span></div>";
      }).join("");
      return "<div class='sub-group'><div class='sub-head'>"+esc(sg.title)+
        " <button class='btn sm ok quiz-sub' data-ch='"+esc(ch.id)+"' data-sub='"+esc(sg.id)+"'>去刷本题</button></div>"+pts+"</div>";
    }).join("");
  }
  return ch.points.map(function(p){return "<div class='point'><span class='dot'>•</span><span>"+esc(p)+"</span></div>";}).join("");
}
function mustKnowHtml(ch){
  var h="<div class='mk-title'>⭐ 必背速记</div>";
  ch.mustKnow.forEach(function(g){
    h+="<div class='mk-group'><div class='mk-head'>"+esc(g.t)+"</div>";
    g.items.forEach(function(it){ h+="<div class='mk-item'><span class='mk-arrow'>▸</span><span>"+esc(it)+"</span></div>"; });
    h+="</div>";
  });
  return h;
}
function renderStudy(){
  var u=activeUser(); var data=DATASET[u.role];
  var c=$(".content"); c.innerHTML="";
  var head=el("div","card");
  head.innerHTML="<h3>📚 复习资料 · "+esc(data.meta.subject)+"</h3><p class='sub'>点击章节展开：<b>『· 』为章节要点</b>，<b style='color:#e67700'>『⭐ 必背速记』</b>为按历年真题提炼的必背内容。读完可标记掌握。</p>";
  c.appendChild(head);
  var doneCount = data.chapters.filter(function(ch){return u.doneCh[ch.id];}).length;
  var doneCard=el("div","card");
  doneCard.innerHTML="<h3>✅ 掌握进度</h3><div style='height:16px;background:var(--border);border-radius:8px;overflow:hidden'><div style='height:100%;width:"+Math.round(doneCount/data.chapters.length*100)+"%;background:linear-gradient(90deg,#12b886,#40c057)'></div></div><p class='sub' style='margin-top:6px'>已完成 "+doneCount+"/"+data.chapters.length+" 章</p>";
  c.appendChild(doneCard);
  data.chapters.forEach(function(ch){
    var box=el("div","chapter"); box.id="ch-"+ch.id;
    var done=u.doneCh[ch.id];
    box.innerHTML=
      "<div class='chapter-head'><span class='icon'>"+(done?"✅":"📖")+"</span>"+
      "<div class='title'><b>"+esc(ch.title)+"</b><span>"+esc(ch.desc)+"</span></div>"+
      "<span class='arrow'>▼</span></div>"+
      "<div class='chapter-body'>"+
        pointsHtml(ch)+
        (ch.mustKnow?mustKnowHtml(ch):"")+
        "<div style='margin-top:10px'><button class='btn sm "+(done?"ghost":"ok")+"' data-role='mkdone' data-ch='"+ch.id+"'>"+(done?"已掌握（点击取消）":"标记为已掌握 ✅")+"</button></div>"+
      "</div>";
    c.appendChild(box);
    $(".chapter-head",box).onclick=function(){ box.classList.toggle("open"); };
    $("[data-role='mkdone']",box).onclick=function(e){ e.stopPropagation(); if(u.doneCh[ch.id]){delete u.doneCh[ch.id];}else{u.doneCh[ch.id]=true;} save(); renderStudy(); };
    // 子科目「去刷本题」入口：直接跳转刷题页并筛选该小科目
    $$(".quiz-sub",box).forEach(function(b){
      b.onclick=function(e){ e.stopPropagation(); jumpQuiz(b.dataset.ch, b.dataset.sub); };
    });
  });
}
// 直接进入某章节（可选小科目）的刷题
function jumpQuiz(chId, subId){
  state.tab="quiz"; renderTop(); renderTabs();
  startQuiz(chId, false, subId||"");
}

/* ============================================================
 * 刷题
 * ============================================================ */
function renderQuiz(){
  var u=activeUser(); var data=DATASET[u.role];
  var c=$(".content"); c.innerHTML="";
  // 题源选择
  var setup=el("div","card");
  setup.innerHTML="<h3>🎯 开始刷题</h3><p class='sub' style='margin-bottom:10px'>已做 "+Object.keys(u.correct).length+"/"+data.questions.length+" 题，正确率 "+accRate(u)+"%</p>";
  var selCh=el("select","select-style");
  selCh.innerHTML="<option value='all'>全部章节（随机）</option>"+data.chapters.map(function(ch){return "<option value='"+ch.id+"'>"+esc(ch.title)+"</option>";}).join("");
  setup.appendChild(selCh);
  // 子科目筛选下拉：仅当所选章节拆分了子科目时显示
  var selSub=el("select","select-style"); selSub.id="selSub";
  selSub.style.display="none";
  setup.appendChild(selSub);
  function refreshSub(keepValue){
    var chId=selCh.value;
    var chapter=null;
    data.chapters.forEach(function(x){ if(x.id===chId) chapter=x; });
    if(chapter && chapter.subs && chapter.subs.length){
      selSub.innerHTML="<option value=''>全部子科目</option>"+chapter.subs.map(function(sg){return "<option value='"+sg.id+"'>"+esc(sg.title)+"</option>";}).join("");
      if(keepValue){ selSub.value=keepValue; }
      selSub.style.display="";
    } else {
      selSub.style.display="none"; selSub.value="";
    }
  }
  refreshSub("");
  selCh.onchange=function(){ refreshSub(""); };
  var btnRow=el("div","quiz-actions");
  var b1=el("button","btn", "开始刷题"); var b2=el("button","btn warn","模拟卷（全卷20题）");
  btnRow.appendChild(b1); btnRow.appendChild(b2); setup.appendChild(btnRow);
  c.appendChild(setup);
  b1.onclick=function(){ var subId = selSub.style.display!=="none" ? selSub.value : ""; startQuiz(selCh.value, false, subId); };
  b2.onclick=function(){ startQuiz("all", true); };

  if(state.quiz.on){
    renderQuizArea();
  }
}

function accRate(u){ var cnt=Object.keys(u.correct).length; if(!cnt)return 0; var r=Object.values(u.correct).filter(function(v){return v;}).length; return Math.round(r/cnt*100); }

function qTypeTag(q){ if(q.type==="multi")return "多选"; if(q.type==="judge")return "判断"; return "单选"; }
function recordResult(cur, v, logAnswers){
  if(logAnswers && state.quiz.on){ state.quiz.answers[cur.id]=v; }
  var u=activeUser();
  var isRight = v===cur.ans;
  u.correct[cur.id]=isRight;
  if(!isRight){ if(!u.wrong[cur.id])u.wrong[cur.id]=Date.now(); }
  else { if(u.wrong[cur.id]){delete u.wrong[cur.id];} }
  save();
  return isRight;
}
function startQuiz(chId, isMock, subId){
  var u=activeUser(); var data=DATASET[u.role];
  var pool = data.questions.filter(function(q){
    if(chId!=="all" && q.ch!==chId) return false;
    if(subId && q.sub!==subId) return false;
    return true;
  });
  if(!pool.length){ state.quiz.on=false; renderQuiz(); toast("该分类下暂无题目，请换一个试试"); return; }
  // mock 模式抽 20 题
  if(isMock || pool.length>20){ pool = shuffle(pool).slice(0, Math.min(20, pool.length)); }
  else { pool = shuffle(pool); }
  state.quiz = { on:true, pool:pool, idx:0, answers:{}, finished:false, wrongQuizMode:false };
  renderQuizArea();
}
function shuffle(a){ for(var i=a.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=a[i];a[i]=a[j];a[j]=t;} return a; }

function renderQuizArea(){
  var u=activeUser(); var q=state.quiz;
  if(!q.on || q.finished){ renderQuiz(); return; }
  var data=DATASET[u.role];
  var c=$(".content"); c.innerHTML="";
  var chMap={}; data.chapters.forEach(function(x){chMap[x.id]=x.title;});
  var cur=q.pool[q.idx];
  var chosen=q.answers[cur.id];
  var multi=cur.type==="multi";
  var head=el("div","quiz-head");
  head.innerHTML="<span class='quiz-progress'>📝 "+(q.idx+1)+" / "+q.pool.length+"</span><span class='quiz-progress'>当前：刷题模式</span>";
  c.appendChild(head);
  var card=el("div","q-card");
  card.innerHTML=
    "<div class='q-meta'><span class='tag ch'>"+esc(chMap[cur.ch]||cur.ch)+"</span><span class='tag'>"+qTypeTag(cur)+"</span></div>"+
    "<div class='q-text'>"+(q.idx+1)+". "+esc(cur.q)+"</div>"+
    cur.opts.map(function(o){return "<button class='opt' data-v='"+o.charAt(0)+"'>"+esc(o)+"</button>";}).join("")+
    "<div class='explain' id='explain'><b>✅ 答案 "+esc(cur.ans)+"</b><br>"+esc(cur.exp)+"</div>"+
    (multi&&!chosen
      ? "<div class='quiz-actions'><button class='btn' id='submit' disabled>提交答案（至少选 2 项）</button>"+(q.idx>0?"<button class='btn ghost' id='prev'>← 上一题</button>":"")+"</div>"
      : "<div class='quiz-actions'>"+(q.idx>0?"<button class='btn ghost' id='prev'>← 上一题</button>":"")+"<button class='btn' id='next'>下一题 →</button></div>");
  c.appendChild(card);
  if(chosen){
    lockOptions(card, cur, chosen);
  } else if(multi){
    var sel={};
    function refreshSubmit(){
      var n=0,k; for(k in sel){ if(sel[k])n++; }
      var sb=$("#submit",card);
      if(!sb) return;
      sb.disabled = n<2;
      sb.textContent = n? "提交答案（已选 "+n+" 项）" : "提交答案（至少选 2 项）";
    }
    $$(".opt",card).forEach(function(btn){
      btn.onclick=function(){
        var v=btn.dataset.v;
        if(sel[v]){ delete sel[v]; btn.classList.remove("selected"); }
        else { sel[v]=1; btn.classList.add("selected"); }
        refreshSubmit();
      };
    });
    $("#submit",card).onclick=function(){
      var v=Object.keys(sel).sort().join("");
      if(!v) return;
      recordResult(cur, v, true);
      lockOptions(card, cur, v);
    };
  } else {
    $$(".opt",card).forEach(function(btn){
      btn.onclick=function(){
        var v=btn.dataset.v;
        if(q.answers[cur.id]) return;
        recordResult(cur, v, true);
        lockOptions(card, cur, v);
      };
    });
  }
  var nb=$("#next",card);
  if(nb){
    nb.onclick=function(){
      if(q.idx < q.pool.length-1){ q.idx++; renderQuizArea(); }
      else { q.finished=true; renderResult(u); }
    };
  }
  var pb=$("#prev",card);
  if(pb){
    pb.onclick=function(){
      if(q.idx>0){ q.idx--; renderQuizArea(); }
    };
  }
}
function lockOptions(card, cur, v){
  var ansA=(cur.type==="multi"?cur.ans.split(""):[cur.ans]);
  var vA=(cur.type==="multi"&&v?v.split(""):[v]);
  $$(".opt",card).forEach(function(btn){
    btn.disabled=true; btn.classList.remove("selected");
    var bv=btn.dataset.v;
    if(ansA.indexOf(bv)>=0) btn.classList.add("correct");
    else if(vA.indexOf(bv)>=0) btn.classList.add("wrong");
  });
  $("#explain",card).classList.add("show");
}
function renderResult(u){
  var q=state.quiz;
  var right=Object.values(q.answers).filter(function(v,i){var qid=q.pool[i].id;return q.answers[qid]===q.pool[i].ans;}).length;
  var c=$(".content"); c.innerHTML="";
  var card=el("div","card");
  card.innerHTML=
    "<h3>🏁 本轮完成</h3>"+
    "<div class='stat-grid'>"+
      "<div class='stat-box'><div class='num'>"+q.pool.length+"</div><div class='lbl'>题数</div></div>"+
      "<div class='stat-box'><div class='num' style='color:var(--ok)'>"+right+"</div><div class='lbl'>答对</div></div>"+
      "<div class='stat-box'><div class='num' style='color:var(--danger)'>"+(q.pool.length-right)+"</div><div class='lbl'>答错</div></div>"+
      "<div class='stat-box'><div class='num'>"+Math.round(right/q.pool.length*100)+"%</div><div class='lbl'>正确率</div></div>"+
    "</div>"+
    "<div class='quiz-actions' style='margin-top:6px'>"+
      "<button class='btn' id='again'>再来一轮</button>"+
      "<button class='btn warn' id='wrongGo'>去复习错题</button>"+
      "<button class='btn ghost' id='backHome'>返回首页</button>"+
    "</div>";
  c.appendChild(card);
  $("#again").onclick=function(){ state.quiz.on=false; renderQuiz(); };
  $("#wrongGo").onclick=function(){ showTab("wrong"); };
  $("#backHome").onclick=function(){ showTab("home"); };
}

/* ============================================================
 * 错题本
 * ============================================================ */
function renderWrong(){
  var u=activeUser(); var data=DATASET[u.role];
  var c=$(".content"); c.innerHTML="";
  var ids=Object.keys(u.wrong||{});
  if(!ids.length){
    var card=el("div","card");
    card.innerHTML="<h3>🎉 暂无错题</h3><p class='sub'>继续加油，答对会自动移出错题本。</p>";
    c.appendChild(card);
    var b=el("button","btn block","去刷题"); b.onclick=function(){showTab("quiz");}; c.appendChild(b);
    return;
  }
  var head=el("div","card");
  head.innerHTML="<h3>📕 错题本（"+ids.length+"）</h3><p class='sub'>点击「重做」可单独练习；答对后自动移出。</p>";
  c.appendChild(head);
  ids.forEach(function(id){
    var q=data.questions.find(function(x){return x.id===id;});
    if(!q) return;
    var chMap={}; data.chapters.forEach(function(x){chMap[x.id]=x.title;});
    var item=el("div","wrong-item");
    item.innerHTML=
      "<div class='q-meta'><span class='tag ch'>"+esc(chMap[q.ch]||"")+"</span></div>"+
      "<div class='q'>"+esc(q.q)+"</div>"+
      "<p class='sub'>正确答案：<b style='color:#2b8a3e'>"+esc(q.ans)+"</b> · "+q.opts.map(function(o){return o.charAt(0)===" "+q.ans?"":""; }).join("")+ (q.opts.length? "" :"") +"</p>"+
      "<button class='btn sm warn' data-id='"+id+"'>重做此题</button>";
    c.appendChild(item);
    $("[data-id]",item).onclick=function(){ redoWrong(id); };
  });
  var clearBtn=el("button","btn ghost block","清空错题本"); clearBtn.style.marginTop="6px";
  clearBtn.onclick=function(){ if(confirm("确定清空全部错题记录？")){ u.wrong={}; save(); renderWrong(); } };
  c.appendChild(clearBtn);
}
function redoWrong(id){
  var u=activeUser(); var data=DATASET[u.role];
  var q=data.questions.find(function(x){return x.id===id;});
  if(!q)return;
  var c=$(".content"); c.innerHTML="";
  var card=el("div","q-card");
  var chMap={}; data.chapters.forEach(function(x){chMap[x.id]=x.title;});
  var multi=q.type==="multi";
  card.innerHTML=
    "<div class='q-meta'><span class='tag ch' style='background:#ffe3e3;color:#c92a2a'>错题重做</span><span class='tag'>"+qTypeTag(q)+"</span></div>"+
    "<div class='q-text'>"+esc(q.q)+"</div>"+
    q.opts.map(function(o){return "<button class='opt' data-v='"+o.charAt(0)+"'>"+esc(o)+"</button>";}).join("")+
    "<div class='explain' id='explain'><b>✅ 答案 "+esc(q.ans)+"</b><br>"+esc(q.exp)+"</div>"+
    (multi
      ? "<div class='quiz-actions'><button class='btn' id='submit' disabled>提交答案（至少选 2 项）</button><button class='btn ghost' id='back' style='margin-left:6px'>返回错题本</button></div>"
      : "<div class='quiz-actions'><button class='btn ghost' id='back'>返回错题本</button></div>");
  c.appendChild(card);
  function doJudge(v){
    var isR=recordResult(q, v, false);
    lockOptions(card, q, v);
    if(isR){ delete u.wrong[q.id]; toast("答对了！已移出错题本 🎉"); }
    else { toast("还是错的，再记一次 💪"); }
  }
  if(multi){
    var sel={};
    function refreshSubmit(){
      var n=0,k; for(k in sel){ if(sel[k])n++; }
      var sb=$("#submit",card);
      if(!sb) return;
      sb.disabled = n<2;
      sb.textContent = n? "提交答案（已选 "+n+" 项）" : "提交答案（至少选 2 项）";
    }
    $$(".opt",card).forEach(function(btn){
      btn.onclick=function(){
        var v=btn.dataset.v;
        if(btn.disabled)return;
        if(sel[v]){ delete sel[v]; btn.classList.remove("selected"); }
        else { sel[v]=1; btn.classList.add("selected"); }
        refreshSubmit();
      };
    });
    $("#submit",card).onclick=function(){
      var v=Object.keys(sel).sort().join("");
      if(!v)return;
      doJudge(v);
    };
  } else {
    $$(".opt",card).forEach(function(btn){
      btn.onclick=function(){
        if(btn.disabled)return;
        var v=btn.dataset.v;
        doJudge(v);
      };
    });
  }
  $("#back").onclick=function(){ renderWrong(); };
}

/* ============================================================
 * 监督页
 * ============================================================ */
function renderSuper(){
  var u=activeUser(); var data=DATASET[u.role];
  var c=$(".content"); c.innerHTML="";

  var head=el("div","card");
  head.innerHTML="<h3>👫 互相监督</h3>"+
    "<div id='cloudBadgeSuper' class='cloud-badge' style='display:none;margin-bottom:8px'></div>"+
    "<p class='sub'>💡 建议在「设置」里开启<b>云端实时同步</b>：双方刷题/打卡/留言后对方秒收，无需手动传码。<br>若未开启，可使用下方同步码（进度快照）：刷完题点「生成同步码」发给对方，对方导入即可更新进度与留言，每次刷了新题需重发一次。</p>";
  c.appendChild(head);
  refreshCloudUi();

  // 两张进度卡
  var grid=el("div","super-grid");
  grid.appendChild(superCard(u, data));
  var wu=otherUser(); var wd=DATASET[wu.role];
  grid.appendChild(superCard(wu, wd, true));
  c.appendChild(grid);

  // 导出同步码
  var exp=el("div","card");
  exp.innerHTML="<h3>📤 我的同步码</h3>"+
    "<button class='btn block' id='genCode'>生成/复制我的进度同步码</button>"+
    "<div class='sync-box hidden' id='syncOut'><textarea class='sync-code' id='syncOutText' readonly></textarea><button class='btn sm ok' id='copyCode'>复制到剪贴板</button></div>";
  c.appendChild(exp);
  $("#genCode").onclick=function(){
    var code=encodeProgress(u);
    $("#syncOut").classList.remove("hidden");
    $("#syncOutText").value=code;
    toast("已生成同步码（含本机查看对方进度·请妥善拷给对方）");
  };
  $("#copyCode").onclick=function(){ var t=$("#syncOutText"); t.select(); try{document.execCommand("copy"); toast("已复制 ✅");}catch(e){toast("请手动复制");} };

  // 导入
  var imp=el("div","card");
  imp.innerHTML="<h3>📥 导入对方的同步码</h3><p class='sub' style='margin-bottom:8px'>粘贴对方发来的同步码，即可查看 TA 的进度并解锁对比。</p>"+
    "<textarea class='sync-code' id='impText' placeholder='粘贴对方同步码…'></textarea>"+
    "<button class='btn warn block' id='impBtn'>导入并查看对方进度</button>";
  c.appendChild(imp);
  $("#impBtn").onclick=function(){
    var code=$("#impText").value.trim(); if(!code){toast("请先粘贴同步码");return;}
    var r=decodeProgress(code);
    if(!r){ toast("同步码无效，请确认复制完整"); return; }
    DB.imported = DB.imported||{};
    DB.imported[r.role] = r.progress;
    // 合并对方随同步码送来的留言（按 id 去重）
    if(r.progress.msgs && r.progress.msgs.length){
      DB.msgBoard = DB.msgBoard||[];
      var has={}; DB.msgBoard.forEach(function(m){ if(m.id) has[m.id]=1; });
      r.progress.msgs.forEach(function(m){
        if(!has[m.id]){ DB.msgBoard.push(m); has[m.id]=1; }
      });
      save();
    }
    save(); renderSuper(); toast("已导入 "+r.roleName+" 的进度与留言 ✅");
  };

  // 对方进度展示（若导入过）
  if(DB.imported && DB.imported[otherRole()]){
    var ip=DB.imported[otherRole()];
    var view=el("div","card");
    view.innerHTML="<h3>👁 对方进度（来自同步码）</h3>"+
      "<div class='stat-grid'>"+
        "<div class='stat-box'><div class='num'>"+Object.keys(ip.correct||{}).length+"</div><div class='lbl'>对方已刷题</div></div>"+
        "<div class='stat-box'><div class='num'>"+((ip.name)||otherUser().name)+"</div><div class='lbl' style='font-size:10px'>对方昵称</div></div>"+
        "<div class='stat-box'><div class='num'>"+Object.keys(ip.wrong||{}).length+"</div><div class='lbl'>对方错题</div></div>"+
      "</div>"+
      "<button class='btn ghost block sm' id='rmImp'>清除对方导入的数据</button>";
    c.appendChild(view);
    $("#rmImp").onclick=function(){ delete DB.imported[otherRole()]; save(); renderSuper(); };
  }

  // 留言墙
  var msge=el("div","card");
  msge.innerHTML="<h3>💬 留言墙</h3><div id='msgList'></div>"+
    "<div class='msg-input'><input id='msgInput' placeholder='写一句给对方加油…'><button class='btn sm' id='msgSend'>发送</button></div>";
  c.appendChild(msge);
  var list=$("#msgList",msge);
  renderMsgs(list, u);
  $("#msgSend",msge).onclick=function(){ sendMsg(u); };
  $("#msgInput",msge).addEventListener("keydown",function(e){ if(e.key==="Enter") sendMsg(u); });
}
function superCard(u, data, isOther){
  var card=el("div","super-card"); card.className+=(isOther?" wife":"");
  var fromImp = isOther && DB.imported && DB.imported[u.role];
  var cnt=fromImp?Object.keys((fromImp.correct)||{}).length:Object.keys(u.correct||{}).length;
  var wr=fromImp?Object.keys((fromImp.wrong)||{}).length:Object.keys(u.wrong||{}).length;
  var chk=fromImp?((fromImp.checkins||[]).length):(u.checkins||[]).length;
  card.innerHTML=
    "<div class='avatar'>"+(u.avatar||"👤")+"</div>"+
    "<div class='name'>"+(fromImp?(fromImp.name||u.name):u.name)+"</div>"+
    "<div class='sub'>"+(fromImp?"（已导入对方数据）":esc(data.meta.subject))+"</div>"+
    "<div class='stat'>📖 已刷题：<span class='badge-q'>"+cnt+"</span><br>📕 错题：<span class='badge-q'>"+wr+"</span><br>📅 打卡天数：<span class='badge-q'>"+chk+"</span></div>";
  return card;
}
function renderMsgs(list, u){
  var msgs=(DB.msgBoard||[]).slice().reverse();
  list.innerHTML="";
  if(!msgs.length){ list.innerHTML="<p class='sub' style='padding:6px 0'>还没有留言，来写第一句吧～</p>"; return; }
  msgs.forEach(function(m){
    var isMe = m.role===u.role;
    var av = m.role==="me" ? "🐴" : "🌹";
    var who = m.role==="me" ? (DB.users.me.name||"我（药学）") : (DB.users.wife.name||"老婆（护理）");
    var item=el("div","msg-item");
    item.innerHTML="<div class='av'>"+av+"</div>"+
      "<div class='msg-bubble'"+(isMe?" style='background:linear-gradient(135deg,#e3fafc,#d0ebff)'":"")+"><div class='who'>"+(m.from||who)+" · "+m.time+"</div><p>"+esc(m.text)+"</p></div>";
    list.appendChild(item);
  });
}
function sendMsg(u){
  var inp=$("#msgInput"); var v=inp.value.trim(); if(!v)return;
  if(!DB.msgBoard)DB.msgBoard=[];
  var d=new Date();
  DB.msgBoard.push({id:("m"+Date.now()+Math.floor(Math.random()*9999)), text:v, role:u.role, from:u.name, time:(d.getMonth()+1)+"-"+d.getDate()+" "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")});
  inp.value=""; save(); renderSuper();
}
function encodeProgress(u){
  // msgs：把这台设备上“属于当前用户”的留言打包进同步码，随进度一起送达对方
  var myMsgs=(DB.msgBoard||[]).filter(function(m){return m.role===u.role;}).map(function(m){
    return { id:m.id, role:m.role, from:m.from||u.name, text:m.text, time:m.time };
  });
  var p={ role:u.role, name:u.name, correct:u.correct, wrong:u.wrong, checkins:u.checkins.slice(-90), msgs:myMsgs };
  return btoa(unescape(encodeURIComponent(JSON.stringify(p)))).replace(/=+$/,"");
}
function decodeProgress(code){
  try{
    var json=decodeURIComponent(escape(atob(code)));
    var p=JSON.parse(json);
    if(!p.role||!p.correct) return null;
    return { role:p.role, roleName: p.role==="me"?"药学":p.role==="wife"?"护理":"未知", progress:p };
  }catch(e){ return null; }
}

/* ============================================================
 * 设置
 * ============================================================ */
function renderSetting(){
  var u=activeUser();
  var c=$(".content"); c.innerHTML="";
  var card=el("div","card");
  card.innerHTML="<h3>⚙️ 设置</h3>"+
    "<div class='set-row'><div class='lbl'><b>切换账号</b><span>两人各自用不同角色的设备学习‑刷题</span></div>"+
    "<button class='btn ghost sm' id='switchMe'>切到我(药学)</button><button class='btn ghost sm' id='switchWife'>切到老婆(护理)</button></div>"+
    "<div class='set-row'><div class='lbl'><b>我的昵称</b><span>会显示在双人对比与留言中</span></div><input id='nick' class='select-style' value='"+esc(u.name)+"'></div>"+
    "<div class='set-row'><div class='lbl'><b>笔试日期</b><span>用于首页倒计时，以官方通知为准可随时改</span></div><input id='date' type='date' value='"+esc(u.examDate||"")+"'></div>"+
    "<div class='set-row'><div class='lbl'><b>重置我的数据</b><span>清空我的刷题、错题、打卡记录</span></div><button class='btn danger sm' id='resetMe'>重置</button></div>"+
    "<div class='set-row'><div class='lbl'><b>恢复默认全部数据</b><span>清空两人所有本机记录与留言</span></div><button class='btn danger sm' id='resetAll'>恢复默认</button></div>";
  c.appendChild(card);

  // 云端实时同步
  var cfg=cloudCfg();
  var cloud=el("div","card");
  cloud.innerHTML="<h3>☁️ 云端实时同步（免费）</h3>"+
    "<p class='sub' style='margin-bottom:10px'>使用 Supabase 免费数据库让两台设备实时互通：<b>刷题 / 打卡 / 留言后对方秒收</b>，无需再手动发同步码。</p>"+
    "<div class='cloud-field'><label>项目地址 URL</label><input id='cUrl' class='select-style' style='width:100%' placeholder='https://xxx.supabase.co' value='"+esc(cfg.url)+"'></div>"+
    "<div class='cloud-field'><label>anon 公开密钥 Key</label><input id='cKey' class='select-style' style='width:100%' placeholder='eyJhbGciOiJ...（Project Settings → API）' value='"+esc(cfg.key)+"'></div>"+
    "<div class='cloud-field'><label>同步房间号（两人填<b>相同</b>任意字符串即可互相通讯、与外界隔离）</label><input id='cRoom' class='select-style' style='width:100%' placeholder='如 pny2026-abc123' value='"+esc(cfg.room)+"'></div>"+
    "<p class='sub' style='margin:8px 0'>当前状态：<b style='color:"+(cloudStatus==="on"?"#12b886":cloudStatus==="error"?"#fa5252":"#868e96")+"'>"+cloudSwitchDesc(cloudStatus)+"</b></p>"+
    "<div style='display:flex;gap:10px;margin-top:4px'>"+
      "<button class='btn ok' id='cloudOn'>启用并连接</button>"+
      "<button class='btn danger' id='cloudOff'>断开连接</button>"+
    "</div>"+
    "<p class='sub' style='margin-top:10px;line-height:1.7'>首次使用：① supabase.com 免费注册并新建项目 → ② SQL Editor 粘贴执行建表语句（见项目 README）→ ③ 把 Project URL 与 anon key 填到上面，两头设备各自开启并填相同房间号即可。</p>";
  c.appendChild(cloud);
  $("#cloudOn").onclick=function(){
    var url=$("#cUrl").value.trim(), key=$("#cKey").value.trim(), room=$("#cRoom").value.trim();
    if(!url||!key||!room){ toast("请先填齐 URL、Key、房间号三项"); return; }
    var c2=cloudCfg(); c2.url=url; c2.key=key; c2.room=room; c2.enabled=true; cloudSaveCfg(c2);
    cloudInitStarted=false; initCloud(true);
  };
  $("#cloudOff").onclick=function(){ cloudDisable(); };

  var info=el("div","card");
  info.innerHTML="<h3>ℹ️ 报考信息速查</h3><div class='sub' style='line-height:2'>"+
    "📌 2026年普宁市医疗卫生等事业单位公开招聘 151 名<br>"+
    "🕘 报名时间：2026-09-10 09:00 ~ 09-16 17:30<br>"+
    "🌐 报名网站：全国事业单位招聘网·揭阳专栏<br>"+
    "📘 药学(你)：<b>《通用能力测试(卫生类)C卷》</b><br>"+
    "📗 护理(老婆)：<b>《通用能力测试(卫生类)B卷》</b><br>"+
    "✍️ 满分100 / 合格60 · 综合成绩 = 笔试60% + 面试40%<br>"+
    "⚠️ 报名需网上确认、打印准考证，请留意普宁市政府官网后续公告</div>";
  c.appendChild(info);

  $("#switchMe").onclick=function(){ DB.active="me"; save(); state.tab="home"; showTab("home"); };
  $("#switchWife").onclick=function(){ DB.active="wife"; save(); state.tab="home"; showTab("home"); };
  $("#nick").addEventListener("change",function(){ u.name=this.value; save(); toast("昵称已更新"); renderSetting(); });
  $("#date").addEventListener("change",function(){ u.examDate=this.value; save(); toast("笔试日期已更新"); });
  $("#resetMe").onclick=function(){ if(confirm("确定清空我（"+u.name+"）的所有学习数据？")){ DB.users[DB.active]=defaultUser(DB.active); DB.users[DB.active].name=u.name; save(); toast("已重置"); showTab("home"); } };
  $("#resetAll").onclick=function(){ if(confirm("确定恢复默认（清空两人全部数据）？")){ DB.users={me:defaultUser("me"),wife:defaultUser("wife")}; DB.active="me"; DB.imported={}; DB.msgBoard=[]; save(); toast("已恢复默认"); showTab("home"); } };
}

/* ============================================================
 * 云端实时同步（Supabase 免费计划，可选）
 * 表结构见项目 README：pny_sync(room,id,payload,updated_at)
 * ============================================================ */
function cloudCfg(){
  try{ var c=JSON.parse(localStorage.getItem(CLOUD_KEY)); if(c) return c; }catch(e){}
  return { url:"", key:"", room:"", enabled:false };
}
function cloudSaveCfg(c){ localStorage.setItem(CLOUD_KEY, JSON.stringify(c)); }
function loadSupabaseJs(cb){
  var s=document.createElement("script");
  s.src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
  s.onload=cb;
  s.onerror=function(){ cloudStatus="error"; refreshCloudUi(); toast("无法加载 Supabase SDK，请检查网络"); };
  document.head.appendChild(s);
}
function initCloud(force){
  var cfg=cloudCfg();
  if(!cfg.enabled || !cfg.url || !cfg.key || !cfg.room){ cloudStatus="off"; return; }
  if(cloudInitStarted && !force) return;
  cloudInitStarted=true;
  cloudStatus="loading"; refreshCloudUi();
  var init=function(){
    if(!window.supabase){ cloudStatus="error"; refreshCloudUi(); return; }
    try{
      supabaseClient = window.supabase.createClient(cfg.url, cfg.key);
      // 首次：拉取整房间数据，立即合并一次
      supabaseClient.from(CLOUD_TABLE)
        .select("id,payload")
        .eq("room", cfg.room)
        .then(function(res){
          if(res.error){ cloudStatus="error"; refreshCloudUi(); toast("云同步连接失败："+res.error.message); return; }
          (res.data||[]).forEach(function(row){ if(row.id && row.id!==DB.active) mergeRemote(row.payload, true); });
          cloudStatus="on"; refreshCloudUi();
          cloudPush();
          toast("云同步已连接 ✅");
        });
      // 实时订阅：对方一改动，本机立即收到
      cloudSub = supabaseClient.channel("pny-room-"+cfg.room)
        .on("postgres_changes",
          { event:"*", schema:"public", table:CLOUD_TABLE, filter:"room=eq."+cfg.room },
          function(payload){
            var row=payload.new;
            if(row && row.id && row.id!==DB.active){
              mergeRemote(row.payload, true);
              toast("收到对方云端更新 📡");
            }
          })
        .subscribe();
    }catch(e){ cloudStatus="error"; refreshCloudUi(); toast("云同步初始化失败"); }
  };
  if(window.supabase) init(); else loadSupabaseJs(init);
}
function cloudDisable(){
  if(cloudSub){ try{ supabaseClient && supabaseClient.removeChannel(cloudSub); }catch(e){} cloudSub=null; }
  supabaseClient=null; cloudInitStarted=false; cloudStatus="off";
  var cfg=cloudCfg(); cfg.enabled=false; cloudSaveCfg(cfg);
  refreshCloudUi(); toast("已关闭云端实时同步");
}
function cloudPayload(role){
  var u=DB.users[role];
  var myMsgs=(DB.msgBoard||[]).filter(function(m){ return m.role===role; }).map(function(m){
    return { id:m.id, role:m.role, from:m.from||u.name, text:m.text, time:m.time };
  });
  return { role:role, name:u.name, correct:u.correct||{}, wrong:u.wrong||{}, checkins:(u.checkins||[]).slice(-90), doneCh:u.doneCh||{}, msgs:myMsgs };
}
function cloudPush(){
  if(!supabaseClient || cloudStatus!=="on") return;
  var cfg=cloudCfg(); var p=cloudPayload(DB.active);
  supabaseClient.from(CLOUD_TABLE)
    .upsert({ room:cfg.room, id:DB.active, payload:JSON.stringify(p), updated_at:new Date().toISOString() })
    .then(function(res){ if(res.error){ cloudStatus="error"; refreshCloudUi(); } });
}
function cloudQueuePush(){
  if(!cloudCfg().enabled || !supabaseClient) return;
  if(cloudQueue) clearTimeout(cloudQueue);
  cloudQueue=setTimeout(function(){ cloudPush(); }, 600);
}
function mergeRemote(payloadJson, silent){
  if(!payloadJson) return;
  var p; try{ p=JSON.parse(payloadJson); }catch(e){ return; }
  if(!p.role || p.role===DB.active) return;
  var other=otherRole();
  var changed=false;
  DB.imported=DB.imported||{};
  var oldImp=DB.imported[other];
  var oldSolved= oldImp?Object.keys(oldImp.correct||{}).length:-1;
  var newSolved=Object.keys(p.correct||{}).length;
  if(newSolved!==oldSolved) changed=true;
  DB.imported[other]={ role:other, name:p.name||otherUser().name, correct:p.correct||{}, wrong:p.wrong||{}, checkins:p.checkins||[], doneCh:p.doneCh||{} };
  if(p.msgs && p.msgs.length){
    DB.msgBoard=DB.msgBoard||[];
    var has={}; DB.msgBoard.forEach(function(m){ if(m.id) has[m.id]=1; });
    var added=0;
    p.msgs.forEach(function(m){ if(!has[m.id]){ DB.msgBoard.push(m); has[m.id]=1; added++; } });
    if(added>0) changed=true;
  }
  if(changed) save();
  if(state.tab==="home") renderHome();
  else if(state.tab==="super") renderSuper();
  else renderTabs();
}
function cloudSwitchDesc(st){
  return { off:"未开启", loading:"连接中…", on:"已连接", error:"连接异常" }[st] || "未开启";
}
function refreshCloudUi(){
  var h=$("#cloudBadgeHome"); if(h) renderCloudBadge(h);
  var s=$("#cloudBadgeSuper"); if(s) renderCloudBadge(s);
}
function renderCloudBadge(node){
  var map={ off:["云同步未开启","#adb5bd"], loading:["云同步连接中…","#f59f00"], on:["云同步实时在线","#12b886"], error:["云同步连接异常","#fa5252"] };
  var m=map[cloudStatus]||map.off;
  node.style.display="inline-block";
  node.style.background=m[1];
  node.textContent=m[0];
}

/* ============================================================
 * 路由
 * ============================================================ */
var TABMAP={ home:renderHome, study:renderStudy, quiz:renderQuiz, wrong:renderWrong, super:renderSuper, setting:renderSetting };
function showTab(tab){
  state.tab=tab;
  renderTop(); renderTabs();
  TABMAP[tab]();
  window.scrollTo(0,0);
}

/* ---------- 事件绑定 / 启动 ---------- */
document.addEventListener("DOMContentLoaded",function(){
  $$(".tab-btn").forEach(function(b){ b.onclick=function(){ showTab(b.dataset.tab); }; });
  showTab("home");
  initCloud(false); // 若此前已启用云端同步，自动重连
});
/* 适配旧数据结构迁移 */
if(DB.users.me && !DB.users.me.avatar) DB.users.me.avatar="🐴";
if(DB.users.wife && !DB.users.wife.avatar) DB.users.wife.avatar="🌹";

function toast(msg){
  var t=el("div","toast",esc(msg)); document.body.appendChild(t);
  requestAnimationFrame(function(){ t.classList.add("show"); });
  setTimeout(function(){ t.classList.remove("show"); setTimeout(function(){t.remove();},400); },1800);
}

})();
