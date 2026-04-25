const START_PRICE = 68240;
const MAX_CANDLES = 72;
const INITIAL_BALANCE = 10000;
const MAINTENANCE_RATE = 0.006;

const state = {
  candles: createCandles(),
  isRunning: true,
  shockMode: false,
  orderType: "market",
  side: "long",
  leverage: 10,
  margin: 500,
  limitPrice: START_PRICE,
  balance: INITIAL_BALANCE,
  position: null,
  logs: [
    {
      time: new Date().toLocaleTimeString(),
      message: "模拟行情 socket 已连接，等待下单。",
      tone: "info",
    },
  ],
  timer: null,
};

const dom = {
  markPrice: document.querySelector("#markPrice"),
  priceChange: document.querySelector("#priceChange"),
  fundingRate: document.querySelector("#fundingRate"),
  equity: document.querySelector("#equity"),
  runToggle: document.querySelector("#runToggle"),
  shockToggle: document.querySelector("#shockToggle"),
  resetButton: document.querySelector("#resetButton"),
  canvas: document.querySelector("#klineCanvas"),
  asks: document.querySelector("#asks"),
  bids: document.querySelector("#bids"),
  bookMarkPrice: document.querySelector("#bookMarkPrice"),
  orderTypeGroup: document.querySelector("#orderTypeGroup"),
  sideGroup: document.querySelector("#sideGroup"),
  limitField: document.querySelector("#limitField"),
  limitPriceInput: document.querySelector("#limitPriceInput"),
  marginInput: document.querySelector("#marginInput"),
  leverageInput: document.querySelector("#leverageInput"),
  leverageLabel: document.querySelector("#leverageLabel"),
  balanceText: document.querySelector("#balanceText"),
  notionalText: document.querySelector("#notionalText"),
  openButton: document.querySelector("#openButton"),
  closeButton: document.querySelector("#closeButton"),
  positionContent: document.querySelector("#positionContent"),
  logs: document.querySelector("#logs"),
};

