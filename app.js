/* =========================================================
   新专送薪资测算软件 · 前端逻辑
   ========================================================= */
const $ = id => document.getElementById(id);

/* ---------- 站点默认阶梯（源表） ---------- */
const STATION_TIERS = {
  '三毛五-寨上站':   [[1,600,4.2],[601,1000,5],[1001,1600,5.5],[1601,9999,6.5]],
  '三毛五-华侨站':   [[1,600,4.1],[601,1000,4.8],[1001,1600,5.4],[1601,9999,6.4]],
  '三毛五-创新园站': [[1,600,4.2],[601,1000,5],[1001,1600,5.6],[1601,9999,6.5]],
  '三毛五-化工站':   [[1,500,4.5],[501,1000,5.5],[1001,1500,6],[1601,9999,7]],
  '三毛五-金山站':   [[1,600,4.2],[601,1000,5],[1001,1600,5.6],[1601,9999,6.5]],
  '三毛五-华容路站': [[1,600,4.2],[601,1000,5],[1001,1600,5.5],[1601,9999,6.5]],
};
const DEFAULT_STATION = '三毛五-寨上站';
const WG = { 1:0.05, 2:0.05, 3:0.05, 4:0.10, 5:0.10, 6:0.10, 7:0.15, 8:0.15, 9:0.20 };
const LADDER = [200,300,400,500,600,800,1000,1200,1500,1800,2000,2500];

/* 质保奖档位：未达标 或 0.10 ~ 1.00 元/单（步长 0.10，共 10 档） */
const QUALITY_OPTS = [{ v:0, t:'未达标', p:0 }].concat(
  Array.from({ length: 10 }, (_, i) => {
    const v = (i + 1) / 10;
    return { v, t: v.toFixed(2) + ' 元/单', p: v };
  })
);
/* 段位奖补贴额可填区间 */
const RANK_MIN = 0.01, RANK_MAX = 1.0;

/* ---------- 科目定义 ---------- */
const BONUS = [
  { id:'full', name:'全勤奖', type:'fixed', on:false, amt:200,
    note:'月有效出勤 ≥1000 单，且有效开工天数 ≥28 天。达成一次性发 200 元/月。',
    ctrl:[{k:'amt',label:'元/月',kind:'num',step:10,min:0}] },
  { id:'quality', name:'质保奖', type:'perOrder', on:true, sel:0.2,
    opts:QUALITY_OPTS,
    note:'档位可选「未达标」或 0.10 ~ 1.00 元/单（步长 0.10，共 10 档），可随意改。达标参考：T准时率≥97%、物流妥投率≥99%、不满意<0.14%　｜　优秀参考：T准时率≥98%、妥投率≥100%、不满意<0.00%',
    ctrl:[{k:'sel',label:'达成档',kind:'opt'}] },
  { id:'rank', name:'段位奖', type:'perOrder', on:true, sel:3, rate:0.05,
    opts:Object.keys(WG).map(k=>({v:+k,t:'W'+k+'　默认 '+WG[k].toFixed(2)+' 元/单',p:WG[k]})),
    note:'按骑手段位 W1~W9 给单均补贴。补贴额可自由填写，范围 0.01 ~ 1.00 元/单（步长 0.01）；切换段位会带出该段位默认值，之后再随意改。',
    ctrl:[{k:'sel',label:'段位',kind:'opt'},
          {k:'rate',label:'补贴额（0.01~1）',kind:'num',step:0.01,min:RANK_MIN,max:RANK_MAX,cls:'w2'}] },
  { id:'long', name:'长期激励', type:'perOrder', on:true, sel:0.1,
    opts:[{v:0,t:'未满 90 天（无）',p:0},{v:0.1,t:'在职 90~179 天　0.10 元/单',p:0.1},
          {v:0.2,t:'在职 180~364 天　0.20 元/单',p:0.2},{v:0.3,t:'在职 365 天以上　0.30 元/单',p:0.3}],
    note:'按骑手在职时长给单均补贴，留得越久补得越多。',
    ctrl:[{k:'sel',label:'在职时长',kind:'opt'}] },
  { id:'star', name:'星级补贴', type:'perOrder', on:true, star:3,
    note:'0.10 元/星/单。星级由服务质量决定，此处填骑手当月星级。',
    ctrl:[{k:'star',label:'星级(0~5)',kind:'num',step:1,min:0,max:5}] },
  { id:'extra', name:'出勤阶梯补充', type:'perOrder', on:false, out:100, shift:5,
    note:'当天排班时段全部达标时，排班外的单量按档位折算成"等效计费单量"进阶梯：排班 2 段→0%、3 段→0%、4 段→50%、5 段及以上→80%。',
    ctrl:[{k:'out',label:'排班外单量',kind:'num',step:10,min:0,cls:'w2'},
          {k:'shift',label:'日排班数',kind:'sel',opts:[{v:2,t:'2 段 → 0%'},{v:3,t:'3 段 → 0%'},{v:4,t:'4 段 → 50%'},{v:5,t:'5 段及以上 → 80%'}]}] },
  { id:'slot', name:'时段补贴', type:'slot', on:false,
    slots:[{k:'a1',n:'凌晨1',p:0.5,q:0},{k:'a2',n:'凌晨2',p:0.5,q:0},{k:'a3',n:'凌晨3',p:0.5,q:0},
           {k:'b1',n:'早餐1',p:0.2,q:0},{k:'b2',n:'早餐2',p:0.2,q:0},
           {k:'c1',n:'夜宵1',p:0.3,q:0},{k:'c2',n:'夜宵2',p:0.3,q:0}],
    note:'各时段单量 × 该时段单均补贴。源表中时段补贴单价为空，单价请按实际方案填写。',
    ctrl:[] },
];
const BONUS_DEFAULT = JSON.parse(JSON.stringify(BONUS));

const DEDUCT = [
  { id:'t8',    name:'T8 超时',    on:true,  rate:2,  qty:10, unit:'单 × 2 元' },
  { id:'bad',   name:'差评 / 投诉', on:false, rate:50, qty:0,  unit:'单 × 50 元', note:'用户投诉、客服投诉、差评、商户投诉。' },
  { id:'wuliu', name:'物流责',     on:false, rate:50, qty:0,  unit:'单 × 50 元', note:'表现好、服从安排可酌情剔除一定比例。' },
  { id:'ins',   name:'保险',       on:true,  rate:10, qty:30, unit:'天 × 10 元', note:'按天扣除，一般按月扣。' },
  { id:'svc',   name:'服务费',      on:true,  pct:3, type:'percent', unit:'收入合计 × 3%',
    note:'按「收入合计（阶梯计时 + 跑单奖励）」的百分比扣除，默认 3%。费率可改，改完实时重算。' },
  { id:'quit',  name:'急辞',       on:false, rate:2,  qty:0,  unit:'单 × 2 元' },
  { id:'claim', name:'索赔 / 橙色风暴 / 非蜂卡 / 智能柜', on:false, rate:1, qty:0, onlyQty:true, unit:'元',
    note:'这几项是平移扣款，直接填「扣多少钱」即可（不是按单扣）。' },
  { id:'union', name:'工会 / 技术管理服务费', on:false, rate:1, qty:0, onlyQty:true, unit:'元',
    note:'源表中该两项未填金额，请按实际方案填写。' },
];
const DEDUCT_DEFAULT = JSON.parse(JSON.stringify(DEDUCT));

const BKEYS = ['on','amt','sel','star','out','shift','slots','rate'];
const DKEYS = ['on','rate','qty','pct'];

/* 选项查找：容忍浮点误差，找不到就回落第一项 */
function findOpt(opts, v) {
  return opts.find(o => Math.abs(+o.v - (+v)) < 1e-9) || opts[0];
}

/* ---------- 状态 ---------- */
let tiers = STATION_TIERS[DEFAULT_STATION].map(t => t.slice());
const state = { station: DEFAULT_STATION, scheme: '' };
let dirty = false;

/* =========================================================
   计算
   ========================================================= */
