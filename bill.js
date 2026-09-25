/* =========================================================
   账单测算 · 导入平台骑手薪资账单 → 单量 / 单均 / CN 使用率
   ========================================================= */
let BILL = null;
const BS = { cn: 6, cnMap: {} };

/* ---------- Tab 切换 ---------- */
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  $(t.dataset.page).classList.add('active');
}));
$('pageLadder').classList.add('active');

/* ---------- 拖拽 / 选择文件 ---------- */
const BPO = $('pageBill'), BEMPTY = $('billEmpty');
$('billPick').addEventListener('click', () => $('billFile').click());
$('billReimport').addEventListener('click', () => $('billFile').click());
$('billFile').addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) importBill(f);
  e.target.value = '';
});
['dragenter', 'dragover'].forEach(ev => BPO.addEventListener(ev, e => {
  e.preventDefault();
  if (!BILL) BEMPTY.classList.add('drag');
}));
BPO.addEventListener('dragleave', e => { if (e.target === BPO) BEMPTY.classList.remove('drag'); });
BPO.addEventListener('drop', e => {
  e.preventDefault(); BEMPTY.classList.remove('drag');
  const f = e.dataTransfer.files[0];
  if (f) importBill(f);
});

/* =========================================================
   账单解析（网页版：浏览器内直接解析 .xlsx）
   与桌面版后端 parse_bill() 同口径：表头定位、列名映射、
   收入/扣款/调整科目归类、站点聚合、警告文案逐条对齐。
   金额口径：最终金额 = 薪资合计 + |预支|；单均 = 最终金额 ÷ 总单量
   ========================================================= */
const BILL_INCOME = ['基础配送费项','排班内基础薪资','排班内阶梯薪资','排班外基础薪资','长期激励金额','出勤奖励','全勤奖励','质保奖励','段位奖励','重量奖励','时段奖励','天气奖励','距离奖励','1对1直送奖励','捡货补贴','国补采集补贴','家宴补贴','大额单补贴','鲜花补贴','蛋糕补贴','难度补贴金额','活动收入','推荐奖励','其他加项','一口价','个税退款'];
const BILL_DEDUCT = ['索赔','配送原因取消','违规送达','虚假报备','装备物资','水电费','住宿费用','车辆租金','骑士餐费','其他减项','个税扣款'];
const BILL_ADJUST = ['自定义发薪（提前发薪）','自定义发薪（预支）'];
const BILL_SKIP = ['单量','原因','方式','名称'];
const ADJ_NAME = { '自定义发薪（提前发薪）': '提前发薪', '自定义发薪（预支）': '预支' };

const _bNorm = v => (v === null || v === undefined) ? '' : String(v).replace(/\s+/g, '');
const _bNum = v => {
  if (v === null || v === undefined || String(v).trim() === '') return 0;
  const n = parseFloat(String(v).trim());
  return isNaN(n) ? 0 : n;
};
/* 「基础配送费项（元）」→「基础配送费项」；「难度补贴金额」→「难度补贴」 */
const _bFriendly = name => {
  let s = String(name).replace(/[（(][^）)]*[）)]/g, '');
  if (s.endsWith('金额')) s = s.slice(0, -2);
  return s.trim() || name;
};
/* 与 Python round(v, d) 一致（含四舍六入五取偶），避免金额出现 1 分误差 */
function pround(v, d = 0) {
  const f = Math.pow(10, d), x = (v || 0) * f, fl = Math.floor(x);
  const n = Math.abs(x - fl - 0.5) < 1e-9 ? (fl % 2 === 0 ? fl : fl + 1) : Math.round(x);
  return n / f;
}