function formatUsd(value, digits = 2) {
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function createCandles() {
  const candles = [];
  let price = START_PRICE;

  for (let i = 0; i < MAX_CANDLES; i += 1) {
    const open = price;
    const drift = (Math.random() - 0.48) * 280;
    const close = Math.max(60000, open + drift);
    const high = Math.max(open, close) + Math.random() * 180;
    const low = Math.min(open, close) - Math.random() * 180;
    candles.push({
      time: Date.now() - (MAX_CANDLES - i) * 60000,
      open,
      high,
      low,
      close,
      volume: 40 + Math.random() * 180,
    });
    price = close;
  }

  return candles;
}

function createOrderBook(price) {
  const asks = [];
  const bids = [];
  let askTotal = 0;
  let bidTotal = 0;

  for (let i = 0; i < 18; i += 1) {
    const askAmount = 0.15 + Math.random() * (2.8 + i * 0.04);
    const bidAmount = 0.15 + Math.random() * (2.8 + i * 0.04);
    askTotal += askAmount;
    bidTotal += bidAmount;

    asks.push({
      price: price + (i + 1) * (8 + Math.random() * 9),
      amount: askAmount,
      total: askTotal,
    });
    bids.push({
      price: price - (i + 1) * (8 + Math.random() * 9),
      amount: bidAmount,
      total: bidTotal,
    });
  }

  return {
    asks: asks.sort((a, b) => b.price - a.price),
    bids: bids.sort((a, b) => b.price - a.price),
  };
}

function latestPrice() {
  return state.candles[state.candles.length - 1].close;
}

function previousPrice() {
  return state.candles[state.candles.length - 2]?.close ?? latestPrice();
}

function calcFundingRate(markPrice, change) {
  const bias = Math.sin(markPrice / 900) * 0.018 + change / 100000;
  return Math.max(-0.045, Math.min(0.045, bias));
}

function calcLiquidationPrice(side, entryPrice, leverage) {
  const move = 1 / leverage - MAINTENANCE_RATE;
  return side === "long"
    ? entryPrice * (1 - move)
    : entryPrice * (1 + move);
}

function calcPnl(position, markPrice) {
  const direction = position.side === "long" ? 1 : -1;
  return (markPrice - position.entryPrice) * position.size * direction;
}

function addLog(message, tone = "info") {
  state.logs = [
    { time: new Date().toLocaleTimeString(), message, tone },
    ...state.logs,
  ].slice(0, 8);
  renderLogs();
}

function tick() {
  const last = state.candles[state.candles.length - 1];
  const volatility = state.shockMode ? 950 : 150;
  const directionBias = state.shockMode ? -0.56 : -0.48;
  const delta = (Math.random() + directionBias) * volatility;
  const close = Math.max(52000, last.close + delta);
  const high = Math.max(last.close, close) + Math.random() * volatility * 0.18;
  const low = Math.min(last.close, close) - Math.random() * volatility * 0.18;

  state.candles = [
    ...state.candles.slice(-(MAX_CANDLES - 1)),
    {
      time: Date.now(),
      open: last.close,
      high,
      low,
      close,
      volume: 60 + Math.random() * (state.shockMode ? 520 : 160),
    },
  ];

  checkLiquidation();
  render();
}

function scheduleSocket() {
  window.clearInterval(state.timer);
  if (!state.isRunning) return;
  state.timer = window.setInterval(tick, state.shockMode ? 650 : 1000);
}

function checkLiquidation() {
  if (!state.position) return;
  const markPrice = latestPrice();
  const shouldLiquidate =
    state.position.side === "long"
      ? markPrice <= state.position.liquidationPrice
      : markPrice >= state.position.liquidationPrice;

  if (!shouldLiquidate) return;

  const pnl = calcPnl(state.position, markPrice);
  state.balance = Math.max(0, state.balance + state.position.margin + pnl);
  addLog(
    `触发强平：${state.position.side === "long" ? "多单" : "空单"}在 ${formatUsd(markPrice)} 被系统平仓。`,
    "danger",
  );
  state.position = null;
  state.shockMode = false;
  scheduleSocket();
}

function openPosition() {
  if (state.position) {
    addLog("已有仓位，请先平仓再开新仓。", "danger");
    return;
  }

  if (state.margin > state.balance) {
    addLog("保证金超过可用余额，无法开仓。", "danger");
    return;
  }

  const markPrice = latestPrice();
  const entryPrice =
    state.orderType === "market"
      ? markPrice
      : state.side === "long"
        ? Math.min(state.limitPrice, markPrice)
        : Math.max(state.limitPrice, markPrice);
  const notional = state.margin * state.leverage;
  const size = notional / entryPrice;

  state.position = {
    side: state.side,
    entryPrice,
    size,
    margin: state.margin,
    leverage: state.leverage,
    liquidationPrice: calcLiquidationPrice(state.side, entryPrice, state.leverage),
  };

  state.balance -= state.margin;
  addLog(
    `${state.side === "long" ? "开多" : "开空"} ${formatUsd(size, 4)} BTC，入场价 ${formatUsd(entryPrice)}，${state.leverage}x。`,
    "success",
  );
  render();
}

function closePosition() {
  if (!state.position) return;
  const pnl = calcPnl(state.position, latestPrice());
  state.balance = Math.max(0, state.balance + state.position.margin + pnl);
  addLog(
    `手动平仓，${pnl >= 0 ? "盈利" : "亏损"} ${formatUsd(Math.abs(pnl))} USDT。`,
    pnl >= 0 ? "success" : "danger",
  );
  state.position = null;
  render();
}

function resetDemo() {
  state.candles = createCandles();
  state.balance = INITIAL_BALANCE;
  state.position = null;
  state.shockMode = false;
  state.margin = 500;
  state.leverage = 10;
  state.orderType = "market";
  state.side = "long";
  state.limitPrice = latestPrice();
  addLog("账户和行情已重置。", "info");
  scheduleSocket();
  render();
}

function drawKline() {
  const canvas = dom.canvas;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const padding = { top: 20, right: 62, bottom: 34, left: 14 };
  const chartWidth = rect.width - padding.left - padding.right;
  const chartHeight = rect.height - padding.top - padding.bottom;
  const maxPrice = Math.max(...state.candles.map((item) => item.high));
  const minPrice = Math.min(...state.candles.map((item) => item.low));
  const range = maxPrice - minPrice || 1;
  const candleWidth = chartWidth / state.candles.length;
  const y = (price) => padding.top + ((maxPrice - price) / range) * chartHeight;

  ctx.fillStyle = "#0c111d";
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.strokeStyle = "#1d2638";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const lineY = padding.top + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, lineY);
    ctx.lineTo(rect.width - padding.right, lineY);
    ctx.stroke();

    const price = maxPrice - (range / 4) * i;
    ctx.fillStyle = "#71809b";
    ctx.font = "11px Inter, system-ui";
    ctx.fillText(formatUsd(price, 0), rect.width - padding.right + 12, lineY + 4);
  }

  state.candles.forEach((candle, index) => {
    const x = padding.left + index * candleWidth + candleWidth / 2;
    const isUp = candle.close >= candle.open;
    const color = isUp ? "#16c784" : "#ef5350";
    const openY = y(candle.open);
    const closeY = y(candle.close);
    const highY = y(candle.high);
    const lowY = y(candle.low);
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(2, Math.abs(openY - closeY));

    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.fillRect(
      x - Math.max(2, candleWidth * 0.3),
      bodyTop,
      Math.max(3, candleWidth * 0.6),
      bodyHeight,
    );
  });

  const latest = latestPrice();
  const latestY = y(latest);
  ctx.strokeStyle = "#f5c542";
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(padding.left, latestY);
  ctx.lineTo(rect.width - padding.right, latestY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#f5c542";
  ctx.fillText(formatUsd(latest), rect.width - padding.right + 12, latestY + 4);
}