function tierCalc(ts, n) {
  let total = 0, covered = 0, rows = [];
  for (let i = 0; i < ts.length; i++) {
    const s = +ts[i][0], e = +ts[i][1], p = +ts[i][2];
    const lo = Math.max(1, s), hi = Math.min(e, n);
    const q = (hi >= lo && n > 0) ? (hi - lo + 1) : 0;
    total += q * p; covered += q;
    rows.push({ idx:i+1, s, e, p, q, amt:q*p });
  }
  return { total, rows, covered, gap: Math.max(0, n - covered) };
}
function shiftRatio(s) { return s >= 5 ? 0.8 : (s === 4 ? 0.5 : 0); }

function calc(n) {
  const cn = +$('cn').value || 0;
  const exB = BONUS.find(b => b.id === 'extra');
  const extraN = exB.on ? (+exB.out || 0) * shiftRatio(+exB.shift) : 0;
  const N = n + extraN;
  const tc = tierCalc(tiers, N);

  const items = [{ g:'阶梯定价', k:'阶梯计时收入', v:tc.total, d:`${tc.covered} 单进阶梯` }];
  let bonusTotal = 0;
  BONUS.forEach(b => {
    if (!b.on) return;
    if (b.type === 'fixed') {
      items.push({ g:'跑单奖励', k:b.name, v:+b.amt, d:'固定额' });
      bonusTotal += +b.amt;
    } else if (b.type === 'perOrder') {
      let rate = 0, label = '';
      if (b.id === 'quality') { const o = findOpt(b.opts, b.sel); rate = +o.p; label = o.t; }
      else if (b.id === 'rank') { rate = (+b.rate || 0); label = 'W' + b.sel; }
      else if (b.id === 'long') { const o = findOpt(b.opts, b.sel); rate = +o.p; label = o.t; }
      else if (b.id === 'star') { rate = 0.1 * (+b.star || 0); label = b.star + ' 星'; }
      else if (b.id === 'extra') { return; }
      const amt = rate * N;
      items.push({ g:'跑单奖励', k:b.name, v:amt, d:`${rate.toFixed(2)} 元/单 × ${Math.round(N)} 单（${label}）` });
      bonusTotal += amt;
    } else if (b.type === 'slot') {
      let amt = 0, det = [];
      b.slots.forEach(s => { const a = (+s.p || 0) * (+s.q || 0); amt += a; if (+s.q) det.push(`${s.n} ${s.q}单`); });
      if (amt > 0) { items.push({ g:'跑单奖励', k:b.name, v:amt, d:det.join('、') }); bonusTotal += amt; }
    }
  });

  /* 先算收入合计，百分比类扣款（服务费）要拿它当基数 */
  const gross = tc.total + bonusTotal;

  let dedTotal = 0; const dedItems = [];
  DEDUCT.forEach(d => {
    if (!d.on) return;
    let amt, desc;
    if (d.type === 'percent') {
      amt = gross * (+d.pct || 0) / 100;
      desc = `收入合计 ${gross.toFixed(2)} × ${d.pct}%`;
    } else {
      amt = (+d.rate || 0) * (+d.qty || 0);
      desc = `${d.rate} × ${d.qty}`;
    }
    dedItems.push({ k:d.name, v:amt, d:desc });
    dedTotal += amt;
  });

  const net = gross - dedTotal;
  const avg = N > 0 ? net / N : 0;
  const useRate = cn > 0 ? avg / cn : 0;
  const margin = cn - avg;
  return { n, N, extraN, cn, tc, items, bonusTotal, gross, dedTotal, dedItems, net, avg, useRate, margin, monthMargin: margin * N };
}

/* =========================================================
   渲染
   ========================================================= */
const money = (v, d = 2) => (v < 0 ? '-' : '') + '¥' + Math.abs(v).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const pct = v => (v * 100).toFixed(1) + '%';
const r2 = v => Math.round(v * 100) / 100;

$('station').innerHTML = Object.keys(STATION_TIERS).map(s => `<option${s === DEFAULT_STATION ? ' selected' : ''}>${s}</option>`).join('');

function renderTiers() {
  const tb = $('tierTbl').querySelector('tbody');
  tb.innerHTML = tiers.map((t, i) => `<tr data-i="${i}">
    <td class="ix">阶梯${i+1}</td>
    <td><input type="number" data-f="0" value="${t[0]}" step="1" min="0"></td>
    <td><input type="number" data-f="1" value="${t[1]}" step="1" min="0"></td>
    <td><input type="number" data-f="2" value="${t[2]}" step="0.1" min="0"></td>
    <td class="op"><button class="delbtn" data-del="${i}" title="删除阶梯${i + 1}">×</button></td>
  </tr>`).join('');
  tb.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', e => {
      const tr = e.target.closest('tr');
      tiers[+tr.dataset.i][+e.target.dataset.f] = +e.target.value || 0;
      markDirty(); renderTiersHint(); update();
    });
  });
  tb.querySelectorAll('[data-del]').forEach(btn => {
    btn.disabled = tiers.length <= 1;
    btn.addEventListener('click', () => {
      if (tiers.length <= 1) { toast('至少要保留 1 个档位', 'err'); return; }
      const i = +btn.dataset.del;
      tiers.splice(i, 1);
      markDirty(); renderTiers(); update();
      toast('已删除阶梯' + (i + 1));
    });
  });
  renderTiersHint();
}

function renderTiersHint() {
  const hint = $('tierHint');
  if (hint) hint.textContent = tiers.length + ' 档，可自由增删';
  const memo = $('tierMemo');
  if (!memo) return;
  const issues = [];
  for (let i = 1; i < tiers.length; i++) {
    const pe = +tiers[i - 1][1], cs = +tiers[i][0];
    if (cs > pe + 1) issues.push(`${pe + 1}~${cs - 1} 单`);
    else if (cs <= pe) issues.push(`阶梯${i} 与阶梯${i + 1} 区间重叠`);
  }
  const first = tiers.length ? +tiers[0][0] : 0;
  const lastEnd = tiers.length ? +tiers[tiers.length - 1][1] : 0;
  memo.innerHTML = issues.length
    ? `<span class="bad">⚠ 有 ${issues.length} 处区间问题：${issues.slice(0, 3).join('、')}${issues.length > 3 ? ' 等' : ''} —— 落在空档里的单量不会被计费</span>`
    : `<span class="good">✓ 区间连续，覆盖 ${first} ~ ${lastEnd >= 9999 ? '∞' : lastEnd} 单</span>`;
}