function parseBill(arrayBuf, fileName) {
  const wb = XLSX.read(arrayBuf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  const cell = (r, c) => { const row = rows[r - 1]; return (row && c - 1 < row.length) ? row[c - 1] : null; };
  const maxRow = rows.length;
  const maxCol = rows.reduce((a, r) => Math.max(a, r ? r.length : 0), 0);

  /* 表头行：前 20 行内找同时含「骑手姓名」与「总单量」的一行 */
  let hdr = null;
  for (let r = 1; r <= Math.min(maxRow, 20); r++) {
    let line = '';
    for (let c = 1; c <= maxCol; c++) line += _bNorm(cell(r, c));
    if (line.indexOf('骑手姓名') >= 0 && line.indexOf('总单量') >= 0) { hdr = r; break; }
  }
  if (hdr === null) throw new Error('找不到表头行（需要同时包含「骑手姓名」和「总单量」）');

  const H = [];
  for (let c = 1; c <= maxCol; c++) H.push(_bNorm(cell(hdr, c)));
  const find = (kw, skip = true, exact = false) => {
    if (!kw) return null;
    for (let i = 0; i < H.length; i++) {
      const h = H[i];
      const hit = exact ? h === kw : h.indexOf(kw) >= 0;
      if (!hit) continue;
      if (skip && BILL_SKIP.some(x => h.indexOf(x) >= 0)) continue;
      return i;                       /* 返回 0 基下标；用时 +1 取列 */
    }
    return null;
  };

  const idx = {
    id: find('骑手ID', false), name: find('骑手姓名', false), station: find('站点名称', false),
    scheme: find('基础薪资方案', false), period: find('账单周期', false), status: find('账单状态', false),
    orders: find('总单量', false, true), ordersN: find('非一口价单量', false, true),
    ordersF: find('一口价单量', false, true), days: find('有效出勤天', false),
    payNet: find('薪资合计', false), tax: find('计税收入', false),
  };
  const incCols = BILL_INCOME.map(k => [k, find(k)]);
  const dedCols = BILL_DEDUCT.map(k => [k, find(k)]);
  const adjCols = BILL_ADJUST.map(k => [k, find(k)]);

  const orEmpty = v => v ? String(v) : '';
  const warnings = [], riders = [], usedInc = new Set(), usedDed = new Set();

  [['id', '骑手ID'], ['name', '骑手姓名'], ['orders', '总单量']].forEach(([need, nm]) => {
    if (idx[need] === null) warnings.push(`账单里没找到「${nm}」列`);
  });

  for (let r = hdr + 1; r <= maxRow; r++) {
    if (_bNorm(cell(r, 1)) === '') continue;                 /* 首列为空 = 空行 */
    const gt = i => (i === null ? null : cell(r, i + 1));
    const g = i => (i === null ? 0 : _bNum(cell(r, i + 1)));

    const inc = [], ded = [];
    incCols.forEach(([k, i]) => {
      const v = g(i);
      if (Math.abs(v) > 0.004) { const n = _bFriendly(k); inc.push([n, pround(v, 2)]); usedInc.add(n); }
    });
    dedCols.forEach(([k, i]) => {
      const v = g(i);
      if (Math.abs(v) > 0.004) { const n = _bFriendly(k); ded.push([n, pround(v, 2)]); usedDed.add(n); }
    });
    const incSum = pround(inc.reduce((a, p) => a + p[1], 0), 2);
    const dedSum = pround(ded.reduce((a, p) => a + p[1], 0), 2);
    const tax = g(idx.tax);
    const due = pround(incSum - dedSum, 2);

    const adj = [];
    adjCols.forEach(([k, i]) => {
      const v = g(i);
      if (Math.abs(v) > 0.004) adj.push([ADJ_NAME[_bNorm(k)] || _bFriendly(k), pround(v, 2)]);
    });
    const settle = pround(g(idx.payNet), 2);
    const adv = pround(adj.reduce((a, p) => a + p[1], 0), 2);
    const final = pround(settle + Math.abs(adv), 2);

    riders.push({
      id: orEmpty(gt(idx.id)),
      name: orEmpty(gt(idx.name)).trim(),
      station: orEmpty(gt(idx.station)).trim(),
      scheme: orEmpty(gt(idx.scheme)).trim(),
      orders: g(idx.orders), ordersN: g(idx.ordersN), ordersF: g(idx.ordersF), days: g(idx.days),
      payFinal: final, paySettle: settle, advance: adv,
      payNet: settle, payDue: due, tax: pround(tax, 2),
      income: inc, deduct: ded, adjust: adj,
      incomeSum: incSum, deductSum: dedSum,
    });
  }
  if (!riders.length) throw new Error('表头下没有任何骑手数据行');

  /* 账单周期：表头下第一格非空的周期列 */
  let period = '';
  for (let r = hdr + 1; r <= maxRow; r++) {
    const v = cell(r, idx.period === null ? 1 : idx.period + 1);
    if (!v) continue;
    period = String(v); break;
  }

  /* 站点聚合（按总单量降序） */
  const reg = {};
  riders.forEach(x => {
    const s = x.station || '（未标注站点）';
    if (!(s in reg)) reg[s] = { name: s, riders: 0, orders: 0, payFinal: 0, paySettle: 0, advance: 0, payDue: 0, active: 0 };
    const d = reg[s];
    d.riders += 1; d.orders += x.orders; d.payFinal += x.payFinal; d.paySettle += x.paySettle;
    d.advance += x.advance; d.payDue += x.payDue;
    if (x.orders > 0) d.active += 1;
  });
  const stations = Object.keys(reg).map(k => reg[k]).sort((a, b) => b.orders - a.orders);
  stations.forEach(d => ['orders', 'payFinal', 'paySettle', 'advance', 'payDue']
    .forEach(k => { d[k] = pround(d[k], 2); }));

  const zero = riders.filter(x => x.orders <= 0).length;
  if (zero) warnings.push(`${zero} 名骑手本月总单量为 0，单独标注，不参与单均排序`);

  const sumBy = f => pround(riders.reduce((a, x) => a + f(x), 0), 2);
  const totFinal = sumBy(x => x.payFinal), totSettle = sumBy(x => x.paySettle), totAdv = sumBy(x => x.advance);
  const fmt2 = v => v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  warnings.unshift(`金额口径：最终金额 = 薪资合计 + |预支|。本期薪资合计 ${fmt2(totSettle)} 元，` +
    `预支 ${fmt2(Math.abs(totAdv))} 元（账单里是负数，代表已提前发出），相加得最终金额 ${fmt2(totFinal)} 元；` +
    `单均 = 最终金额 ÷ 总单量。`);

  const nAdv = riders.filter(x => Math.abs(x.advance) > 0.004).length;
  if (nAdv) warnings.push(`${nAdv} 名骑手本期有预支/提前发薪记录，其最终金额已把预支按正数加回`);

  const neg = riders.filter(x => x.payFinal <= 0.005).length;
  if (neg) warnings.push(`${neg} 名骑手最终金额为 0 或负数（本月无收入、只有扣款），已在明细中标灰，不计入单均`);

  /* 科目清单：按全账单金额降序 */
  const totBy = (col, set) => {
    const m = {};
    riders.forEach(x => x[col].forEach(p => { m[p[0]] = (m[p[0]] || 0) + p[1]; }));
    return Array.from(set).sort((a, b) => (m[b] || 0) - (m[a] || 0));
  };

  return {
    ok: true, period, headerRow: hdr, riderCount: riders.length,
    totals: {
      riders: riders.length,
      active: riders.filter(x => x.orders > 0).length,
      orders: sumBy(x => x.orders), ordersN: sumBy(x => x.ordersN), ordersF: sumBy(x => x.ordersF),
      payFinal: totFinal, paySettle: totSettle, advance: totAdv,
      payDue: sumBy(x => x.payDue), payNet: totSettle,
    },
    caliber: '最终金额 = 薪资合计 + |预支|（预支为负数，按正数加回）；单均 = 最终金额 ÷ 总单量',
    incomeItems: totBy('income', usedInc),
    deductItems: totBy('deduct', usedDed),
    stations, riders, warnings, file: fileName,
  };
}

/* ---------- 导入 ---------- */
async function importBill(file) {
  if (!/\.(xlsx|xlsm)$/i.test(file.name)) { toast('只支持 .xlsx 格式的账单', 'err'); return; }
  setStatus('正在解析账单…');
  toast('正在解析「' + file.name + '」…');
  try {
    const buf = await file.arrayBuffer();
    const j = parseBill(buf, file.name);
    BILL = j;
    BS.cnMap = {};
    BEMPTY.style.display = 'none';
    $('billMain').style.display = '';
    renderBill();
    setStatus('已导入 ' + j.file);
    toast(`已导入 ${j.riderCount} 名骑手 · 周期 ${j.period}`, 'ok');
  } catch (e) {
    toast('导入失败：' + e.message, 'err');
    setStatus('解析失败');
  }
}

/* ---------- 计算 ---------- */
function cnOf(st) {
  const v = BS.cnMap[st];
  return (v === undefined || v === '' || isNaN(+v)) ? BS.cn : +v;
}
/* 打平判定容差：单均与 CN 相差在 ±0.05 元/单以内视为「打平」 */
const FLAT_TOL = 0.05;

/* 保本 CN：向上取整到 3 位小数。必须「只多不少」，否则用户照着填仍会亏一点点 */
const money3 = v => (v < 0 ? '-' : '') + '¥' + (Math.ceil(Math.abs(+v) * 1000) / 1000).toFixed(3);

/* ---------- 基础薪资方案（账单里的「基础薪资方案名称ID」列） ---------- */
const SCHEME_NONE = '（未标注方案）';
function schemeOf(x) { return (x.scheme || '').trim() || SCHEME_NONE; }
/* 显示用短名：去掉「厦门」前缀，保留「岛内/岛外 + 站点 + 方案 + (ID)」便于识别 */
function schemeShort(s) {
  if (!s || s === SCHEME_NONE) return s || SCHEME_NONE;
  return s.replace(/^厦门/, '');
}
/* 方案清单：按骑手数降序 */
function schemeList() {
  if (!BILL) return [];
  const m = new Map();
  BILL.riders.forEach(x => {
    const k = schemeOf(x);
    const d = m.get(k) || { name: k, riders: 0, active: 0, orders: 0, payFinal: 0 };
    d.riders++; d.orders += x.orders; d.payFinal += (x.payFinal || 0);
    if (x.orders > 0) d.active++;
    m.set(k, d);
  });
  return [...m.values()].sort((a, b) => b.riders - a.riders || a.name.localeCompare(b.name, 'zh'));
}
/* 当前方案筛选值（'' = 全部） */
function curScheme() { return ($('billSchemeFilter') || {}).value || ''; }

function calcR(x) {
  const cn = cnOf(x.station);
  const avg = x.orders > 0 ? x.payFinal / x.orders : 0;
  const use = cn > 0 ? avg / cn : 0;
  const margin = cn - avg;
  const mm = margin * x.orders;
  // 盈亏三态：赚钱 / 打平 / 亏损（零单单独一档）
  let pnl = 'zero';
  if (x.orders > 0) pnl = Math.abs(margin) <= FLAT_TOL ? 'flat' : (margin > 0 ? 'win' : 'lose');
  return { cn, avg, use, margin, mm, pnl };
}

/* 盈亏汇总：人数 / 单量 / 盈亏金额 */
function pnlStat(list) {
  const s = { win: { n: 0, orders: 0, mm: 0 }, flat: { n: 0, orders: 0, mm: 0 },
              lose: { n: 0, orders: 0, mm: 0 }, zero: { n: 0, orders: 0, mm: 0 } };
  list.forEach(x => {
    const r = calcR(x), d = s[r.pnl];
    d.n++; d.orders += x.orders; d.mm += r.mm;
  });
  return s;
}
function combine(list) {
  const o = list.reduce((a, x) => a + x.orders, 0);
  const pf = list.reduce((a, x) => a + x.payFinal, 0);
  const ps = list.reduce((a, x) => a + (x.paySettle || 0), 0);
  const ad = list.reduce((a, x) => a + (x.advance || 0), 0);
  const avg = o > 0 ? pf / o : 0;
  const cn = list.length ? list.reduce((a, x) => a + cnOf(x.station), 0) / list.length : BS.cn;
  return { orders: o, payFinal: pf, paySettle: ps, advance: ad, avg, cn,
           use: cn > 0 ? avg / cn : 0, margin: cn - avg, mm: (cn - avg) * o };
}

/* ---------- 主渲染 ---------- */
function renderBill() {
  if (!BILL) return;
  const T = BILL.totals;
  const all = BILL.riders.map(x => ({ ...x, c: calcR(x) }));
  const agg = combine(BILL.riders);

  $('billFileInfo').textContent = BILL.file || '账单';
  $('billMeta').textContent = `周期 ${BILL.period}　|　骑手 ${T.riders} 人（有单 ${T.active}）　|　总单量 ${T.orders.toLocaleString()}`;

  // KPI
  $('bRiders').textContent = T.active + ' / ' + T.riders;
  $('bRidersF').textContent = (T.riders - T.active) + ' 人本月零单';
  $('bOrders').textContent = T.orders.toLocaleString();
  $('bOrdersF').textContent = `非一口价 ${T.ordersN.toLocaleString()} · 一口价 ${T.ordersF.toLocaleString()}`;
  $('bPay').textContent = money(T.payFinal, 0);
  $('bPayF').textContent = `薪资合计 ${money(T.paySettle, 0)} + 预支 ${money(Math.abs(T.advance), 0)}`;
  $('bAvg').textContent = money(agg.avg);
  $('bAvgF').textContent = `最终金额 ${money(T.payFinal, 0)} ÷ ${T.orders.toLocaleString()} 单`;
  $('bUse').textContent = agg.cn > 0 ? pct(agg.use) : '—';
  $('bUse').className = 'kv ' + (agg.use > 1 ? 'r' : agg.use > 0.9 ? 'a' : 'g');
  $('bUseF').textContent = `单均 ${money(agg.avg)} ÷ CN ${money(agg.cn)}`;

  // CN 设置
  $('billCn').value = BS.cn;
  $('billCnStations').innerHTML = BILL.stations.map(s =>
    `<div class="cn-st"><span class="nm">${s.name.replace(/^厦门/, '').replace(/-UB$/, '')}</span>
      <input type="number" step="0.1" min="0" data-st="${encodeURIComponent(s.name)}"
        value="${BS.cnMap[s.name] !== undefined ? BS.cnMap[s.name] : ''}"
        placeholder="${BS.cn}"></div>`).join('');
  $('billCnStations').querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', e => {
      const st = decodeURIComponent(e.target.dataset.st);
      const v = e.target.value.trim();
      if (v === '') delete BS.cnMap[st]; else BS.cnMap[st] = +v;
      refreshNumbers();
    });
  });
  updateCnResult(agg);

  // 警告
  $('billWarn').innerHTML = (BILL.warnings || []).map(w =>
    `<div class="al w">${w}</div>`).join('');

  // 站点筛选项（保留当前选择；方案变化后只列该方案下的站点）
  renderStationOptions();
  // 薪资方案筛选项（默认「全部」，只在首次导入或旧值已不存在时重置）
  renderSchemeOptions();

  renderStations();
  renderSchemes();
  renderPnl();
  renderRiders();
  renderAdjust();
  renderCompose();
  renderBillFormula(agg);
}