function renderBook() {
  const book = createOrderBook(latestPrice());
  const maxTotal = Math.max(
    ...book.asks.map((item) => item.total),
    ...book.bids.map((item) => item.total),
  );
  dom.asks.innerHTML = book.asks.slice(0, 9).map((level) => bookRow(level, maxTotal, "ask")).join("");
  dom.bids.innerHTML = book.bids.slice(0, 9).map((level) => bookRow(level, maxTotal, "bid")).join("");
}

function bookRow(level, maxTotal, side) {
  return `
    <div class="book-row">
      <div class="depth ${side}" style="width:${Math.min(100, (level.total / maxTotal) * 100)}%"></div>
      <span class="${side === "ask" ? "text-down" : "text-up"}">${formatUsd(level.price, 1)}</span>
      <span>${formatUsd(level.amount, 3)}</span>
      <span>${formatUsd(level.total, 3)}</span>
    </div>
  `;
}

function renderPosition() {
  const position = state.position;
  if (!position) {
    dom.positionContent.className = "empty-state";
    dom.positionContent.innerHTML = "暂无仓位，开仓后这里会展示强平价和实时盈亏。";
    dom.closeButton.disabled = true;
    dom.openButton.disabled = false;
    return;
  }

  const markPrice = latestPrice();
  const pnl = calcPnl(position, markPrice);
  const marginRatio = Math.max(0, ((position.margin + pnl) / position.margin) * 100);
  dom.closeButton.disabled = false;
  dom.openButton.disabled = true;
  dom.positionContent.className = "position-grid";
  dom.positionContent.innerHTML = `
    ${info("方向", position.side === "long" ? "多单" : "空单", position.side === "long" ? "up" : "down")}
    ${info("入场价", `$${formatUsd(position.entryPrice)}`)}
    ${info("标记价", `$${formatUsd(markPrice)}`)}
    ${info("强平价", `$${formatUsd(position.liquidationPrice)}`, "danger")}
    ${info("保证金", `${formatUsd(position.margin)} USDT`)}
    ${info("杠杆", `${position.leverage}x`)}
    ${info("仓位数量", `${formatUsd(position.size, 4)} BTC`)}
    ${info("未实现盈亏", `${pnl >= 0 ? "+" : "-"}${formatUsd(Math.abs(pnl))} USDT`, pnl >= 0 ? "up" : "down")}
    <div class="risk-meter">
      <div>保证金率</div>
      <strong>${formatUsd(marginRatio, 1)}%</strong>
      <span style="width:${Math.min(100, marginRatio)}%"></span>
    </div>
  `;
}