function renderSubjects() {
  $('bonusBox').innerHTML = BONUS.map(b => {
    let ctrls = b.ctrl.map(c => {
      if (c.kind === 'num')
        return `<label>${c.label}</label><input class="${c.cls || ''}" type="number" data-b="${b.id}" data-k="${c.k}"
          value="${b[c.k]}" step="${c.step ?? 1}" min="${c.min ?? 0}" ${c.max !== undefined ? `max="${c.max}"` : ''}>`;
      if (c.kind === 'sel')
        return `<label>${c.label}</label><select data-b="${b.id}" data-k="${c.k}">${c.opts.map(o =>
          `<option value="${o.v}"${String(o.v) === String(b[c.k]) ? ' selected' : ''}>${o.t}</option>`).join('')}</select>`;
      if (c.kind === 'opt')
        return `<label>${c.label}</label><select data-b="${b.id}" data-k="${c.k}">${b.opts.map(o =>
          `<option value="${o.v}"${String(o.v) === String(b[c.k]) ? ' selected' : ''}>${o.t}</option>`).join('')}</select>`;
      return '';
    }).join('');
    if (b.type === 'slot') {
      ctrls = b.slots.map(s => `<label>${s.n} 单量</label><input class="w2" type="number" data-s="${b.id}:${s.k}" value="${s.q}" step="10" min="0">`).join('')
             + b.slots.map(s => `<label>${s.n} 单价</label><input class="w2" type="number" data-sp="${b.id}:${s.k}" value="${s.p}" step="0.1" min="0">`).join('');
    }
    return `<div class="subj${b.on ? ' on' : ''}" data-id="${b.id}">
      <div class="subj-h"><input type="checkbox" ${b.on ? 'checked' : ''}>
        <span class="nm">${b.name}</span><span class="amt" data-amt="${b.id}"></span></div>
      <div class="subj-b">${ctrls}</div>
      ${b.note ? `<div class="subj-note">${b.note}</div>` : ''}
    </div>`;
  }).join('');

  $('deductBox').innerHTML = DEDUCT.map(d => `
    <div class="subj${d.on ? ' on' : ''}" data-id="${d.id}">
      <div class="subj-h"><input type="checkbox" ${d.on ? 'checked' : ''}>
        <span class="nm">${d.name}</span><span class="amt" data-amt="${d.id}"></span></div>
      <div class="subj-b">${d.type === 'percent'
        ? `<label>费率（%）</label><input class="w2" type="number" data-d="${d.id}" data-k="pct" value="${d.pct}" step="0.5" min="0" max="100">
           <span style="font-size:11.5px;color:var(--mu2)">按「收入合计（阶梯 + 跑单奖励）」扣除</span>`
        : (d.onlyQty
          ? `<label>扣款金额</label><input class="w2" type="number" data-d="${d.id}" data-k="qty" value="${d.qty}" step="10" min="0"><span style="font-size:11.5px;color:var(--mu2)">元</span>`
          : `<label>单价/费率</label><input class="w2" type="number" data-d="${d.id}" data-k="rate" value="${d.rate}" step="0.5" min="0">
             <label>${d.unit.includes('天') ? '天数' : '数量'}</label><input class="w2" type="number" data-d="${d.id}" data-k="qty" value="${d.qty}" step="1" min="0">
             <span style="font-size:11.5px;color:var(--mu2)">${d.unit}</span>`)}</div>
      ${d.note ? `<div class="subj-note">${d.note}</div>` : ''}
    </div>`).join('');

  document.querySelectorAll('.subj-h input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', e => {
      const box = e.target.closest('.subj'), id = box.dataset.id;
      const obj = BONUS.find(x => x.id === id) || DEDUCT.find(x => x.id === id);
      obj.on = e.target.checked;
      box.classList.toggle('on', obj.on);
      markDirty(); update();
    });
  });
  document.querySelectorAll('[data-b]').forEach(el => {
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', e => {
      const b = BONUS.find(x => x.id === e.target.dataset.b);
      const k = e.target.dataset.k;
      b[k] = (el.tagName === 'SELECT') ? (isNaN(+e.target.value) ? e.target.value : +e.target.value) : +e.target.value;
      /* 段位奖：切换段位时带出该段位默认补贴额（之后仍可手改） */
      if (b.id === 'rank' && k === 'sel') {
        b.rate = WG[+b.sel] || 0;
        const ri = document.querySelector('[data-b="rank"][data-k="rate"]');
        if (ri) ri.value = b.rate;
      }
      markDirty(); update();
    });
  });
  document.querySelectorAll('[data-s]').forEach(el => el.addEventListener('input', e => {
    const [id, k] = e.target.dataset.s.split(':');
    BONUS.find(x => x.id === id).slots.find(s => s.k === k).q = +e.target.value || 0; markDirty(); update();
  }));
  document.querySelectorAll('[data-sp]').forEach(el => el.addEventListener('input', e => {
    const [id, k] = e.target.dataset.sp.split(':');
    BONUS.find(x => x.id === id).slots.find(s => s.k === k).p = +e.target.value || 0; markDirty(); update();
  }));
  document.querySelectorAll('[data-d]').forEach(el => el.addEventListener('input', e => {
    DEDUCT.find(x => x.id === e.target.dataset.d)[e.target.dataset.k] = +e.target.value || 0; markDirty(); update();
  }));
}

/* =========================================================
   主更新
   ========================================================= */