/* 站点下拉：随「薪资方案」筛选联动 */
function renderStationOptions() {
  const keep = $('billStationFilter').value;
  let sts = BILL.stations.map(s => s.name);
  const sc = curScheme();
  if (sc) {
    const set = new Set();
    BILL.riders.filter(x => schemeOf(x) === sc).forEach(x => set.add(x.station));
    sts = sts.filter(n => set.has(n));
  }
  $('billStationFilter').innerHTML = '<option value="">全部站点</option>'
    + sts.map(n => `<option value="${n}">${n}</option>`).join('');
  $('billStationFilter').value = sts.includes(keep) ? keep : '';
}

/* 薪资方案下拉：列出账单里所有「基础薪资方案名称ID」，带人数与单量便于一眼判断权重 */
function renderSchemeOptions() {
  const keep = $('billSchemeFilter').value;
  const list = schemeList();
  $('billSchemeFilter').innerHTML = '<option value="">全部薪资方案（共 ' + list.length + ' 个）</option>'
    + list.map(s => `<option value="${s.name}">${schemeShort(s.name)} · ${s.riders}人 / ${s.orders.toLocaleString()}单</option>`).join('');
  $('billSchemeFilter').value = list.some(s => s.name === keep) ? keep : '';
}

/* ---------- 薪资方案汇总（可按盈亏筛选 + 点一行即筛骑手） ---------- */
/* 每个方案的聚合值（含盈亏三态判定） */
function schemeRows() {
  return schemeList().map(s => {
    const rs = BILL.riders.filter(x => schemeOf(x) === s.name).map(x => ({ ...x, c: calcR(x) }));
    const agg = combine(rs);
    const p = pnlStat(rs);
    let pnl = 'zero';
    if (s.orders > 0) pnl = Math.abs(agg.margin) <= FLAT_TOL ? 'flat' : (agg.margin > 0 ? 'win' : 'lose');
    return { s, rs, agg, p, pnl };
  });
}
/* 盈亏标签（方案单均若跨站点且 CN 不同，用加权单均判定） */
function pnlTag(margin, orders) {
  if (!orders) return '<span class="badge z">零单</span>';
  if (Math.abs(margin) <= FLAT_TOL) return '<span class="badge fl">打平</span>';
  return margin > 0 ? '<span class="badge lo">赚钱</span>' : '<span class="badge hi">亏损</span>';
}

function renderSchemes() {
  if (!BILL) return;
  const cur = curScheme();
  const flag = ($('billSchemeFlag') || {}).value || '';
  const all = schemeRows();
  let list = all;
  if (flag === 'win' || flag === 'flat' || flag === 'lose') list = all.filter(r => r.pnl === flag);
  else if (flag === 'lose_top') {
    list = all.filter(r => r.pnl === 'lose').sort((a, b) => a.agg.mm - b.agg.mm).slice(0, 10);
  }

  const rows = list.map(({ s, agg, p, pnl }) => {
    const dist = `<span class="badge lo">${p.win.n}</span> <span class="badge fl">${p.flat.n}</span> `
      + `<span class="badge hi">${p.lose.n}</span>${p.zero.n ? ` <span class="badge z">${p.zero.n}</span>` : ''}`;
    return `<tr class="scrow${s.name === cur ? ' sel' : ''}" data-scheme="${encodeURIComponent(s.name)}"
        title="点击筛选该方案的骑手">
      <td class="nme" style="font-size:12px;white-space:normal;min-width:180px;max-width:250px;line-height:1.3">${schemeShort(s.name)}</td>
      <td>${s.riders}</td><td>${s.active}</td>
      <td>${s.orders.toLocaleString()}</td>
      <td>${money(s.payFinal, 0)}</td>
      <td style="font-weight:800">${s.orders > 0 ? money(agg.avg) : '—'}</td>
      <td>${pnlTag(agg.margin, s.orders)}</td>
      <td style="letter-spacing:1px">${dist}</td>
      <td style="font-weight:700;color:${agg.margin < 0 ? 'var(--red)' : 'var(--green)'}">${s.orders > 0 ? money(agg.margin) : '—'}</td>
      <td style="font-weight:800;color:${agg.mm < 0 ? 'var(--red)' : 'var(--green)'}">${s.orders > 0 ? money(agg.mm, 0) : '—'}</td>
      <td style="color:var(--amber);font-weight:700">${s.orders > 0 ? money3(agg.avg) : '—'}</td></tr>`;
  }).join('');

  /* 合计行：跟随当前筛选子集 —— 筛「亏钱的方案」时，合计就是这些方案的合计亏损 */
  const merged = list.flatMap(r => r.rs);
  const ag = combine(merged), pa = pnlStat(merged);
  const scope = flag ? `${list.length} / ${all.length}` : `${all.length}`;
  const empt = list.length ? '' : `<tr><td colspan="11" style="text-align:center;color:var(--mu2);
      padding:22px;font-family:inherit;font-weight:500">当前筛选下没有符合条件的方案</td></tr>`;
  const tot = list.length ? `<tr style="background:#F4F6FA;font-weight:800">
      <td style="white-space:normal">合计（${scope} 个方案）</td><td>${merged.length}</td>
      <td>${merged.filter(x => x.orders > 0).length}</td>
      <td>${ag.orders.toLocaleString()}</td><td>${money(ag.payFinal, 0)}</td>
      <td>${money(ag.avg)}</td>
      <td>${pnlTag(ag.margin, ag.orders)}</td>
      <td style="letter-spacing:1px"><span class="badge lo">${pa.win.n}</span> <span class="badge fl">${pa.flat.n}</span> <span class="badge hi">${pa.lose.n}</span>${pa.zero.n ? ` <span class="badge z">${pa.zero.n}</span>` : ''}</td>
      <td style="color:${ag.margin < 0 ? 'var(--red)' : 'var(--green)'}">${money(ag.margin)}</td>
      <td style="color:${ag.mm < 0 ? 'var(--red)' : 'var(--green)'}">${money(ag.mm, 0)}</td>
      <td style="color:var(--amber)">${money3(ag.avg)}</td></tr>` : '';

  $('billSchemeTbl').innerHTML = rows + empt + tot;
  $('billSchemeCount').textContent = flag
    ? `显示 ${list.length} / ${all.length} 个方案`
    : `共 ${all.length} 个方案`;

  $('billSchemeTbl').querySelectorAll('tr.scrow').forEach(tr => {
    tr.addEventListener('click', () => {
      const v = decodeURIComponent(tr.dataset.scheme);
      $('billSchemeFilter').value = (curScheme() === v) ? '' : v;
      renderStationOptions();
      renderSchemes(); renderPnl(); renderRiders();
    });
  });
}