function info(label, value, tone = "") {
  return `
    <div class="info">
      <span>${label}</span>
      <strong class="${tone ? `text-${tone}` : ""}">${value}</strong>
    </div>
  `;
}

function renderLogs() {
  dom.logs.innerHTML = state.logs.map((log) => `
    <div class="log ${log.tone}">
      <span>${log.time}</span>
      <p>${log.message}</p>
    </div>
  `).join("");
}

function renderControls() {
  dom.runToggle.textContent = state.isRunning ? "暂停" : "播放";
  dom.shockToggle.classList.toggle("danger", state.shockMode);
  dom.limitField.classList.toggle("hidden", state.orderType !== "limit");
  dom.leverageLabel.textContent = `杠杆 ${state.leverage}x`;
  dom.marginInput.value = state.margin;
  dom.leverageInput.value = state.leverage;
  dom.limitPriceInput.value = state.limitPrice.toFixed(1);
  dom.balanceText.textContent = `${formatUsd(state.balance)} USDT`;
  dom.notionalText.textContent = `${formatUsd(state.margin * state.leverage)} USDT`;
  dom.openButton.className = `submit ${state.side}`;
  dom.openButton.textContent = state.side === "long" ? "开多 BTC" : "开空 BTC";

  dom.orderTypeGroup.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.orderType === state.orderType);
  });
  dom.sideGroup.querySelectorAll("button").forEach((button) => {
    const active = button.dataset.side === state.side;
    button.classList.toggle("active", active);
    button.classList.toggle("long", active && state.side === "long");
    button.classList.toggle("short", active && state.side === "short");
  });
}

function render() {
  const markPrice = latestPrice();
  const change = markPrice - previousPrice();
  const fundingRate = calcFundingRate(markPrice, change);
  const pnl = state.position ? calcPnl(state.position, markPrice) : 0;

  dom.markPrice.textContent = `$${formatUsd(markPrice)}`;
  dom.markPrice.className = change >= 0 ? "text-up" : "text-down";
  dom.bookMarkPrice.textContent = formatUsd(markPrice);
  dom.priceChange.textContent = `${change >= 0 ? "+" : ""}${formatUsd(change)}`;
  dom.priceChange.className = change >= 0 ? "text-up" : "text-down";
  dom.fundingRate.textContent = `${fundingRate >= 0 ? "+" : ""}${fundingRate.toFixed(4)}%`;
  dom.fundingRate.className = fundingRate >= 0 ? "text-up" : "text-down";
  dom.equity.textContent = `${formatUsd(state.balance + pnl)} USDT`;

  drawKline();
  renderBook();
  renderPosition();
  renderControls();
  renderLogs();
}

dom.runToggle.addEventListener("click", () => {
  state.isRunning = !state.isRunning;
  scheduleSocket();
  renderControls();
});

dom.shockToggle.addEventListener("click", () => {
  state.shockMode = !state.shockMode;
  addLog(state.shockMode ? "暴跌模拟已开启，行情波动加速。" : "暴跌模拟已关闭。", "info");
  scheduleSocket();
  renderControls();
});

dom.resetButton.addEventListener("click", resetDemo);

dom.orderTypeGroup.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-order-type]");
  if (!button) return;
  state.orderType = button.dataset.orderType;
  renderControls();
});

dom.sideGroup.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-side]");
  if (!button) return;
  state.side = button.dataset.side;
  renderControls();
});

dom.marginInput.addEventListener("input", (event) => {
  state.margin = Number(event.target.value) || 0;
  renderControls();
});

dom.leverageInput.addEventListener("input", (event) => {
  state.leverage = Number(event.target.value) || 1;
  renderControls();
});

dom.limitPriceInput.addEventListener("input", (event) => {
  state.limitPrice = Number(event.target.value) || latestPrice();
});

dom.openButton.addEventListener("click", openPosition);
dom.closeButton.addEventListener("click", closePosition);
window.addEventListener("resize", drawKline);

state.limitPrice = latestPrice();
scheduleSocket();
render();