function update() {
  const n = +$('orders').value || 0;
  const r = calc(n);
  const exB = BONUS.find(b => b.id === 'extra');
  $('billN').textContent = n;

  $('kAvg').textContent = money(r.avg);
  $('kAvgF').textContent = `净收入 ${money(r.net)} ÷ ${Math.round(r.N)} 单`;
  $('kUse').textContent = r.cn > 0 ? pct(r.useRate) : '—';
  $('kUse').className = 'kv ' + (r.useRate > 1 ? 'r' : r.useRate > 0.9 ? 'a' : 'g');
  $('kUseF').textContent = `单均 ${money(r.avg)} ÷ CN ${money(r.cn)}`;
  $('kMarg').textContent = money(r.margin);
  $('kMarg').className = 'kv ' + (r.margin < 0 ? 'r' : 'g');
  $('kMargF').textContent = `每单 ${money(r.margin)}　月毛利 ${money(r.monthMargin)}`;

  BONUS.forEach(b => {
    const el = document.querySelector(`[data-amt="${b.id}"]`);
    if (!el) return;
    let t = '';
    if (b.on) {
      if (b.type === 'fixed') t = money(+b.amt);
      else if (b.id === 'quality') t = (+b.sel).toFixed(2) + ' 元/单';
      else if (b.id === 'rank') t = (+b.rate || 0).toFixed(2) + ' 元/单';
      else if (b.id === 'long') t = (+b.sel).toFixed(2) + ' 元/单';
      else if (b.id === 'star') t = (0.1 * (+b.star || 0)).toFixed(2) + ' 元/单';
      else if (b.id === 'extra') t = `+${Math.round(r.extraN)} 单`;
      else if (b.type === 'slot') t = money(b.slots.reduce((a, s) => a + (+s.p) * (+s.q), 0));
    }
    el.textContent = t;
  });
  DEDUCT.forEach(d => {
    const el = document.querySelector(`[data-amt="${d.id}"]`);
    if (!el) return;
    if (!d.on) { el.textContent = ''; return; }
    const amt = d.type === 'percent' ? r.gross * (+d.pct || 0) / 100 : (+d.rate) * (+d.qty);
    el.textContent = '−' + money(amt);
  });

  const groups = {};
  r.items.forEach(it => { (groups[it.g] = groups[it.g] || []).push(it); });
  let html = `<tr><th style="width:44%">项目</th><th style="width:32%">说明</th><th style="text-align:right">金额</th></tr>`;
  Object.keys(groups).forEach(g => {
    html += `<tr><td class="grp" colspan="3">${g}</td></tr>`;
    groups[g].forEach(it => {
      html += `<tr><td>${it.k}</td><td style="color:var(--mu);font-size:11.5px">${it.d}</td><td class="n g">${money(it.v)}</td></tr>`;
    });
  });
  html += `<tr><td class="grp" colspan="3">扣款项</td></tr>`;
  if (r.dedItems.length) r.dedItems.forEach(it => {
    html += `<tr><td>${it.k}</td><td style="color:var(--mu);font-size:11.5px">${it.d}</td><td class="n r">−${money(it.v)}</td></tr>`;
  });
  else html += `<tr><td colspan="3" style="color:var(--mu2);font-size:12.5px">未勾选任何扣款项</td></tr>`;
  html += `<tr class="sum"><td colspan="2">收入合计（阶梯 + 跑单奖励）</td><td class="n">${money(r.gross)}</td></tr>`;
  html += `<tr class="sum"><td colspan="2">扣款合计</td><td class="n r">−${money(r.dedTotal)}</td></tr>`;
  html += `<tr class="tot"><td colspan="2">骑手实发净收入</td><td class="n">${money(r.net)}</td></tr>`;
  html += `<tr class="sum"><td colspan="2">计费单量（含出勤阶梯补充等效单量）</td><td class="n">${Math.round(r.N)} 单</td></tr>`;
  html += `<tr class="sum"><td colspan="2">骑手单均 = 净收入 ÷ 计费单量</td><td class="n">${money(r.avg)}</td></tr>`;
  $('billTbl').innerHTML = html;

  /* 07 区块：跟随「当月单量」同步（标题、数值、结论句都用当前单量 / 计费单量） */
  const nR = Math.round(r.N);
  if ($('kNT')) $('kNT').textContent = n;
  if ($('kNT2')) $('kNT2').textContent = n;
  $('k1000').textContent = money(r.net);
  $('k1000netF').textContent = `按计费单量 ${nR} 单`;
  $('k1000avg').textContent = money(r.avg);
  $('k1000avgF').textContent = `净收入 ${money(r.net, 0)} ÷ ${nR} 单`;
  $('k1000use').textContent = r.cn > 0 ? pct(r.useRate) : '—';
  $('k1000use').className = 'kv ' + (r.useRate > 1 ? 'r' : r.useRate > 0.9 ? 'a' : 'g');
  $('k1000useF').textContent = `单均 ${money(r.avg)} ÷ CN ${money(r.cn)}`;
  let al;
  if (r.useRate > 1)
    al = `<div class="al d"><b>⚠ CN 使用率超过 100%</b> —— 骑手 ${n} 单实发 ${money(r.net)} 已高于甲方给的 ${money(r.cn * nR)}，每单倒亏 <b>${money(-r.margin)}</b>，需下调补贴或与甲方重谈 CN。</div>`;
  else if (r.useRate > 0.95)
    al = `<div class="al w"><b>CN 使用率 ${pct(r.useRate)}，几乎没空间。</b> 骑手 ${n} 单实发 <b>${money(r.net)}</b>，每单只剩 ${money(r.margin)} 毛利，一旦出现超时/差评扣款就会踩线，建议留 3~5pp 缓冲。</div>`;
  else
    al = `<div class="al ok"><b>CN 使用率 ${pct(r.useRate)}，健康。</b> 骑手跑 ${n} 单实发 <b>${money(r.net)}</b>（单均 ${money(r.avg)}），我方每单毛利 <b>${money(r.margin)}</b>，${n} 单合计毛利 <b>${money(r.monthMargin)}</b>。</div>`;
  $('alert1000').innerHTML = al;

  const maxQ = Math.max(...r.tc.rows.map(x => x.q), 1);
  let th = `<div class="tierrow" style="color:var(--mu2);font-size:11.5px"><span></span>
      <div>${r.tc.rows.map(x => `${x.s}-${x.e == 9999 ? '∞' : x.e} @${x.p}`).join('　·　')}</div>
      <span style="text-align:right">单量</span><span style="text-align:right">金额</span></div>`;
  th += r.tc.rows.map(x => `<div class="tierrow">
      <span class="tn">阶梯${x.idx}</span>
      <div class="tw2"><div class="tb" style="width:${(x.q / maxQ * 100).toFixed(1)}%"></div></div>
      <span class="tq">${x.q} 单</span><span class="ta">${money(x.amt)}</span></div>`).join('');
  if (r.tc.gap > 0)
    th += `<div class="al d" style="margin-top:12px"><b>有 ${r.tc.gap} 单落在阶梯空档里，没被计费。</b>
      当前阶梯存在区间断档（例如源表「化工站」阶梯3 到 1500 单结束、阶梯4 从 1601 单才开始，1501~1600 是空的）。请把区间补连续。</div>`;
  $('tierDetail').innerHTML = th;

  $('ladderTbl').innerHTML = LADDER.map(k => {
    const x = calc(k);
    const cur = Math.abs(k - n) < 0.5 ? ' class="cur"' : '';
    return `<tr${cur}><td>${k} 单</td><td>${money(x.tc.total)}</td><td>${money(x.bonusTotal)}</td>
      <td style="color:var(--red)">−${money(x.dedTotal)}</td><td style="font-weight:800">${money(x.net)}</td>
      <td>${money(x.avg)}</td>
      <td style="color:${x.useRate > 1 ? 'var(--red)' : x.useRate > 0.9 ? 'var(--amber)' : 'var(--green)'}">${x.cn > 0 ? pct(x.useRate) : '—'}</td>
      <td>${money(x.margin)}</td><td>${money(x.margin * x.N)}</td></tr>`;
  }).join('');

  $('formulaBox').innerHTML = [
    ['当前站点', state.station],
    ['阶梯计价（累进）', 'Σ 每档 = 落在该档区间的单量 × 该档单价'],
    ['阶梯计时收入', (r.tc.rows.filter(x => x.q > 0).map(x => `${x.q}×${x.p}`).join(' + ') || '0') + ' = ' + money(r.tc.total)],
    ['出勤阶梯补充', exB.on ? `排班外 ${exB.out} 单 × 比例 ${(shiftRatio(+exB.shift) * 100).toFixed(0)}% = 等效 ${Math.round(r.extraN)} 单，已并入阶梯计费` : '未启用'],
    ['单均型补贴', '补贴单价（元/单）× 计费单量'],
    ['固定额补贴', '全勤奖等一次性金额，直接相加'],
    ['扣款合计', 'Σ（费率 × 数量）+ Σ（收入合计 × 费率%）'],
    ['服务费', (() => { const s = DEDUCT.find(x => x.id === 'svc'); return s && s.on ? `收入合计 ${money(r.gross)} × ${s.pct}% = ${money(r.gross * (+s.pct || 0) / 100)}` : '未启用'; })()],
    ['骑手净收入', `${money(r.gross)} − ${money(r.dedTotal)} = ${money(r.net)}`],
    ['骑手单均', `净收入 ${money(r.net)} ÷ 计费单量 ${Math.round(r.N)} = ${money(r.avg)}`],
    ['CN 使用率', `骑手单均 ${money(r.avg)} ÷ CN ${money(r.cn)} = ${r.cn > 0 ? pct(r.useRate) : '—'}`],
    ['每单毛利', `CN ${money(r.cn)} − 单均 ${money(r.avg)} = ${money(r.margin)}`],
    ['月度毛利', `每单毛利 ${money(r.margin)} × ${Math.round(r.N)} 单 = ${money(r.monthMargin)}`],
  ].map(([a, b]) => `<div class="fr2"><span class="fn">${a}</span><span class="fv">${b}</span></div>`).join('');

  renderReco();
}

/* =========================================================
   方案快照 / 还原
   ========================================================= */
function snapshot() {
  return {
    station: state.station,
    orders: +$('orders').value || 0,
    cn: +$('cn').value || 0,
    tiers: tiers.map(t => t.slice()),
    bonus: JSON.parse(JSON.stringify(BONUS)),
    deduct: JSON.parse(JSON.stringify(DEDUCT)),
  };
}
function restore(s) {
  if (!s) return;
  state.station = (s.station && STATION_TIERS[s.station]) ? s.station : DEFAULT_STATION;
  $('station').value = state.station;
  tiers = (Array.isArray(s.tiers) && s.tiers.length ? s.tiers : STATION_TIERS[state.station]).map(t => t.slice());
  const o = +s.orders || 1000;
  $('orders').value = o; $('ordersR').value = Math.min(2500, o);
  $('cn').value = (s.cn === 0 || s.cn) ? s.cn : 6;
  if (Array.isArray(s.bonus)) BONUS.forEach(b => {
    const sv = s.bonus.find(x => x.id === b.id); if (!sv) return;
    BKEYS.forEach(k => { if (k in sv) b[k] = JSON.parse(JSON.stringify(sv[k])); });
  });
  if (Array.isArray(s.deduct)) DEDUCT.forEach(d => {
    const sv = s.deduct.find(x => x.id === d.id); if (!sv) return;
    DKEYS.forEach(k => { if (k in sv) d[k] = sv[k]; });
  });
  renderTiers(); renderSubjects(); update();
}
function resetAll() {
  tiers = STATION_TIERS[state.station].map(t => t.slice());
  BONUS.splice(0, BONUS.length, ...JSON.parse(JSON.stringify(BONUS_DEFAULT)));
  DEDUCT.splice(0, DEDUCT.length, ...JSON.parse(JSON.stringify(DEDUCT_DEFAULT)));
  $('orders').value = 1000; $('ordersR').value = 1000; $('cn').value = 6;
  renderTiers(); renderSubjects(); update();
}
function markDirty() {
  if (!dirty) { dirty = true; setStatus('有未保存的修改', false); }
}
function setStatus(t, ok = true) {
  const el = $('stStatus'); el.textContent = t; el.className = ok ? 'g' : ''; el.style.color = ok ? '' : '#FCA5A5';
}

/* =========================================================
   Toast / Dialog
   ========================================================= */
function toast(msg, type = '') {
  const d = document.createElement('div');
  d.className = 'tst ' + type; d.textContent = msg;
  $('toast').appendChild(d);
  setTimeout(() => d.classList.add('show'), 10);
  setTimeout(() => { d.classList.remove('show'); setTimeout(() => d.remove(), 300); }, 3000);
}
function dialog(title, bodyHtml, buttons) {
  $('dlgTitle').textContent = title;
  $('dlgBody').innerHTML = bodyHtml;
  const ft = $('dlgFoot'); ft.innerHTML = '';
  buttons.forEach(b => {
    const el = document.createElement('button');
    el.className = 'btn ' + (b.cls || ''); el.textContent = b.label;
    el.onclick = () => { closeDialog(); b.onClick && b.onClick(); };
    ft.appendChild(el);
  });
  $('mask').classList.add('show');
}
function closeDialog() { $('mask').classList.remove('show'); }
$('mask').addEventListener('click', e => { if (e.target === $('mask')) closeDialog(); });