function updateCnResult(agg) {
  $('bMargin').textContent = money(agg.margin);
  $('bMargin').className = agg.margin < 0 ? 'r' : 'g';
  $('bMonthMargin').textContent = money(agg.mm, 0);
  $('bMonthMargin').className = agg.mm < 0 ? 'r' : 'g';
  $('bBreakEven').textContent = money3(agg.avg);
}

/* ---------- 盈亏总览（卡片可点，点了就筛选） ---------- */
function renderPnl() {
  const st = pnlStat(BILL.riders);
  const active = st.win.n + st.flat.n + st.lose.n;
  const card = (key, label, sub, cls, val, valCls) => `
    <div class="pnlc ${cls}" data-pnl="${key}" title="点击只看这一类">
      <div class="pl">${label}</div>
      <div class="pv ${valCls}">${val}</div>
      <div class="pf">${sub}</div>
    </div>`;
  const cur = $('billFlag').value;
  const act = k => (cur === k ? ' sel' : '');
  // 全站盈亏用 combine()，与「CN 设置」区的总毛利保持同一口径
  // （零单骑手虽无单量，但可能有扣款形成欠款，combine 会计入）
  const aggAll = combine(BILL.riders);
  $('billPnl').innerHTML =
    card('win', '赚钱的骑手', `使用率 &lt; 100%（每单赚 &gt; ${FLAT_TOL} 元）`, 'ok' + act('win'),
         st.win.n + ' 人', 'g') +
    card('flat', '打平的骑手', `使用率 100% ± ${(FLAT_TOL / (BS.cn || 6) * 100).toFixed(1)}%`,
         'mid' + act('flat'), st.flat.n + ' 人', 'a') +
    card('lose', '亏损的骑手', `使用率 &gt; 100%（每单亏 &gt; ${FLAT_TOL} 元）`, 'bad' + act('lose'),
         st.lose.n + ' 人', 'r') +
    card('zero', '零单骑手', '本月无单量，不计入单均', 'zer' + act('zero'), st.zero.n + ' 人', 'n') +
    `<div class="pnlc tot${act('')}" data-pnl="" title="点击看全部">
       <div class="pl">全站盈亏（含零单欠款）</div>
       <div class="pv ${aggAll.mm < 0 ? 'r' : 'g'}">${money(aggAll.mm, 0)}</div>
       <div class="pf">${active} 名有单骑手中 ${st.lose.n} 人亏损，合计 ${money(st.lose.mm, 0)}</div>
     </div>`;
  $('billPnl').querySelectorAll('[data-pnl]').forEach(el => {
    el.addEventListener('click', () => {
      $('billFlag').value = el.dataset.pnl;
      renderPnl(); renderRiders();
    });
  });
}

/* ---------- 亏损排行 + 怎么调整才能赚钱 ---------- */
function renderAdjust() {
  const all = BILL.riders.map(x => ({ ...x, c: calcR(x) }));
  const st = pnlStat(BILL.riders);
  const agg = combine(BILL.riders);
  const lose = all.filter(x => x.c.pnl === 'lose').sort((a, b) => a.c.mm - b.c.mm);
  const totalLoss = lose.reduce((a, x) => a + x.c.mm, 0);
  const curCn = BS.cn;

  /* 1) 亏最多的骑手 */
  const top = lose.slice(0, 15).map((x, i) => {
    const needCn = x.c.avg;                                  // 保本 CN = 该骑手单均
    const cut = x.c.avg - x.c.cn;                            // 现有 CN 下要压降的单均
    const cutPct = x.c.avg > 0 ? cut / x.c.avg * 100 : 0;
    return `<tr>
      <td class="nme">${i + 1}. ${x.name}</td>
      <td class="muted" style="font-weight:400;font-size:12px">${x.station}</td>
      <td>${x.orders.toLocaleString()}</td>
      <td>${money(x.c.avg)}</td>
      <td>${money(x.c.cn)}</td>
      <td style="color:var(--red);font-weight:700">${money(x.c.margin)}</td>
      <td style="color:var(--red);font-weight:800">${money(x.c.mm, 0)}</td>
      <td style="color:var(--amber);font-weight:700">${money3(needCn)}</td>
      <td class="muted">${money(cut)}（−${cutPct.toFixed(1)}%）</td></tr>`;
  }).join('');

  /* 2) 站点怎么调 */
  const stRows = BILL.stations.map(s => {
    const cn = cnOf(s.name);
    const avg = s.orders > 0 ? s.payFinal / s.orders : 0;
    const mg = cn - avg, mm = mg * s.orders;
    const needCn = avg;
    const cut = avg - cn;
    const okNow = mg >= -FLAT_TOL;
    return { name: s.name, orders: s.orders, avg, cn, mg, mm, needCn, cut, okNow };
  }).sort((a, b) => a.mm - b.mm);
  const stHtml = stRows.map(r => `<tr>
      <td>${r.name}</td>
      <td>${r.orders.toLocaleString()}</td>
      <td>${money(r.avg)}</td>
      <td>${money(r.cn)}</td>
      <td style="color:${r.mg < 0 ? 'var(--red)' : 'var(--green)'};font-weight:700">${money(r.mg)}</td>
      <td style="color:${r.mm < 0 ? 'var(--red)' : 'var(--green)'};font-weight:800">${money(r.mm, 0)}</td>
      <td style="color:var(--amber);font-weight:700">${money3(r.needCn)}</td>
      <td class="muted">${r.okNow ? '已达标' : `提 CN 到 ${money3(r.needCn)} 或压单均 ${money(r.cut)}`}</td></tr>`).join('');

  /* 3) 全站调整方案：提 CN / 压单均 / 组合 */
  const needCnAll = agg.avg;                                  // 全站保本 CN
  const cnGap = needCnAll - agg.cn;
  const cnUpPct = agg.cn > 0 ? cnGap / agg.cn * 100 : 0;
  // 方案 B：CN 不变，把单均压到 CN 以内
  const cutNeed = agg.avg - agg.cn;                           // 需压降的单均
  const cutPct = agg.avg > 0 ? cutNeed / agg.avg * 100 : 0;
  const cutAmt = cutNeed * agg.orders;                        // 对应要省下的钱
  // 方案 C：各承担一半
  const halfCn = (agg.cn + agg.avg) / 2;
  const halfCut = agg.avg - halfCn;
  const allOk = agg.margin >= -FLAT_TOL;

  const plan = allOk
    ? `<div class="al ok"><b>✓ 当前 CN ${money(agg.cn)} 已能覆盖单均 ${money(agg.avg)}。</b>
         全站每单赚 <b>${money(agg.margin)}</b>，共 ${money(agg.mm, 0)} 元。可继续观察亏损的那 ${st.lose.n} 名骑手。</div>`
    : `<div class="planbox">
        <div class="prow"><span class="ptag a">方案 A · 提 CN</span>
          <span>把 CN 从 <b>${money(agg.cn)}</b> 提到 <b class="amber">${money3(needCnAll)}</b>
          （<b>+${cnUpPct.toFixed(1)}%</b>），即可全站保本。</span></div>
        <div class="prow"><span class="ptag b">方案 B · 压单均</span>
          <span>CN 不变，把全站单均从 <b>${money3(agg.avg)}</b> 压到 <b class="amber">${money3(agg.cn)}</b>
          以内 —— 每单要省 <b>${money(cutNeed)}</b>（−${cutPct.toFixed(1)}%），
          全月合计省 <b>${money(cutAmt, 0)}</b>。</span></div>
        <div class="prow"><span class="ptag c">方案 C · 折中</span>
          <span>CN 提到 <b class="amber">${money3(halfCn)}</b> + 单均压到 <b class="amber">${money3(halfCn)}</b>
          （各让一半），两边压力都小一些。</span></div>
        <div class="prow"><span class="ptag d">缺口</span>
          <span>当前 CN ${money(agg.cn)} 下全站每单亏 <b class="red">${money(-agg.margin)}</b>，
          全月共亏 <b class="red">${money(-agg.mm, 0)}</b>；需覆盖 ${agg.orders.toLocaleString()} 单。
          其中 <b class="red">${st.lose.n} 名亏损骑手</b>合计亏 <b class="red">${money(-st.lose.mm, 0)}</b>，
          ${st.win.n} 名赚钱骑手贡献 <b class="green">${money(st.win.mm, 0)}</b>。</span></div>
      </div>`;

  /* 4) CN 敏感性：不同 CN 下赚/平/亏人数与总毛利 */
  const saved = BS.cn;
  const sens = [];
  for (let c = 5.8; c <= 7.21; c += 0.2) {
    BS.cn = +c.toFixed(2);
    const a = combine(BILL.riders), p = pnlStat(BILL.riders);
    sens.push({ cn: BS.cn, mm: a.mm, win: p.win.n, flat: p.flat.n, lose: p.lose.n });
  }
  BS.cn = saved;
  const si = sens.findIndex(r => Math.abs(r.cn - (saved || 6)) < 0.001);
  const sensHtml = sens.map((r, i) => `<tr${i === si ? ' class="cur"' : ''}>
      <td style="font-weight:800">${money(r.cn)}</td>
      <td>${r.win}</td><td>${r.flat}</td><td>${r.lose}</td>
      <td style="font-weight:800;color:${r.mm < 0 ? 'var(--red)' : 'var(--green)'}">${money(r.mm, 0)}</td>
      <td>${r.lose === 0 ? '<span style="color:var(--green);font-weight:700">全部不亏</span>' : ''}</td></tr>`).join('');

  $('billAdjust').innerHTML =
    `<div class="adjsec">
       <div class="adjh">① 亏得最多的骑手 TOP ${lose.length ? Math.min(15, lose.length) : 0}
         <span class="muted">共 ${lose.length} 人亏损，合计 <b class="red">${money(totalLoss, 0)}</b> 元</span></div>
       ${lose.length ? `<div class="tw" style="max-height:330px"><table class="dt">
         <thead><tr><th>骑手</th><th>站点</th><th>总单量</th><th>单均</th><th>CN</th><th>每单亏</th>
           <th>总亏损</th><th>保本 CN</th><th>或压降单均</th></tr></thead>
         <tbody>${top}</tbody></table></div>`
        : '<div class="al ok">当前 CN 下没有亏损骑手 ✓</div>'}
     </div>

     <div class="adjsec">
       <div class="adjh">② 站点怎么调（按亏损从大到小）</div>
       <div class="tw" style="max-height:none"><table class="dt">
         <thead><tr><th>站点</th><th>总单量</th><th>单均</th><th>当前 CN</th><th>每单毛利</th>
           <th>站点毛利</th><th>保本 CN</th><th>调整动作</th></tr></thead>
         <tbody>${stHtml}</tbody></table></div>
     </div>

     <div class="adjsec">
       <div class="adjh">③ 全站怎么调才能赚钱</div>
       ${plan}
     </div>

     <div class="adjsec">
       <div class="adjh">④ CN 敏感性：不同 CN 下的盈亏分布
         <span class="muted">（发生效的 CN 是每站独立的，下面按「全局 CN 变动」模拟）</span></div>
       <div class="tw" style="max-height:none"><table class="dt">
         <thead><tr><th>CN（元/单）</th><th>赚钱人数</th><th>打平人数</th><th>亏损人数</th><th>全站毛利</th><th>结论</th></tr></thead>
         <tbody>${sensHtml}</tbody></table></div>
     </div>`;
}

