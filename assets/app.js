/* ============================================================
 * 普宁医考·双人学习监督 主逻辑
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
function save(){ localStorage.setItem(LS_KEY, JSON.stringify(DB)); }
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
  var wifeCnt = Object.keys(wife.correct).length;
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
    "<p class='sub' style='margin-top:6px'>注：若仅在本机学习，对方进度请在「监督」页导入对方的同步码后显示。</p>";
  c.appendChild(pc);

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
function renderStudy(){
  var u=activeUser(); var data=DATASET[u.role];
  var c=$(".content"); c.innerHTML="";
  var head=el("div","card");
  head.innerHTML="<h3>📚 复习资料 · "+esc(data.meta.subject)+"</h3><p class='sub'>点击章节展开知识点，读完可标记掌握；已掌握的章节会在第一屏汇总。</p>";
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
        ch.points.map(function(p){return "<div class='point'><span class='dot'>•</span><span>"+esc(p)+"</span></div>";}).join("")+
        "<div style='margin-top:10px'><button class='btn sm "+(done?"ghost":"ok")+"' data-ch='"+ch.id+"'>"+(done?"已掌握（点击取消）":"标记为已掌握 ✅")+"</button></div>"+
      "</div>";
    c.appendChild(box);
    $(".chapter-head",box).onclick=function(){ box.classList.toggle("open"); };
    $("[data-ch]",box).onclick=function(e){ e.stopPropagation(); if(u.doneCh[ch.id]){delete u.doneCh[ch.id];}else{u.doneCh[ch.id]=true;} save(); renderStudy(); };
  });
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
  var btnRow=el("div","quiz-actions");
  var b1=el("button","btn", "开始刷题"); var b2=el("button","btn warn","模拟卷（全卷20题）");
  btnRow.appendChild(b1); btnRow.appendChild(b2); setup.appendChild(btnRow);
  c.appendChild(setup);
  b1.onclick=function(){ startQuiz(selCh.value, false); };
  b2.onclick=function(){ startQuiz("all", true); };

  if(state.quiz.on){
    renderQuizArea();
  }
}

function accRate(u){ var cnt=Object.keys(u.correct).length; if(!cnt)return 0; var r=Object.values(u.correct).filter(function(v){return v;}).length; return Math.round(r/cnt*100); }

function startQuiz(chId, isMock){
  var u=activeUser(); var data=DATASET[u.role];
  var pool = data.questions.filter(function(q){ return chId==="all" || q.ch===chId; });
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
  var head=el("div","quiz-head");
  head.innerHTML="<span class='quiz-progress'>📝 "+(q.idx+1)+" / "+q.pool.length+"</span><span class='quiz-progress'>当前：刷题模式</span>";
  c.appendChild(head);
  var card=el("div","q-card");
  card.innerHTML=
    "<div class='q-meta'><span class='tag ch'>"+esc(chMap[cur.ch]||cur.ch)+"</span><span class='tag'>"+(cur.opts.length>0?"单选":"判断")+"</span></div>"+
    "<div class='q-text'>"+(q.idx+1)+". "+esc(cur.q)+"</div>"+
    cur.opts.map(function(o){return "<button class='opt' data-v='"+o.charAt(0)+"'>"+esc(o)+"</button>";}).join("")+
    "<div class='explain' id='explain'><b>✅ 答案 "+esc(cur.ans)+"</b><br>"+esc(cur.exp)+"</div>"+
    "<div class='quiz-actions'><button class='btn' id='next'>下一题 →</button></div>";
  c.appendChild(card);
  var chosen=q.answers[cur.id];
  if(chosen){
    lockOptions(card, cur, chosen);
  } else {
    $$(".opt",card).forEach(function(btn){
      btn.onclick=function(){
        var v=btn.dataset.v;
        if(q.answers[cur.id]) return;
        q.answers[cur.id]=v;
        var isRight = v===cur.ans;
        u.correct[cur.id]=isRight;
        if(!isRight){ if(!u.wrong[cur.id])u.wrong[cur.id]=Date.now(); }
        else { if(u.wrong[cur.id]){delete u.wrong[cur.id];} }
        save();
        lockOptions(card, cur, v);
      };
    });
  }
  $("#next").onclick=function(){
    if(q.idx < q.pool.length-1){ q.idx++; renderQuizArea(); }
    else { q.finished=true; renderResult(u); }
  };
}
function lockOptions(card, cur, v){
  $$(".opt",card).forEach(function(btn){
    btn.disabled=true;
    var bv=btn.dataset.v;
    if(bv===cur.ans) btn.classList.add("correct");
    else if(bv===v) btn.classList.add("wrong");
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
  card.innerHTML=
    "<div class='q-meta'><span class='tag ch' style='background:#ffe3e3;color:#c92a2a'>错题重做</span><span class='tag'>"+esc(chMap[q.ch]||"")+"</span></div>"+
    "<div class='q-text'>"+esc(q.q)+"</div>"+
    q.opts.map(function(o){return "<button class='opt' data-v='"+o.charAt(0)+"'>"+esc(o)+"</button>";}).join("")+
    "<div class='explain' id='explain'><b>✅ 答案 "+esc(q.ans)+"</b><br>"+esc(q.exp)+"</div>"+
    "<div class='quiz-actions'><button class='btn ghost' id='back'>返回错题本</button></div>";
  c.appendChild(card);
  $$(".opt",card).forEach(function(btn){
    btn.onclick=function(){
      if(btn.disabled)return; btn.disabled=true;
      var v=btn.dataset.v; var isR=v===q.ans;
      $$(".opt",card).forEach(function(b){ var bv=b.dataset.v; if(bv===q.ans)b.classList.add("correct"); else if(bv===v)b.classList.add("wrong"); });
      $("#explain",card).classList.add("show");
      if(isR){ delete u.wrong[q.id]; toast("答对了！已移出错题本 🎉"); }
      else { toast("还是错的，再记一次 💪"); }
      u.correct[q.id]=isR; save();
    };
  });
  $("#back").onclick=function(){ renderWrong(); };
}

/* ============================================================
 * 监督页
 * ============================================================ */
function renderSuper(){
  var u=activeUser(); var data=DATASET[u.role];
  var c=$(".content"); c.innerHTML="";

  var head=el("div","card");
  head.innerHTML="<h3>👫 互相监督</h3><p class='sub'>两人在各自设备学习后，把「我的同步码」复制给另一方，对方在下方粘贴导入，即可看到彼此进度并互放留言。</p>";
  c.appendChild(head);

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
    save(); renderSuper(); toast("已导入 "+r.roleName+" 的进度 ✅");
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
    var item=el("div","msg-item");
    item.innerHTML="<div class='av'>"+(m.role===u.role?"🐴":"🌹")+"</div>"+
      "<div class='msg-bubble'><div class='who'>"+(m.role===u.role?u.name:otherUser().name)+" · "+m.time+"</div><p>"+esc(m.text)+"</p></div>";
    list.appendChild(item);
  });
}
function sendMsg(u){
  var inp=$("#msgInput"); var v=inp.value.trim(); if(!v)return;
  if(!DB.msgBoard)DB.msgBoard=[];
  var d=new Date();
  DB.msgBoard.push({text:v, role:u.role, time:(d.getMonth()+1)+"-"+d.getDate()+" "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")});
  inp.value=""; save(); renderSuper();
}
function encodeProgress(u){
  var p={ role:u.role, name:u.name, correct:u.correct, wrong:u.wrong, checkins:u.checkins.slice(-90) };
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