/* =========================================================
   方案存储（HTML 版：浏览器 localStorage）
   ---------------------------------------------------------
   桌面版把方案写在 exe 同级的 data/schemes.json，由 Flask 提供
   /api/schemes 读写；网页版没有后端，改用浏览器 localStorage，
   数据结构与桌面版保持一致：{ 方案名: { ts: 时间戳, data: 快照 } }
   ========================================================= */
const LS_SCHEMES = 'xzs_schemes_v1';
function loadStore() {
  try {
    const j = JSON.parse(localStorage.getItem(LS_SCHEMES) || '{}');
    return (j && typeof j === 'object' && !Array.isArray(j)) ? j : {};
  } catch (e) { return {}; }
}
function saveStore(d) {
  try { localStorage.setItem(LS_SCHEMES, JSON.stringify(d)); }
  catch (e) { toast('浏览器存储写入失败（可能是隐私模式或空间已满）：' + e.message, 'err'); }
}
function storeNames() {
  const d = loadStore();
  return Object.keys(d).sort((a, b) => String(d[b].ts || '').localeCompare(String(d[a].ts || '')));
}
function refreshSchemes(sel) {
  const names = storeNames();
  $('schemeSel').innerHTML = '<option value="">（未选择方案）</option>'
    + names.map(n => `<option value="${n}"${n === (sel || '') ? ' selected' : ''}>${n}</option>`).join('');
  return names;
}
function setSchemeName(n) {
  state.scheme = n || '';
  $('schemeSel').value = n || '';
  $('stScheme').textContent = n ? '当前方案：' + n : '未选择方案';
}

/* =========================================================
   时间戳 / 桌面版一致的命名
   ========================================================= */
const _p2 = n => String(n).padStart(2, '0');
function stampFile() {          // 20260925_025327
  const d = new Date();
  return `${d.getFullYear()}${_p2(d.getMonth() + 1)}${_p2(d.getDate())}_${_p2(d.getHours())}${_p2(d.getMinutes())}${_p2(d.getSeconds())}`;
}
function stampHuman() {         // 2026-09-25 02:53:27
  const d = new Date();
  return `${d.getFullYear()}-${_p2(d.getMonth() + 1)}-${_p2(d.getDate())} ${_p2(d.getHours())}:${_p2(d.getMinutes())}:${_p2(d.getSeconds())}`;
}
function stampShort() {         // 09-25 02:53
  const d = new Date();
  return `${_p2(d.getMonth() + 1)}-${_p2(d.getDate())} ${_p2(d.getHours())}:${_p2(d.getMinutes())}`;
}

/* =========================================================
   Excel 导出底层（xlsx-js-style）
   ---------------------------------------------------------
   桌面版的导出由 Flask + openpyxl 完成；网页版用 xlsx-js-style
   在浏览器里直接生成同样的工作表、单元格样式与数字格式。
   ========================================================= */
const XLB = {
  top: { style: 'thin', color: { rgb: 'D8DEE9' } }, bottom: { style: 'thin', color: { rgb: 'D8DEE9' } },
  left: { style: 'thin', color: { rgb: 'D8DEE9' } }, right: { style: 'thin', color: { rgb: 'D8DEE9' } },
};
const borderOf = rgb => ({
  top: { style: 'thin', color: { rgb } }, bottom: { style: 'thin', color: { rgb } },
  left: { style: 'thin', color: { rgb } }, right: { style: 'thin', color: { rgb } },
});
/* 单元格描述：C(值, {bold,size,color,bg,align,nf,bd,bdC,wrap,name}) */
const C = (v, o) => Object.assign({ v }, o || {});
/* spec: { rows:[[cell...]], merges:[[r1,c1,r2,c2]], cols:[宽度] } */
function mkSheet(spec) {
  const aoa = spec.rows.map(r => r.map(c => (c && typeof c === 'object' && 'v' in c) ? (c.v === undefined ? null : c.v) : c));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  spec.rows.forEach((r, ri) => r.forEach((c, ci) => {
    if (!c || typeof c !== 'object' || !('v' in c)) return;
    const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
    let cell = ws[addr];
    if (!cell) { cell = { t: (typeof c.v === 'number' ? 'n' : 's'), v: c.v === undefined ? '' : c.v }; ws[addr] = cell; }
    if (c.nf) cell.z = c.nf;
    const st = { alignment: { wrapText: c.wrap !== false } };
    if (c.bold || c.size || c.color || c.name) {
      st.font = {};
      if (c.name) st.font.name = c.name;
      if (c.bold) st.font.bold = true;
      if (c.size) st.font.sz = c.size;
      if (c.color) st.font.color = { rgb: c.color };
    }
    if (c.bg) st.fill = { patternType: 'solid', fgColor: { rgb: c.bg } };
    if (c.align) st.alignment.horizontal = c.align;
    st.alignment.vertical = c.valign || 'center';
    if (c.bd) st.border = c.bdC ? borderOf(c.bdC) : XLB;
    cell.s = st;
  }));
  if (spec.merges && spec.merges.length) {
    ws['!merges'] = spec.merges.map(m => ({ s: { r: m[0], c: m[1] }, e: { r: m[2], c: m[3] } }));
    let rg = XLSX.utils.decode_range(ws['!ref']);
    spec.merges.forEach(m => { rg.e.r = Math.max(rg.e.r, m[2]); rg.e.c = Math.max(rg.e.c, m[3]); });
    ws['!ref'] = XLSX.utils.encode_range(rg);
  }
  if (spec.cols) ws['!cols'] = spec.cols.map(w => ({ wch: w }));
  return ws;
}
function downloadWb(wb, filename) {
  XLSX.writeFile(wb, filename, { bookType: 'xlsx' });
  return filename;
}

/* =========================================================
   智能推荐：按「目标 CN 使用率」反推阶梯单价（85% ~ 100% 可选）
   ========================================================= */
const RECO_MAX_OK = 0.90;                       // 合格线：CN 使用率 ≤ 90%
const RECO_MIN_PCT = 85, RECO_MAX_PCT = 100;    // 可选区间（%）
const RECO_PRESETS = [85, 88, 90, 95, 100];     // 快捷档位
let recoTarget = 0.88;                          // 当前目标使用率（小数）

/* 目标使用率 → 档位标签与说明 */
function recoTag(use) {
  const p = use * 100;
  if (p < 88) return { tag: '保守', note: '留足余量，最稳，适合新站或考核期，骑手也有成长空间。' };
  if (p <= RECO_MAX_OK * 100) return { tag: '推荐', note: '合格线上留安全垫，钱给得足又不踩线（推荐区间 85%~90%）。' };
  if (p <= 96) return { tag: '超线', note: '已越过 90% 合格线，一旦出现超时/差评扣款就会亏到身上。' };
  return { tag: '极限', note: '接近「不赚不亏」，只适合抢人或特殊期，长期做会没有毛利空间。' };
}

/* 用一组临时单价算一次账单，不改动全局状态 */
function calcWithPrices(prices, n) {
  const save = tiers.map(t => t[2]);
  tiers.forEach((t, i) => { t[2] = prices[i]; });
  const out = calc(n);
  tiers.forEach((t, i) => { t[2] = save[i]; });
  return out;
}

/* 反推：
   net = gross − 扣款 = gross(1 − sPct) − D0
   目标 net* = CN × 目标使用率 × 计费单量 ⇒ gross* = (net* + D0) / (1 − sPct)
   跑单奖励不变 ⇒ 阶梯计时需变成 gross* − 奖励 ⇒ 各档单价整体 × k   */