function refreshNumbers() {
  const all = BILL.riders.map(x => ({ ...x, c: calcR(x) }));
  const agg = combine(BILL.riders);
  $('bUse').textContent = agg.cn > 0 ? pct(agg.use) : '—';
  $('bUse').className = 'kv ' + (agg.use > 1 ? 'r' : agg.use > 0.9 ? 'a' : 'g');
  $('bUseF').textContent = `单均 ${money(agg.avg)} ÷ CN ${money(agg.cn)}`;
  updateCnResult(agg);
  renderStations();
  renderPnl();
  renderRiders();
  renderAdjust();
  renderBillFormula(agg);
}

/* ---------- 站点表 ---------- */
function renderStations() {
  $('billStationTbl').innerHTML = BILL.stations.map(s => {
    const cn = cnOf(s.name);
    const avg = s.orders > 0 ? s.payFinal / s.orders : 0;
    const use = cn > 0 ? avg / cn : 0;
    const mg = cn - avg;
    const uc = use > 1 ? 'var(--red)' : use > 0.9 ? 'var(--amber)' : 'var(--green)';
    return `<tr><td>${s.name}</td><td>${s.riders}</td><td>${s.active}</td>
      <td>${s.orders.toLocaleString()}</td><td>${money(s.payFinal, 0)}</td>
      <td style="font-weight:800">${money(avg)}</td><td>${money(cn)}</td>
      <td style="color:${uc};font-weight:700">${cn > 0 ? pct(use) : '—'}</td>
      <td style="color:${mg < 0 ? 'var(--red)' : 'var(--green)'}">${money(mg)}</td>
      <td style="font-weight:700;color:${mg < 0 ? 'var(--red)' : 'var(--green)'}">${money(mg * s.orders, 0)}</td></tr>`;
  }).join('') + (() => {
    const agg = combine(BILL.riders);
    return `<tr style="background:#F7FAFD;font-weight:800">
      <td>合计 / 加权</td><td>${BILL.totals.riders}</td><td>${BILL.totals.active}</td>
      <td>${BILL.totals.orders.toLocaleString()}</td><td>${money(BILL.totals.payFinal, 0)}</td>
      <td>${money(agg.avg)}</td><td>${money(agg.cn)}</td>
      <td>${agg.cn > 0 ? pct(agg.use) : '—'}</td><td>${money(agg.margin)}</td><td>${money(agg.mm, 0)}</td></tr>`;
  })();
}

/* ---------- 骑手表 ---------- */
function currentList() {
  let arr = BILL.riders.map(x => ({ ...x, c: calcR(x) }));
  const q = ($('billSearch').value || '').trim().toLowerCase();
  const st = $('billStationFilter').value;
  const sc = curScheme();
  const flag = $('billFlag').value;
  if (q) arr = arr.filter(x => (x.name + ' ' + x.station + ' ' + x.id + ' ' + (x.scheme || '')).toLowerCase().includes(q));
  if (sc) arr = arr.filter(x => schemeOf(x) === sc);
  if (st) arr = arr.filter(x => x.station === st);
  // 盈亏筛选：赚钱 / 打平 / 亏损 / 亏最多 TOP / 零单 / 单均 TOP
  if (flag === 'win' || flag === 'flat' || flag === 'lose') arr = arr.filter(x => x.c.pnl === flag);
  else if (flag === 'zero') arr = arr.filter(x => x.orders <= 0);
  const s = $('billSort').value;
  if (s === 'avg_desc') arr.sort((a, b) => b.c.avg - a.c.avg);
  else if (s === 'avg_asc') arr.sort((a, b) => (a.orders > 0 ? a.c.avg : 9e9) - (b.orders > 0 ? b.c.avg : 9e9));
  else if (s === 'orders_desc') arr.sort((a, b) => b.orders - a.orders);
  else if (s === 'orders_asc') arr.sort((a, b) => a.orders - b.orders);
  else if (s === 'use_desc') arr.sort((a, b) => b.c.use - a.c.use);
  else if (s === 'loss_desc') arr.sort((a, b) => a.c.mm - b.c.mm);      // 亏最多在前
  else if (s === 'profit_desc') arr.sort((a, b) => b.c.mm - a.c.mm);    // 赚最多在前
  else arr.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  if (flag === 'lose_top') arr = arr.filter(x => x.c.pnl === 'lose').sort((a, b) => a.c.mm - b.c.mm).slice(0, 20);
  else if (flag === 'top') arr = arr.filter(x => x.orders > 0).slice(0, 20);
  else if (flag === 'win_top') arr = arr.filter(x => x.c.pnl === 'win').sort((a, b) => b.c.mm - a.c.mm).slice(0, 20);
  return arr;
}

function renderRiders() {
  const list = currentList();
  const maxO = Math.max(...BILL.riders.map(x => x.orders), 1);
  $('billCount').textContent = `显示 ${list.length} / ${BILL.riders.length} 人`;
  const PNLTAG = { win: ['赚钱', 'lo'], flat: ['打平', 'fl'], lose: ['亏损', 'hi'], zero: ['零单', 'z'] };
  $('billRiderTbl').innerHTML = list.map(x => {
    const zero = x.orders <= 0;
    const uc = x.c.use > 1 ? 'var(--red)' : x.c.use > 0.9 ? 'var(--amber)' : 'var(--green)';
    const tag = PNLTAG[x.c.pnl];
    const bar = `<span class="mini-bar" style="width:${Math.round(x.orders / maxO * 46)}px"></span>`;
    const sc = schemeShort(schemeOf(x));
    return `<tr${zero ? ' style="opacity:.55"' : ''}>
      <td class="nme">${x.name}</td>
      <td class="muted" style="font-weight:400;font-size:12px">${x.station}</td>
      <td class="sch">${sc}</td>
      <td><span class="badge ${tag[1]}">${tag[0]}</span></td>
      <td>${x.orders.toLocaleString()}${bar}</td>
      <td>${x.ordersN.toLocaleString()}</td>
      <td>${x.ordersF.toLocaleString()}</td>
      <td style="font-weight:800">${money(x.payFinal, 0)}</td>
      <td class="muted">${money(x.paySettle, 0)}</td>
      <td class="muted" style="color:${Math.abs(x.advance) > 0.004 ? '#DC2626' : 'inherit'}">${Math.abs(x.advance) > 0.004 ? money(Math.abs(x.advance), 0) : '—'}</td>
      <td style="font-weight:800">${zero ? '—' : money(x.c.avg)}</td>
      <td style="color:${uc};font-weight:700">${zero ? '—' : (x.c.cn > 0 ? pct(x.c.use) : '—')}</td>
      <td style="color:${x.c.margin < 0 ? 'var(--red)' : 'var(--green)'};font-weight:700">${zero ? '—' : money(x.c.margin)}</td>
      <td style="font-weight:800;color:${x.c.mm < 0 ? 'var(--red)' : 'var(--green)'}">${zero ? '—' : money(x.c.mm, 0)}</td></tr>`;
  }).join('');
}

/* ---------- 费用构成 ---------- */
function renderCompose() {
  const inc = {}, ded = {};
  BILL.riders.forEach(x => {
    x.income.forEach(([n, v]) => inc[n] = (inc[n] || 0) + v);
    x.deduct.forEach(([n, v]) => ded[n] = (ded[n] || 0) + v);
  });
  const incArr = Object.entries(inc).sort((a, b) => b[1] - a[1]);
  const dedArr = Object.entries(ded).sort((a, b) => b[1] - a[1]);
  const mx = Math.max(...incArr.map(a => a[1]), 1);
  const md = Math.max(...dedArr.map(a => a[1]), 1);
  const totI = incArr.reduce((a, b) => a + b[1], 0);
  const totD = dedArr.reduce((a, b) => a + b[1], 0);
  const bar = (arr, max, color) => arr.map(([n, v]) =>
    `<div class="cmprow"><span class="cnm">${n}</span>
      <div class="cw"><div class="cb" style="width:${(v / max * 100).toFixed(1)}%;background:${color}"></div></div>
      <span class="cv">${money(v, 0)}</span>
      <span class="cp">${(v / (color === '#16A34A' ? totI : totD) * 100).toFixed(1)}%</span></div>`).join('');
  $('billCompose').innerHTML =
    `<div style="font-size:13px;font-weight:800;color:var(--navy);margin-bottom:11px">
       收入项合计 ${money(totI, 0)}　<span style="color:var(--mu2);font-weight:600">（${incArr.length} 个科目）</span></div>`
    + bar(incArr, mx, '#16A34A')
    + `<div style="font-size:13px;font-weight:800;color:var(--red);margin:20px 0 11px">
       扣缴项合计 ${money(totD, 0)}　<span style="color:var(--mu2);font-weight:600">（${dedArr.length} 个科目）</span></div>`
    + (dedArr.length ? bar(dedArr, md, '#DC2626') : '<div style="color:var(--mu2);font-size:12.5px">本期无扣缴项</div>');
}

/* ---------- 公式 ---------- */
function renderBillFormula(agg) {
  const T = BILL.totals;
  $('billFormula').innerHTML = [
    ['账单文件', BILL.file || '—'],
    ['账单周期', BILL.period],
    ['识别骑手数', `${T.riders} 人（其中 ${T.active} 人有单量）`],
    ['金额口径', '最终金额 = 薪资合计 + |预支|　（预支在账单里是负数，代表已提前发出，按正数加回）'],
    ['① 薪资合计', money(T.paySettle, 2)],
    ['② 预支（绝对值）', money(Math.abs(T.advance), 2)],
    ['最终金额 = ① + ②', money(T.payFinal, 2)],
    ['总单量', `${T.orders.toLocaleString()}　= 非一口价 ${T.ordersN.toLocaleString()} + 一口价 ${T.ordersF.toLocaleString()}`],
    ['骑手单均', `最终金额 ${money(T.payFinal, 2)} ÷ ${T.orders.toLocaleString()} 单 = ${money(agg.avg)}`],
    ['CN 单价', money(agg.cn)],
    ['CN 使用率', `单均 ${money(agg.avg)} ÷ CN ${money(agg.cn)} = ${agg.cn > 0 ? pct(agg.use) : '—'}`],
    ['保本 CN', `${money(agg.avg)}（CN 低于此值即亏损）`],
    ['每单毛利', `CN ${money(agg.cn)} − 单均 ${money(agg.avg)} = ${money(agg.margin)}`],
    ['总毛利', `${money(agg.margin)} × ${T.orders.toLocaleString()} 单 = ${money(agg.mm, 2)}`],
    ['盈亏判定', `每单毛利 &gt; +${FLAT_TOL} 元 → 赚钱；|每单毛利| ≤ ${FLAT_TOL} 元 → 打平；&lt; −${FLAT_TOL} 元 → 亏损`],
    ['盈亏分布', (() => {
        const s = pnlStat(BILL.riders);
        return `赚钱 ${s.win.n} 人 / 打平 ${s.flat.n} 人 / 亏损 ${s.lose.n} 人 / 零单 ${s.zero.n} 人；亏损合计 ${money(s.lose.mm, 0)}`;
      })()],
    ['调整方向', agg.margin >= -FLAT_TOL
        ? `当前 CN 已达标，每单赚 ${money(agg.margin)}`
        : `① CN 提到 ${money(agg.avg)}；② 或把单均从 ${money(agg.avg)} 压到 ${money(agg.cn)} 以内（每单省 ${money(agg.avg - agg.cn)}）`],
    ['零单骑手', '总单量为 0，单均无意义，已在明细中标灰'],
  ].map(([a, b]) => `<div class="fr2"><span class="fn">${a}</span><span class="fv">${b}</span></div>`).join('');
}

/* ---------- 交互绑定 ---------- */
['billSearch', 'billSchemeFilter', 'billStationFilter', 'billSort', 'billFlag'].forEach(id =>
  $(id).addEventListener(id === 'billSearch' ? 'input' : 'change', () => {
    if (!BILL) return;
    if (id === 'billSchemeFilter') {          // 方案变了：站点下拉跟着收窄 + 表格高亮
      renderStationOptions();
      renderSchemes();
    }
    if (id === 'billFlag') renderPnl();      // 同步卡片高亮
    renderRiders();
  }));

// 方案汇总的盈亏筛选（只影响 C 段，不动骑手明细）
$('billSchemeFlag').addEventListener('change', () => { if (BILL) renderSchemes(); });

$('billCn').addEventListener('input', e => {
  BS.cn = +e.target.value || 0;
  $('billCnStations').querySelectorAll('input').forEach(i => i.placeholder = BS.cn);
  if (BILL) refreshNumbers();
});