function recoPlan(r, targetUse) {
  if (!r.cn || r.cn <= 0 || r.N <= 0 || r.tc.total <= 0) return null;
  let D0 = 0, sPct = 0;
  DEDUCT.forEach(d => {
    if (!d.on) return;
    if (d.type === 'percent') sPct += (+d.pct || 0) / 100;
    else D0 += (+d.rate || 0) * (+d.qty || 0);
  });
  if (sPct >= 1) return null;
  const netWant = r.cn * targetUse * r.N;
  const grossWant = (netWant + D0) / (1 - sPct);
  const needT = grossWant - r.bonusTotal;
  if (needT <= 0) return null;
  const k = needT / r.tc.total;
  if (!isFinite(k) || k <= 0) return null;
  /* 单价**向下取整**到 2 位小数：合格线是「≤ 90%」的硬约束，
     四舍五入会向上多给几毛钱，导致贴线方案实际反超 90%（本机实测 90% 目标算成 90.02%） */
  const prices = tiers.map(t => Math.max(0.01, Math.floor(t[2] * k * 100) / 100));
  /* 用取整后的单价真实复算，避免「标称 88% 实际 88.3%」 */
  const actual = calcWithPrices(prices, r.n);
  return { targetUse, k, prices, actual };
}

function renderReco() {
  renderPresets();          // 首次渲染（以及每次 update）都要保证快捷档位存在
  const box = $('recoOut');
  if (!box) return;
  const n = +$('orders').value || 0;
  const r = calc(n);
  if (!r.cn || r.cn <= 0) {
    box.innerHTML = '<div class="al w">请先在「基础设置」填写 <b>CN 单价</b>（甲方结算给我方的钱，元/单），才能反推推荐方案。</div>';
    return;
  }
  if (r.N <= 0 || r.tc.total <= 0) {
    box.innerHTML = '<div class="al w">当前阶梯没有计费单量 —— 请检查档位区间是否覆盖 <b>1 ~ ∞ 单</b>（存在空档时单量不会被计费）。</div>';
    return;
  }
  const cur = r.useRate, gap = RECO_MAX_OK - cur;
  const head = `<div class="recohead ${cur <= RECO_MAX_OK ? 'ok' : 'bad'}">
    <b>当前：</b>骑手单均 ${money(r.avg)} ÷ CN ${money(r.cn)} = <b>${pct(cur)}</b>
    ${cur <= RECO_MAX_OK
      ? `　合格，距 90% 合格线还有 <b>${(gap * 100).toFixed(1)}pp</b> 空间 —— 把这部分补给骑手可增强留存`
      : `　<b>超线 ${(-gap * 100).toFixed(1)}pp</b> —— 需下调阶梯单价或与甲方重谈 CN`}
    <span class="recosub">拖动上方滑块、或用下方速览表选择<b>目标 CN 使用率（${RECO_MIN_PCT}% ~ ${RECO_MAX_PCT}%）</b>，
      系统按该目标反推各档单价（档位结构、单量、奖励科目都不动，只是单价整体同比缩放；单价向下取整到 2 位小数以确保不超目标）；
      判定标准：<b>CN 使用率 ≤ 90% 为合格</b>。改 CN、单量或阶梯后本区自动重算。</span></div>`;

  const p = recoPlan(r, recoTarget);
  const card = p ? bigCard(p, r, n)
    : `<div class="al w">按目标 ${pct(recoTarget)} 反推不出方案 —— 请检查阶梯区间、扣款项设置，或先把 CN 填对。</div>`;

  box.innerHTML = head + card + recoTable(r);
  box.querySelectorAll('.rapply').forEach(b => b.addEventListener('click', applyReco));
  box.querySelectorAll('tr[data-p]').forEach(tr =>
    tr.addEventListener('click', () => setRecoTarget(+tr.dataset.p)));
}

/* 当前目标对应的方案大卡 */
function bigCard(p, r, n) {
  const a = p.actual, d = a.avg - r.avg, dNet = a.net - r.net;
  const ok = a.useRate <= RECO_MAX_OK;
  const t = recoTag(p.targetUse);
  return `<div class="rcard rbig${ok ? ' rec' : ' warn'}">
    <div class="rbig-l">
      <div class="rch"><span class="rtag">${t.tag}</span>
        <span class="rpct">${pct(a.useRate)}</span>
        <span class="rbadge ${ok ? 'g' : 'w'}">${ok ? '合格' : '超线'}</span></div>
      <div class="rmain">${money(a.avg)}<span class="rdelta${d < 0 ? ' neg' : ''}">${d >= 0 ? '+' : ''}${money(d)}</span></div>
      <div class="rsub">目标 ${pct(p.targetUse)}　·　${n} 单净收入 ${money(a.net, 0)}（较当前 ${dNet >= 0 ? '+' : ''}${money(dNet, 0)}）</div>
      <div class="rrow"><span>每单毛利</span><b class="${a.margin < 0 ? 'r' : 'g'}">${money(a.margin)}</b></div>
      <div class="rrow"><span>月毛利（${n} 单）</span><b class="${a.monthMargin < 0 ? 'r' : 'g'}">${money(a.monthMargin, 0)}</b></div>
      <div class="rrow"><span>阶梯单价</span>
        <b>×${p.k.toFixed(4)}　<span class="${p.k >= 1 ? 'g' : 'r'}">${p.k >= 1 ? '+' : ''}${((p.k - 1) * 100).toFixed(1)}%</span></b></div>
      <div class="rnote">${t.note}</div>
    </div>
    <div class="rbig-r">
      <div class="rptitle">各档建议单价（原价 → 建议价）</div>
      <div class="rprices">${tiers.map((tt, j) => `<div class="rline"><span>阶梯${j + 1}</span>
        <s>${(+tt[2]).toFixed(2)}</s><i>→</i><b>${p.prices[j].toFixed(2)}</b></div>`).join('')}</div>
      <button class="btn p rapply">应用此方案</button>
    </div>
  </div>`;
}

/* 85% ~ 100% 速览表：点任意一行即切换目标 */
function recoTable(r) {
  const rows = [];
  for (let v = RECO_MIN_PCT; v <= RECO_MAX_PCT; v++) {
    const p = recoPlan(r, v / 100);
    if (!p) continue;
    const a = p.actual;
    const ok = a.useRate <= RECO_MAX_OK;
    const sel = Math.abs(v / 100 - recoTarget) < 0.0005;
    rows.push(`<tr class="${sel ? 'cur' : ''}" data-p="${v}" title="点击把目标设为 ${v}%">
      <td>${v}%</td>
      <td>${money(a.avg)}</td>
      <td>${money(a.net, 0)}</td>
      <td class="${a.margin < 0 ? 'r' : 'g'}">${money(a.margin)}</td>
      <td class="${a.monthMargin < 0 ? 'r' : 'g'}">${money(a.monthMargin, 0)}</td>
      <td>×${p.k.toFixed(4)}</td>
      <td>${ok ? '<span class="badge lo">合格</span>' : '<span class="badge hi">超线</span>'}</td></tr>`);
  }
  return `<div class="rtbl-h">各档目标使用率速览 —— 点任意一行即切换方案
      <span class="muted">（${RECO_MIN_PCT}% ~ ${RECO_MAX_PCT}%；越往上骑手拿得越多、我方毛利越薄）</span></div>
    <div class="tw rtbox"><table class="dt">
      <thead><tr><th>目标使用率</th><th>骑手单均</th><th>净收入</th><th>每单毛利</th><th>月毛利</th>
        <th>阶梯系数</th><th>判定</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>`;
}

/* 设定目标使用率（%）。src 用于避免回写正在输入的那个控件 */
function setRecoTarget(pct, src) {
  const v = Math.min(RECO_MAX_PCT, Math.max(RECO_MIN_PCT, +pct || RECO_MIN_PCT));
  recoTarget = v / 100;
  const rng = $('recoRange'), num = $('recoNum');
  if (rng && src !== 'range') rng.value = recoTarget * 100;
  if (num && src !== 'num') num.value = +(recoTarget * 100).toFixed(1);
  renderPresets();
  renderReco();
}
function renderPresets() {
  const el = $('recoPresets');
  if (!el) return;
  el.innerHTML = RECO_PRESETS.map(v =>
    `<button class="rpbtn${Math.abs(v / 100 - recoTarget) < 0.0005 ? ' on' : ''}" data-p="${v}">${v}%</button>`).join('');
}