/* =========================================================
   Excel 导出（网页版：xlsx-js-style 在浏览器内生成并下载）
   与桌面版后端 bill_export() 同口径：5 张工作表、表头配色、
   字号字色、数字格式、盈亏条件配色、合计行全部对齐。
   ========================================================= */
const MSYH = '微软雅黑';
const BD_C = 'C9D6E4';
const BFILL = '1E4E86', SFILL = 'DCE9FA', HFILL = '10243D';
const PNL_FILL = { '赚钱': 'D9F2E3', '打平': 'FBEFD6', '亏损': 'FBDCDC', '零单': 'EEF1F5' };
const PNL_FONT = {
  '赚钱': { bold: true, color: '15803D' }, '打平': { bold: true, color: 'B45309' },
  '亏损': { bold: true, color: 'B91C1C' }, '零单': { color: '64748B' },
};
/* 表头单元格：微软雅黑 10 号加粗白字 + 底色 + 居中（自动换行）+ 细边框 */
const hcell = (t, bg) => C(t, { name: MSYH, bold: true, size: 10, color: 'FFFFFF', bg, align: 'center', wrap: true, bd: true, bdC: BD_C });
/* 数据单元格：默认微软雅黑 10 号居中垂直、右对齐不换行、细边框 */
const dcell = (v, o) => C(v, Object.assign({ name: MSYH, size: 10, align: 'right', wrap: false, bd: true, bdC: BD_C }, o || {}));

/* 工作表 1 · 骑手账单测算 */
function sheetRiders(riders, meta) {
  const heads = ['排名','骑手姓名','站点','基础薪资方案名称ID','盈亏','总单量','非一口价','一口价','最终金额','薪资合计','预支','骑手单均','CN 单价','CN 使用率','每单毛利','月度毛利','保本CN','需压降单均'];
  const widths = [6,11,24,34,8,10,11,10,12,12,11,11,10,11,11,13,11,13];
  const rows = [heads.map(h => hcell(h, BFILL))];
  (riders || []).forEach((x, k) => {
    const avg = +x.avg || 0, cnv = +x.cn || 0;
    const needCn = pround(avg, 4);
    const cut = avg > cnv ? pround(avg - cnv, 4) : 0;
    const vals = [k + 1, x.name, x.station, x.scheme || '', x.pnl || '', x.orders, x.ordersN, x.ordersF,
                  x.payFinal, x.paySettle, x.advance, avg, cnv, x.use, x.margin, x.monthMargin, needCn, cut];
    rows.push(vals.map((v, i0) => {
      const j = i0 + 1;
      const o = (j === 4) ? { align: 'left', wrap: true }
              : (j <= 5) ? { align: 'center', wrap: true } : {};
      o.nf = (j === 4) ? '@' : (j === 14) ? '0.00%'
           : ([12,13,15,17,18].indexOf(j) >= 0) ? '0.00'
           : ([9,10,11,16].indexOf(j) >= 0) ? '#,##0.00' : '#,##0';
      if (j === 12) o.bold = true;
      if (j === 5 && PNL_FILL[x.pnl]) Object.assign(o, { bg: PNL_FILL[x.pnl] }, PNL_FONT[x.pnl] || {});
      return dcell(v, o);
    }));
  });
  const tot = new Array(18).fill(null);
  tot[1] = '合计';
  [[5, meta.orders], [8, meta.payFinal], [9, meta.paySettle], [10, meta.advance], [11, meta.avg],
   [13, meta.use], [14, meta.margin], [15, meta.monthMargin]].forEach(p => { tot[p[0] - 1] = p[1]; });
  rows.push(tot.map((v, i0) => {
    const j = i0 + 1;
    const nf = (j === 14) ? '0.00%' : ([12,13,15,17,18].indexOf(j) >= 0 ? '0.00' : '#,##0.00');
    return C(v === null ? undefined : v, { name: MSYH, size: 11, bold: true, bg: SFILL, align: 'right', wrap: false, nf, bd: true, bdC: BD_C });
  }));
  return mkSheet({ rows, cols: widths });
}

/* 工作表 2 · 薪资方案汇总 */
function sheetSchemes(schemes) {
  const heads = ['基础薪资方案','骑手人数','有单人数','总单量','最终金额','骑手单均','盈亏','赚钱','打平','亏损','零单','每单毛利','月度毛利','保本CN','怎么调整才能赚钱'];
  const widths = [38,9,10,11,13,11,8,7,7,7,7,11,13,11,44];
  const rows = [heads.map(h => hcell(h, HFILL))];
  (schemes || []).forEach(d => {
    const avg = +d.avg || 0, mg = +d.margin || 0;
    const pnl = d.pnl || (mg > 0.05 ? '赚钱' : (mg < -0.05 ? '亏损' : '打平'));
    const action = mg >= -0.05 ? '已达标' : `CN 提到 ${avg.toFixed(2)} 或单均压降 ${Math.abs(mg).toFixed(2)}`;
    const vals = [d.name, d.riders, d.active, d.orders, d.payFinal, avg, pnl,
                  d.win, d.flat, d.lose, d.zero, mg, d.monthMargin, avg, action];
    rows.push(vals.map((v, i0) => {
      const j = i0 + 1;
      const o = (j === 1 || j === 15) ? { align: 'left', wrap: true }
              : (j >= 7 && j <= 11) ? { align: 'center', wrap: true } : {};
      o.nf = (j === 1) ? '@' : ([5, 13].indexOf(j) >= 0 ? '#,##0.00'
           : ([6, 12, 14].indexOf(j) >= 0 ? '0.00' : '#,##0'));
      if (j === 7 && PNL_FILL[pnl]) Object.assign(o, { bg: PNL_FILL[pnl] }, PNL_FONT[pnl] || {});
      if (j === 13) Object.assign(o, { bold: true, color: mg >= -0.05 ? '15803D' : 'B91C1C' });
      return dcell(v, o);
    }));
  });
  return mkSheet({ rows, cols: widths });
}

/* 工作表 3 · 亏损排行（最多 50 名，月度毛利从亏到多排序） */
function sheetLose(riders) {
  const heads = ['排名','骑手姓名','站点','总单量','骑手单均','CN 单价','每单毛利','月度毛利','保本CN','需压降单均','压降比例'];
  const widths = [6,11,24,10,11,10,11,13,11,13,11];
  const rows = [heads.map(h => hcell(h, HFILL))];
  const los = (riders || []).filter(x => x.pnl === '亏损')
    .sort((a, b) => (+a.monthMargin || 0) - (+b.monthMargin || 0)).slice(0, 50);
  los.forEach((x, k) => {
    const avg = +x.avg || 0, cnv = +x.cn || 0, cut = avg - cnv;
    const vals = [k + 1, x.name, x.station, x.orders, avg, cnv, x.margin, x.monthMargin,
                  avg, pround(cut, 4), avg ? cut / avg : 0];
    rows.push(vals.map((v, i0) => {
      const j = i0 + 1;
      const o = (j <= 3) ? { align: 'center', wrap: true } : {};
      o.nf = (j === 11) ? '0.0%' : ([5,6,7,9,10].indexOf(j) >= 0 ? '0.00'
           : (j === 8 ? '#,##0.00' : '#,##0'));
      return dcell(v, o);
    }));
  });
  if (!los.length) {
    rows.push([C('当前 CN 下没有亏损骑手', { name: MSYH, size: 11, bold: true, color: '15803D', align: 'left' })]);
  }
  return mkSheet({ rows, cols: widths });
}