function applyReco() {
  const r = calc(+$('orders').value || 0);
  const p = recoPlan(r, recoTarget);
  if (!p) { toast('该方案无法计算，请检查 CN / 单量 / 阶梯', 'err'); return; }
  tiers.forEach((tt, j) => { tt[2] = p.prices[j]; });
  markDirty(); renderTiers(); update();
  toast(`已应用：目标使用率 ${pct(recoTarget)}，阶梯单价 ×${p.k.toFixed(3)}，实际 ${pct(p.actual.useRate)}`, 'ok');
}

$('recoRange').addEventListener('input', e => setRecoTarget(+e.target.value, 'range'));
$('recoNum').addEventListener('input', e => {
  const v = +e.target.value;
  if (!isNaN(v) && v >= RECO_MIN_PCT && v <= RECO_MAX_PCT) setRecoTarget(v, 'num');
});
$('recoNum').addEventListener('change', e => setRecoTarget(+e.target.value, 'range'));   // 失焦时纠正越界值
$('recoPresets').addEventListener('click', e => {
  const b = e.target.closest('[data-p]');
  if (b) setRecoTarget(+b.dataset.p);
});

/* =========================================================
   导出 Excel
   ========================================================= */
function exportPayload() {
  const n = +$('orders').value || 0;
  const r = calc(n);
  const exB = BONUS.find(b => b.id === 'extra');
  const ladder = LADDER.map(k => {
    const x = calc(k);
    return { n:k, tier:r2(x.tc.total), bonus:r2(x.bonusTotal), deduct:r2(x.dedTotal), net:r2(x.net),
             avg:r2(x.avg), use:r2(x.useRate), margin:r2(x.margin), monthMargin:r2(x.monthMargin) };
  });
  return {
    title: (state.scheme || '薪资测算') + '-' + state.station + '-' + n + '单',
    scheme: {
      station: state.station, orders: n, cn: r.cn,
      out: exB.on ? exB.out : 0, shift: exB.on ? exB.shift : '-',
      tiers: tiers.map((t, i) => ({ label:'阶梯' + (i + 1), s:t[0], e:t[1], p:t[2], q:r.tc.rows[i].q })),
    },
    result: {
      income: r2(r.gross), deduct: r2(r.dedTotal), net: r2(r.net), orders: Math.round(r.N),
      avg: r2(r.avg), cn: r.cn, use: r2(r.useRate), margin: r2(r.margin), month: r2(r.monthMargin),
      items: r.items.map(x => ({ k:x.k, d:x.d, v:r2(x.v) })),
      dedItems: r.dedItems.map(x => ({ k:x.k, d:x.d, v:r2(x.v) })),
    },
    ladder,
  };
}

/* 桌面版 /api/export 生成的两个工作表：测算单 + 单量档位对照 */
function buildLadderSheets(p) {
  const R = p.result, S = p.scheme;
  const secRow = t => [C(t, { bold: true, size: 11.5, color: 'FFFFFF', bg: '10243D', bd: false })];
  const thCell = t => C(t, { bold: true, size: 9.5, color: '1E4E86', bg: 'DCE9FA', align: 'center', bd: true });
  const labelCell = (t, bold) => C(t, { bold: !!bold, size: 10.5, bd: true });
  const numCell = (v, nf, extra) => C(v, Object.assign({ size: 10.5, nf, align: 'center', bd: true }, extra || {}));

  const rows1 = [];
  rows1[0] = [C('新专送薪资测算单', { bold: true, size: 16, color: '10243D', bd: false })];
  rows1[1] = [C(`站点：${S.station}\u3000｜\u3000生成时间：${stampHuman()}\u3000｜\u3000单均 = 我给骑手的钱（元/单）\u3000CN = 甲方给我的钱（元/单）\u3000CN 使用率 = 单均 ÷ CN`,
    { size: 9, color: '64748B', bd: false })];
  rows1[3] = secRow('一、测算结果');
  rows1[4] = [thCell('指标'), thCell('数值'), thCell('单位'), thCell('说明')];
  [
    ['收入合计', R.income, '元', '#,##0.00', false],
    ['扣款合计', R.deduct, '元', '#,##0.00', false],
    ['骑手净收入', R.net, '元', '#,##0.00', true],
    ['计费单量', R.orders, '单', '#,##0', false],
    ['骑手单均', R.avg, '元', '#,##0.00', true],
    ['CN 单价', R.cn, '元', '#,##0.00', false],
    ['CN 使用率', R.use, '%', '0.00%', true],
    ['每单毛利', R.margin, '元', '#,##0.00', false],
    ['月度毛利', R.month, '元', '#,##0.00', false],
  ].forEach((k, i) => {
    rows1[5 + i] = [labelCell(k[0], k[4]),
      C(k[1], { bold: true, size: 11.5, color: '10243D', nf: k[3], align: 'center', bd: true }),
      C(k[2], { size: 9.5, color: '64748B', align: 'center', bd: true })];
  });
  rows1[15] = secRow('二、参数设置');
  rows1[16] = [thCell('项目'), thCell('值')];
  [['站点', S.station], ['当月单量（单）', S.orders], ['CN 单价（元/单）', S.cn],
   ['排班外单量（单）', S.out], ['日排班数（段）', S.shift]].forEach((x, i) => {
    rows1[17 + i] = [labelCell(x[0], false), C(x[1], { bold: true, size: 10.5, align: 'center', bd: true })];
  });
  rows1[23] = secRow('三、阶梯定价');
  rows1[24] = [thCell('档位'), thCell('起始单量'), thCell('结束单量'), thCell('单价(元/单)'), thCell('本档计入单量')];
  S.tiers.forEach((t, i) => {
    rows1[25 + i] = [C(t.label, { bold: true, size: 10, align: 'center', bd: true }),
      numCell(t.s, '#,##0'), numCell(t.e, '#,##0'), numCell(t.p, '0.00'), numCell(t.q, '#,##0')];
  });
  const last = 25 + S.tiers.length - 1;
  rows1[last + 1] = secRow('四、收入与扣款明细');
  rows1[last + 2] = [thCell('项目'), thCell('说明'), thCell('金额(元)')];
  let ri = last + 3;
  R.items.forEach(it => {
    rows1[ri++] = [labelCell(it.k, false), C(it.d, { size: 9, color: '64748B', bd: true }),
      C(it.v, { bold: true, size: 10.5, color: '15803D', nf: '#,##0.00', align: 'right', bd: true })];
  });
  R.dedItems.forEach(it => {
    rows1[ri++] = [labelCell(it.k, false), C(it.d, { size: 9, color: '64748B', bd: true }),
      C(-it.v, { bold: true, size: 10.5, color: 'B91C1C', nf: '#,##0.00', align: 'right', bd: true })];
  });

  const rows2 = [[
    '单量', '阶梯收入', '补贴合计', '扣款', '净收入', '骑手单均', 'CN使用率', '每单毛利', '月度毛利'
  ].map(t => C(t, { bold: true, size: 10, color: 'FFFFFF', bg: '1E4E86', align: 'center', bd: true }))];
  p.ladder.forEach((x, i) => {
    rows2[i + 1] = [
      C(x.n, { size: 10, nf: '#,##0', align: 'center', bd: true }),
      C(x.tier, { size: 10, nf: '#,##0.00', align: 'right', bd: true }),
      C(x.bonus, { size: 10, nf: '#,##0.00', align: 'right', bd: true }),
      C(x.deduct, { size: 10, nf: '#,##0.00', align: 'right', bd: true }),
      C(x.net, { bold: true, size: 10, nf: '#,##0.00', align: 'right', bd: true }),
      C(x.avg, { size: 10, nf: '#,##0.00', align: 'right', bd: true }),
      C(x.use, { size: 10, nf: '0.0%', align: 'right', bd: true }),
      C(x.margin, { size: 10, nf: '#,##0.00', align: 'right', bd: true }),
      C(x.monthMargin, { size: 10, nf: '#,##0.00', align: 'right', bd: true }),
    ];
  });

  return {
    sheet1: mkSheet({ rows: rows1, merges: [[0, 0, 0, 4], [1, 0, 1, 4]], cols: [26, 18, 18, 18, 40] }),
    sheet2: mkSheet({ rows: rows2, cols: [10, 13, 13, 11, 13, 12, 12, 12, 13] }),
  };
}
/* 与桌面版同名规则：<方案/薪资测算>-<站点>-<单量>单_<时间戳>.xlsx */
function exportLadderExcel() {
  const p = exportPayload();
  const sh = buildLadderSheets(p);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sh.sheet1, '测算单');
  XLSX.utils.book_append_sheet(wb, sh.sheet2, '单量档位对照');
  return downloadWb(wb, `${p.title}_${stampFile()}.xlsx`);
}

/* =========================================================
   事件绑定
   ========================================================= */
$('station').addEventListener('change', e => {
  state.station = e.target.value;
  tiers = STATION_TIERS[state.station].map(t => t.slice());
  markDirty(); renderTiers(); update();
});
$('addTier').addEventListener('click', () => {
  if (tiers.length >= 30) { toast('档位最多 30 档', 'err'); return; }
  const last = tiers[tiers.length - 1];
  const start = last ? (+last[1] || 0) + 1 : 1;
  tiers.push([start, start + 99, last ? +last[2] : 5]);
  markDirty(); renderTiers(); update();
  toast('已添加阶梯' + tiers.length + '（' + start + ' 单起）');
});
$('resetTier').addEventListener('click', () => {
  tiers = STATION_TIERS[state.station].map(t => t.slice());
  markDirty(); renderTiers(); update();
});
$('orders').addEventListener('input', e => { $('ordersR').value = Math.min(2500, e.target.value); markDirty(); update(); });
$('ordersR').addEventListener('input', e => { $('orders').value = e.target.value; markDirty(); update(); });
$('cn').addEventListener('input', () => { markDirty(); update(); });

$('schemeSel').addEventListener('change', e => {
  const name = e.target.value;
  if (!name) { setSchemeName(''); return; }
  const item = loadStore()[name];
  if (item && item.data) {
    restore(item.data); setSchemeName(name); dirty = false;
    setStatus('已载入方案：' + name);
    toast('已载入「' + name + '」', 'ok');
  } else {
    toast('方案「' + name + '」不存在或已损坏', 'err');
    refreshSchemes('');
  }
});

$('btnSave').addEventListener('click', () => {
  if (!state.scheme) { askSaveAs(); return; }
  const store = loadStore();
  store[state.scheme] = { ts: stampHuman(), data: snapshot() };
  saveStore(store);
  refreshSchemes(state.scheme);
  dirty = false; setStatus('已保存'); toast('已保存「' + state.scheme + '」', 'ok');
});

function askSaveAs() {
  dialog('另存为方案', '给这套参数起个名字（例如：寨上站-1000单-CN6.2）'
    + `<input type="text" id="dlgName" value="${state.scheme || ('方案' + new Date().toLocaleDateString('zh-CN').replace(/\//g, ''))}">`,
    [{ label:'取消' }, { label:'保存', cls:'p', onClick: () => {
      const name = ($('dlgName').value || '').trim();
      if (!name) { toast('名称不能为空', 'err'); return; }
      const store = loadStore();
      if (store[name] && !confirm(`已存在同名方案「${name}」，覆盖吗？`)) return;
      store[name] = { ts: stampHuman(), data: snapshot() };
      saveStore(store);
      refreshSchemes(name); setSchemeName(name);
      dirty = false; setStatus('已保存'); toast('已保存「' + name + '」', 'ok');
    }}]);
}

$('btnSaveAs').addEventListener('click', askSaveAs);

$('btnDel').addEventListener('click', () => {
  if (!state.scheme) { toast('还没有选择方案', 'err'); return; }
  dialog('删除方案', `确定删除「<b>${state.scheme}</b>」吗？此操作不可撤销。`, [
    { label:'取消' },
    { label:'删除', cls:'d', onClick: () => {
      const store = loadStore();
      delete store[state.scheme];
      saveStore(store);
      refreshSchemes(''); setSchemeName(''); setStatus('已删除'); toast('已删除「' + state.scheme + '」', 'ok');
    }}
  ]);
});

$('btnOpen').addEventListener('click', () => {
  const store = loadStore();
  const names = storeNames();
  if (!names.length) {
    dialog('打开方案', '<div class="scheme-list"><div class="empty">还没有保存过任何方案<br>点「保存方案」先存一套吧</div></div>', [{ label:'知道了', cls:'p' }]);
    return;
  }
  const html = '<div class="scheme-list">' + names.map(n =>
    `<div class="it" data-n="${n}"><span class="nm">${n}</span><span class="ts">${stampShortFrom(store[n].ts)}</span></div>`).join('') + '</div>';
  dialog('打开方案', html, [{ label:'取消' }]);
  document.querySelectorAll('.scheme-list .it').forEach(el => el.addEventListener('click', () => {
    const n = el.dataset.n;
    restore(store[n].data); setSchemeName(n); dirty = false;
    closeDialog(); setStatus('已载入方案：' + n); toast('已载入「' + n + '」', 'ok');
  }));
});
/* 方案列表里的时间只显示「月-日 时:分」，兼容旧数据（可能没有 ts） */
function stampShortFrom(ts) {
  const s = String(ts || '');
  return s.length >= 16 ? s.slice(5, 16) : s;
}

$('btnExport').addEventListener('click', () => {
  setStatus('正在导出…');
  try {
    const fn = exportLadderExcel();
    setStatus('已导出');
    dialog('导出成功', `Excel 已生成并开始下载：<br><span style="font-family:ui-monospace;font-size:12px;color:#2563EB;word-break:break-all">${fn}</span>`
      + `<br><span style="font-size:12px;color:#64748B">网页版没有本地文件系统，文件会存到浏览器的「下载」目录。</span>`,
      [{ label:'关闭', cls:'p' }]);
    toast('已导出 Excel', 'ok');
  } catch (e) { setStatus('导出失败'); toast('导出失败：' + e.message, 'err'); }
});

$('btnReset').addEventListener('click', () => {
  dialog('恢复默认', '将把阶梯、单量、CN 和所有科目开关恢复到初始状态。<br>当前未保存的修改会丢失。', [
    { label:'取消' }, { label:'恢复', cls:'d', onClick: () => { resetAll(); dirty = false; setStatus('已恢复默认'); toast('已恢复默认', 'ok'); } }
  ]);
});

$('btnDir').addEventListener('click', () => {
  const n = storeNames().length;
  dialog('方案备份 / 恢复',
    `网页版的方案保存在<b>本浏览器</b>的 localStorage（当前 ${n} 个方案）。`
    + `换电脑、换浏览器、清理缓存都会丢失，建议定期导出备份文件。<br>`
    + `<span style="font-size:12px;color:#64748B">备份文件为 JSON，可在任意浏览器里「导入备份」恢复。</span>`,
    [{ label:'关闭' },
     { label:'导出备份', cls:'p', onClick: backupExport },
     { label:'导入备份', onClick: backupImport }]);
});

function backupExport() {
  const store = loadStore();
  const names = Object.keys(store);
  if (!names.length) { toast('还没有任何方案可备份', 'err'); return; }
  const blob = new Blob([JSON.stringify({ v: 1, exportedAt: stampHuman(), schemes: store }, null, 2)],
    { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `新专送薪资方案备份_${stampFile()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`已导出 ${names.length} 个方案的备份`, 'ok');
}

function backupImport() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const j = JSON.parse(rd.result);
        const src = (j && j.schemes) ? j.schemes : j;
        const store = loadStore();
        let n = 0;
        Object.keys(src || {}).forEach(k => {
          const it = src[k];
          if (it && it.data) { store[k] = { ts: it.ts || stampHuman(), data: it.data }; n++; }
        });
        if (!n) { toast('备份文件里没有可用的方案', 'err'); return; }
        saveStore(store);
        refreshSchemes(state.scheme);
        toast(`已导入 ${n} 个方案`, 'ok');
        setStatus(`已导入 ${n} 个方案`);
      } catch (e) { toast('导入失败：' + e.message, 'err'); }
    };
    rd.readAsText(f);
  };
  inp.click();
}

/* =========================================================
   启动
   ========================================================= */
(function init() {
  $('stDir').textContent = '方案保存在本浏览器 · 导出的 Excel 存到「下载」目录';
  refreshSchemes('');
  renderTiers();
  renderSubjects();
  update();
  setStatus('就绪');
})();