/* 工作表 4 · 站点汇总 */
function sheetStations(stations, meta) {
  const heads = ['站点','骑手人数','有单人数','总单量','最终金额','薪资合计','预支','骑手单均','CN 单价','CN 使用率','每单毛利','月度毛利','保本CN','怎么调整才能赚钱'];
  const widths = [26,9,10,11,13,12,10,11,10,11,11,13,11,44];
  const rows = [heads.map(h => hcell(h, BFILL))];
  (stations || []).forEach(d => {
    const avg = +d.avg || 0, cnv = +d.cn || 0;
    const needCn = pround(avg, 4);
    const action = avg <= cnv ? '已达标' : `CN 提到 ${needCn.toFixed(2)} 或单均压降 ${(avg - cnv).toFixed(2)}`;
    const vals = [d.name, d.riders, d.active, d.orders, d.payFinal, d.paySettle, d.advance,
                  avg, cnv, d.use, d.margin, d.monthMargin, needCn, action];
    rows.push(vals.map((v, i0) => {
      const j = i0 + 1;
      const o = (j === 1 || j === 14) ? { align: 'left', wrap: true } : {};
      o.nf = (j === 1) ? '@' : (j === 10) ? '0.00%'
           : ([8,9,11,13].indexOf(j) >= 0 ? '0.00'
           : ([5,6,7,12].indexOf(j) >= 0 ? '#,##0.00' : '#,##0'));
      return dcell(v, o);
    }));
  });
  const tot = new Array(14).fill(null);
  tot[1] = '合计';
  [[5, meta.payFinal], [8, meta.avg], [10, meta.use], [11, meta.margin],
   [12, meta.monthMargin], [13, meta.avg]].forEach(p => { tot[p[0] - 1] = p[1]; });
  rows.push(tot.map((v, i0) => {
    const j = i0 + 1;
    const nf = (j === 3) ? '0.0%' : ([8,9,11,13].indexOf(j) >= 0 ? '0.00'
             : ([5,6,7,12].indexOf(j) >= 0 ? '#,##0.00' : '#,##0'));
    return C(v === null ? undefined : v, { name: MSYH, size: 11, bold: true, bg: SFILL, align: 'right', wrap: false, nf, bd: true, bdC: BD_C });
  }));
  return mkSheet({ rows, cols: widths });
}

/* 工作表 5 · 调整测算 */
function sheetAdjust(meta, stations, cnAll) {
  const heads = ['调整测算', '数值'];
  const widths = [30, 20];
  const s0 = (stations || [])[0] || {};
  const totO = meta.orders || 0, cnt = (stations || []).length;
  const avgAll = +meta.avg || 0, cnMain = cnAll || 0;
  const marginAll = cnMain - avgAll;
  const loseAmt = ((meta.pnlSummary || {}).loseAmount) || 0;
  const cutNeed = (loseAmt > 0 && totO > 0) ? pround(loseAmt / totO, 4) : 0;
  const newMargin = pround(marginAll + cutNeed, 4);
  const newMm = pround(newMargin * totO, 2);
  const same = cnMain > 0 ? pround(newMargin / cnMain, 4) : 0;
  const mmAll = pround(marginAll * totO, 2);
  const cnAvg = pround((avgAll + cnMain) / 2, 4);
  const mark = cnMain > 0 ? (((avgAll - cnMain) / cnMain) * 100).toFixed(2) + '%' : '—';

  const rows = [heads.map(h => hcell(h, HFILL))];
  const push = (a, b) => {
    if (!a) { rows.push([]); return; }
    const ca = (a.indexOf('—') === 0)
      ? C(a, { name: MSYH, bold: true, size: 11, color: 'FFFFFF', bg: HFILL, wrap: false })
      : C(a, { name: MSYH, size: 10, wrap: false });
    const cb = C(b === '' || b === undefined ? undefined : b,
      (typeof b === 'number' && !Number.isInteger(b))
        ? { name: MSYH, size: 10, wrap: false, nf: '#,##0.00' }
        : { name: MSYH, size: 10, wrap: false });
    rows.push([ca, cb]);
  };
  push('— 全站 —', 1);
  push('总单量', totO);
  push('最终金额合计', meta.payFinal);
  push('筛选后平均单均', avgAll);
  push('当前 CN', cnAll);
  push('', '');
  push('— 亏损与压降 —', 1);
  push('亏损金额合计（月度）', loseAmt);
  push('每单需要压降的金额', cutNeed);
  push('降后每单毛利', newMargin);
  push('降后月度毛利', newMm);
  push('降后 CN 使用率', same);
  push('需要多少单量 / +0 元', 0);
  push('', '');
  push('— 参考值 —', 1);
  push('亏损最多的站点', s0.name || '—');
  push('该站点单均', s0.avg);
  push('该站点 CN', s0.cn);
  push('该站点 CN 使用率', ((s0.cn > 0) ? (s0.avg / s0.cn) : 0));
  push('站点数', cnt);
  push('CN 与骑手单均的中间值（参考）', cnAvg);
  push('骑手单均 − CN', marginAll);
  push('单均超出 CN 的比例', mark);
  push('月度毛利（全部筛选骑手）', mmAll);
  push('方案数', 0);
  push('', '');
  push('— 全部站点平均 —', 1);
  push('平均单均', avgAll);
  push('平均 CN', cnMain);
  push('平均每单毛利', pround(marginAll, 4));
  return mkSheet({ rows, cols: widths });
}

$('billExport').addEventListener('click', () => {
  if (!BILL) { toast('请先导入账单', 'err'); return; }
  const PNL_TXT = { win: '赚钱', flat: '打平', lose: '亏损', zero: '零单' };
  const list = currentList().map(x => ({
    name: x.name, station: x.station, scheme: schemeOf(x),
    orders: x.orders, ordersN: x.ordersN, ordersF: x.ordersF,
    payFinal: x.payFinal, paySettle: x.paySettle, advance: Math.abs(x.advance || 0),
    avg: +x.c.avg.toFixed(4), cn: x.c.cn, pnl: PNL_TXT[x.c.pnl],
    use: +x.c.use.toFixed(6), margin: +x.c.margin.toFixed(4), monthMargin: +x.c.mm.toFixed(2),
  }));
  /* 薪资方案汇总（全量，不随筛选变化） */
  const schemes = schemeRows().map(r => ({
    name: r.s.name, riders: r.s.riders, active: r.s.active, orders: r.s.orders,
    payFinal: +r.s.payFinal.toFixed(2), avg: +r.agg.avg.toFixed(4),
    pnl: PNL_TXT[r.pnl], margin: +r.agg.margin.toFixed(4), monthMargin: +r.agg.mm.toFixed(2),
    breakEven: +r.agg.avg.toFixed(4),
    win: r.p.win.n, flat: r.p.flat.n, lose: r.p.lose.n, zero: r.p.zero.n,
  }));
  const stat = pnlStat(BILL.riders);
  const pnlSummary = {
    win: stat.win.n, flat: stat.flat.n, lose: stat.lose.n, zero: stat.zero.n,
    loseAmount: +stat.lose.mm.toFixed(2), flatTol: FLAT_TOL,
  };
  const agg = combine(BILL.riders);
  const stations = BILL.stations.map(s => {
    const cn = cnOf(s.name), avg = s.orders > 0 ? s.payFinal / s.orders : 0;
    return { name: s.name, riders: s.riders, active: s.active, orders: s.orders,
             payFinal: s.payFinal, paySettle: s.paySettle, advance: Math.abs(s.advance || 0),
             avg: +avg.toFixed(4), cn, use: cn > 0 ? +(avg / cn).toFixed(6) : 0, margin: +(cn - avg).toFixed(4) };
  });
  const meta = {
    period: BILL.period, orders: agg.orders, payFinal: agg.payFinal, paySettle: agg.paySettle,
    advance: Math.abs(agg.advance), avg: +agg.avg.toFixed(4), use: +agg.use.toFixed(6),
    margin: +agg.margin.toFixed(4), monthMargin: +agg.mm.toFixed(2), pnlSummary,
    schemeFilter: curScheme() || '（全部）', stationFilter: $('billStationFilter').value || '（全部）',
  };
  setStatus('正在导出…');
  try {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetRiders(list, meta), '骑手账单测算');
    if (schemes.length) XLSX.utils.book_append_sheet(wb, sheetSchemes(schemes), '薪资方案汇总');
    XLSX.utils.book_append_sheet(wb, sheetLose(list), '亏损排行');
    XLSX.utils.book_append_sheet(wb, sheetStations(stations, meta), '站点汇总');
    XLSX.utils.book_append_sheet(wb, sheetAdjust(meta, stations, agg.cn), '调整测算');
    const fn = downloadWb(wb, `账单测算_${BILL.period}_${stampFile()}.xlsx`);
    setStatus('已导出');
    toast('已导出 Excel', 'ok');
    dialog('导出成功', `已生成：<br><span style="font-family:ui-monospace;font-size:12px;color:#2563EB;word-break:break-all">${fn}</span><br><span style="color:#64748B">文件已保存到浏览器下载目录。</span>`,
      [{ label: '关闭' }]);
  } catch (e) { setStatus('导出失败'); toast('导出失败：' + e.message, 'err'); }
});
