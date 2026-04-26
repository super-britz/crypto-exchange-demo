import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
} from "lightweight-charts";

const START_PRICE = 68240;
const MAX_CANDLES = 72;
const INITIAL_BALANCE = 10000;
const MAINTENANCE_RATE = 0.006;
const TAKER_FEE_RATE = 0.0004;
const MAKER_FEE_RATE = 0.0002;
const FUNDING_SETTLEMENT_MS = 15000;
const SYMBOL = "BTCUSDT";
const STREAM_SYMBOL = "btcusdt";
const DEFAULT_INTERVAL = "1m";
const INTERVAL_MS = {
  "1m": 60000,
  "5m": 5 * 60000,
  "15m": 15 * 60000,
  "1h": 60 * 60000,
};
const BINANCE_REST_BASE = "https://data-api.binance.vision";
const UP_COLOR = "#16c784";
const DOWN_COLOR = "#ef5350";

let chartApi;
let candleSeries;
let volumeSeries;
let liquidationPriceLine;
let marketSocket;
let reconnectTimer;
let localStressTimer;
let fundingTimer;
let reconnectAttempts = 0;
let wsEndpointIndex = 0;
let marketFrameId = 0;
let chartReady = false;

const state = {
  candles: createCandles(DEFAULT_INTERVAL),
  interval: DEFAULT_INTERVAL,
  isRunning: true,
  shockMode: false,
  fallbackMode: false,
  orderType: "market",
  side: "long",
  leverage: 10,
  margin: 500,
  limitPrice: START_PRICE,
  balance: INITIAL_BALANCE,
  position: null,
  pendingOrders: [],
  tradeHistory: [],
  orderBook: createOrderBook(START_PRICE),
  streamStatus: "connecting",
  usingRealMarket: false,
  logs: [
    {
      time: new Date().toLocaleTimeString(),
      message: "模拟行情 socket 已连接，等待下单。",
      tone: "info",
    },
  ],
};

const dom = {
  markPrice: document.querySelector("#markPrice"),
  priceChange: document.querySelector("#priceChange"),
  fundingRate: document.querySelector("#fundingRate"),
  equity: document.querySelector("#equity"),
  runToggle: document.querySelector("#runToggle"),
  shockToggle: document.querySelector("#shockToggle"),
  resetButton: document.querySelector("#resetButton"),
  streamStatus: document.querySelector("#streamStatus"),
  intervalTabs: document.querySelector("#intervalTabs"),
  chart: document.querySelector("#klineChart"),
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
  pendingCount: document.querySelector("#pendingCount"),
  pendingOrders: document.querySelector("#pendingOrders"),
  positionContent: document.querySelector("#positionContent"),
  tradeCount: document.querySelector("#tradeCount"),
  tradeHistory: document.querySelector("#tradeHistory"),
  logs: document.querySelector("#logs"),
};

function formatUsd(value, digits = 2) {
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function createCandles(interval = DEFAULT_INTERVAL) {
  const candles = [];
  let price = START_PRICE;
  const intervalMs = INTERVAL_MS[interval] ?? INTERVAL_MS[DEFAULT_INTERVAL];

  for (let i = 0; i < MAX_CANDLES; i += 1) {
    const open = price;
    const drift = (Math.random() - 0.48) * 280;
    const close = Math.max(60000, open + drift);
    const high = Math.max(open, close) + Math.random() * 180;
    const low = Math.min(open, close) - Math.random() * 180;
    candles.push({
      time: Date.now() - (MAX_CANDLES - i) * intervalMs,
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

function getStreamPath() {
  return `${STREAM_SYMBOL}@kline_${state.interval}/${STREAM_SYMBOL}@depth20@100ms`;
}

function getBinanceWsUrls() {
  const streamPath = getStreamPath();
  return [
    `wss://data-stream.binance.vision/stream?streams=${streamPath}`,
    `wss://stream.binance.com:9443/stream?streams=${streamPath}`,
  ];
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

function normalizeDepth(side) {
  let total = 0;
  return side.map(([price, amount]) => {
    const nextAmount = Number(amount);
    total += nextAmount;
    return {
      price: Number(price),
      amount: nextAmount,
      total,
    };
  });
}

function mapBinanceKline(item) {
  return {
    time: Number(item[0]),
    open: Number(item[1]),
    high: Number(item[2]),
    low: Number(item[3]),
    close: Number(item[4]),
    volume: Number(item[5]),
  };
}

function mapStreamKline(kline) {
  return {
    time: Number(kline.t),
    open: Number(kline.o),
    high: Number(kline.h),
    low: Number(kline.l),
    close: Number(kline.c),
    volume: Number(kline.v),
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

function calcNotional(size, price) {
  return size * price;
}

function calcTradingFee(notional, orderType) {
  const rate = orderType === "limit" ? MAKER_FEE_RATE : TAKER_FEE_RATE;
  return notional * rate;
}

function addLog(message, tone = "info") {
  state.logs = [
    { time: new Date().toLocaleTimeString(), message, tone },
    ...state.logs,
  ].slice(0, 8);
  renderLogs();
}

function addTrade(record) {
  state.tradeHistory = [
    {
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString(),
      ...record,
    },
    ...state.tradeHistory,
  ].slice(0, 12);
  renderTradeHistory();
}

function requestMarketRender() {
  if (marketFrameId) return;
  marketFrameId = window.requestAnimationFrame(() => {
    marketFrameId = 0;
    renderMarketFrame();
  });
}

function startFundingSettlement() {
  window.clearInterval(fundingTimer);
  fundingTimer = window.setInterval(settleFundingFee, FUNDING_SETTLEMENT_MS);
}

function stopFundingSettlement() {
  window.clearInterval(fundingTimer);
  fundingTimer = null;
}

function settleFundingFee() {
  if (!state.position || !state.isRunning) return;

  const markPrice = latestPrice();
  const change = markPrice - previousPrice();
  const fundingRate = calcFundingRate(markPrice, change) / 100;
  const notional = calcNotional(state.position.size, markPrice);
  const direction = state.position.side === "long" ? 1 : -1;
  const fundingPayment = notional * fundingRate * direction;

  if (Math.abs(fundingPayment) < 0.01) return;

  state.balance -= fundingPayment;
  state.position.fundingFee += fundingPayment;
  addLog(
    `资金费率结算：${state.position.side === "long" ? "多单" : "空单"}${fundingPayment >= 0 ? "支付" : "收取"} ${formatUsd(Math.abs(fundingPayment))} USDT。`,
    fundingPayment >= 0 ? "danger" : "success",
  );

  if (state.balance < 0) {
    state.balance = 0;
  }

  checkLiquidation();
  renderMarketFrame();
  renderControls();
}

function setStreamStatus(status) {
  state.streamStatus = status;
  const labels = {
    connecting: "Binance 连接中",
    connected: "Binance 实时行情",
    reconnecting: "Binance 重连中",
    offline: "已暂停",
    stress: "本地暴跌模拟",
    error: "连接失败，使用本地模拟",
  };
  dom.streamStatus.textContent = labels[status] ?? status;
  dom.streamStatus.className = `stream-status ${status}`;
}

function toChartTime(time) {
  return Math.floor(time / 1000);
}

function toCandlePoint(candle) {
  return {
    time: toChartTime(candle.time),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}

function toVolumePoint(candle) {
  return {
    time: toChartTime(candle.time),
    value: candle.volume,
    color: candle.close >= candle.open
      ? "rgba(22, 199, 132, 0.38)"
      : "rgba(239, 83, 80, 0.38)",
  };
}

function initChart() {
  const rect = dom.chart.getBoundingClientRect();
  chartApi = createChart(dom.chart, {
    width: Math.max(320, Math.floor(rect.width)),
    height: Math.max(320, Math.floor(rect.height)),
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: "#0c111d" },
      textColor: "#8b98ae",
      fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    },
    grid: {
      vertLines: { color: "#151f31" },
      horzLines: { color: "#1d2638" },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: {
        color: "rgba(245, 197, 66, 0.45)",
        labelBackgroundColor: "#f5c542",
      },
      horzLine: {
        color: "rgba(245, 197, 66, 0.45)",
        labelBackgroundColor: "#f5c542",
      },
    },
    rightPriceScale: {
      borderColor: "#26344a",
      scaleMargins: {
        top: 0.08,
        bottom: 0.24,
      },
    },
    timeScale: {
      borderColor: "#26344a",
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 8,
      barSpacing: 8,
    },
    localization: {
      priceFormatter: (price) => formatUsd(price),
    },
  });

  candleSeries = chartApi.addSeries(CandlestickSeries, {
    upColor: UP_COLOR,
    downColor: DOWN_COLOR,
    borderUpColor: UP_COLOR,
    borderDownColor: DOWN_COLOR,
    wickUpColor: UP_COLOR,
    wickDownColor: DOWN_COLOR,
    priceLineColor: "#f5c542",
    lastValueVisible: true,
    priceLineVisible: true,
  });

  volumeSeries = chartApi.addSeries(HistogramSeries, {
    priceFormat: {
      type: "volume",
    },
    priceScaleId: "",
    lastValueVisible: false,
    priceLineVisible: false,
  });

  volumeSeries.priceScale().applyOptions({
    scaleMargins: {
      top: 0.78,
      bottom: 0,
    },
  });
}

function tick() {
  const last = state.candles[state.candles.length - 1];
  const volatility = state.shockMode ? 950 : 150;
  const directionBias = state.shockMode ? -0.56 : -0.48;
  const delta = (Math.random() + directionBias) * volatility;
  const close = Math.max(52000, last.close + delta);
  const high = Math.max(last.close, close) + Math.random() * volatility * 0.18;
  const low = Math.min(last.close, close) - Math.random() * volatility * 0.18;

  const nextCandle = {
    time: last.time + (INTERVAL_MS[state.interval] ?? INTERVAL_MS[DEFAULT_INTERVAL]),
    open: last.close,
    high,
    low,
    close,
    volume: 60 + Math.random() * (state.shockMode ? 520 : 160),
  };

  state.candles = [
    ...state.candles.slice(-(MAX_CANDLES - 1)),
    nextCandle,
  ];
  state.orderBook = createOrderBook(close);

  checkPendingOrders();
  checkLiquidation();
  updateChartWithCandle(nextCandle);
  requestMarketRender();
}

function startLocalStressStream() {
  stopMarketStream();
  window.clearInterval(localStressTimer);
  setStreamStatus(state.fallbackMode ? "error" : "stress");
  localStressTimer = window.setInterval(tick, state.shockMode ? 650 : 1000);
}

function stopLocalStressStream() {
  window.clearInterval(localStressTimer);
  localStressTimer = null;
}

function stopMarketStream() {
  window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (marketSocket) {
    marketSocket.manualClose = true;
    marketSocket.close();
    marketSocket = null;
  }
}

async function loadInitialCandles(interval = state.interval) {
  try {
    const response = await fetch(
      `${BINANCE_REST_BASE}/api/v3/klines?symbol=${SYMBOL}&interval=${interval}&limit=${MAX_CANDLES}`,
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    if (interval !== state.interval) return;
    state.candles = data.map(mapBinanceKline);
    state.limitPrice = latestPrice();
    state.orderBook = createOrderBook(latestPrice());
  } catch (error) {
    console.warn("Failed to load Binance historical klines, using fallback data.", error);
    addLog("无法加载 Binance 历史 K 线，暂用本地初始数据。", "danger");
  }
}

function connectMarketStream() {
  if (!state.isRunning || state.shockMode) return;
  stopLocalStressStream();
  stopMarketStream();
  state.fallbackMode = false;
  setStreamStatus(reconnectAttempts > 0 ? "reconnecting" : "connecting");

  marketSocket = new WebSocket(getBinanceWsUrls()[wsEndpointIndex]);

  marketSocket.addEventListener("open", () => {
    state.usingRealMarket = true;
    reconnectAttempts = 0;
    setStreamStatus("connected");
    addLog("Binance WebSocket 已连接：K线 + depth20 盘口。", "success");
  });

  marketSocket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    const stream = payload.stream;
    const data = payload.data;

    if (stream.endsWith(`@kline_${state.interval}`)) {
      const nextCandle = mapStreamKline(data.k);
      upsertStreamCandle(nextCandle);
      updateChartWithCandle(nextCandle);
    }

    if (stream.endsWith("@depth20@100ms")) {
      state.orderBook = {
        asks: normalizeDepth(data.asks),
        bids: normalizeDepth(data.bids),
      };
    }

    checkPendingOrders();
    checkLiquidation();
    requestMarketRender();
  });

  marketSocket.addEventListener("error", () => {
    setStreamStatus("error");
  });

  marketSocket.addEventListener("close", (event) => {
    if (event.currentTarget.manualClose) return;
    marketSocket = null;
    state.usingRealMarket = false;
    if (!state.isRunning || state.shockMode) return;
    reconnectAttempts += 1;
    wsEndpointIndex = (wsEndpointIndex + 1) % getBinanceWsUrls().length;

    if (reconnectAttempts >= 6) {
      state.fallbackMode = true;
      addLog("Binance WebSocket 暂不可用，已降级为本地模拟行情。", "danger");
      startLocalStressStream();
      renderAll();
      return;
    }

    setStreamStatus("reconnecting");
    reconnectTimer = window.setTimeout(connectMarketStream, 1200 + reconnectAttempts * 600);
  });
}

function upsertStreamCandle(nextCandle) {
  const last = state.candles[state.candles.length - 1];
  state.limitPrice = nextCandle.close;
  if (last && last.time === nextCandle.time) {
    state.candles = [...state.candles.slice(0, -1), nextCandle];
    return;
  }
  state.candles = [...state.candles.slice(-(MAX_CANDLES - 1)), nextCandle];
}

function resumeMarket() {
  if (!state.isRunning) {
    stopMarketStream();
    stopLocalStressStream();
    state.fallbackMode = false;
    setStreamStatus("offline");
    return;
  }

  if (state.shockMode) {
    startLocalStressStream();
    return;
  }

  reconnectAttempts = 0;
  wsEndpointIndex = 0;
  connectMarketStream();
}

async function changeInterval(nextInterval) {
  if (nextInterval === state.interval || !INTERVAL_MS[nextInterval]) return;

  stopMarketStream();
  stopLocalStressStream();
  clearLiquidationPriceLine();
  chartReady = false;
  state.interval = nextInterval;
  state.shockMode = false;
  state.fallbackMode = false;
  state.candles = createCandles(nextInterval);
  state.orderBook = createOrderBook(latestPrice());
  state.limitPrice = latestPrice();
  addLog(`已切换 K 线周期到 ${nextInterval}，重新加载历史 K 线。`, "info");
  setChartData();
  renderControls();
  renderPendingOrders();
  renderMarketFrame();
  await loadInitialCandles(nextInterval);
  renderAll();
  resumeMarket();
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
  const closeNotional = calcNotional(state.position.size, markPrice);
  const closeFee = calcTradingFee(closeNotional, "market");
  const netPnl = pnl - state.position.openFee - closeFee - state.position.fundingFee;
  state.position.closeFee = closeFee;
  state.balance = Math.max(0, state.balance + state.position.margin + pnl - closeFee);
  addTrade({
    action: "liquidation",
    side: state.position.side,
    price: markPrice,
    size: state.position.size,
    fee: state.position.openFee + closeFee,
    fundingFee: state.position.fundingFee,
    realizedPnl: netPnl,
  });
  addLog(
    `触发强平：${state.position.side === "long" ? "多单" : "空单"}在 ${formatUsd(markPrice)} 被系统平仓，强平手续费 ${formatUsd(closeFee)} USDT。`,
    "danger",
  );
  state.position = null;
  state.shockMode = false;
  stopFundingSettlement();
  resumeMarket();
}

function createPositionFromOrder(order, entryPrice, orderType = "market") {
  const notional = order.margin * order.leverage;
  const size = notional / entryPrice;
  const openFee = calcTradingFee(notional, orderType);

  state.position = {
    side: order.side,
    entryPrice,
    size,
    margin: order.margin,
    leverage: order.leverage,
    openFee,
    closeFee: 0,
    fundingFee: 0,
    liquidationPrice: calcLiquidationPrice(order.side, entryPrice, order.leverage),
  };

  state.balance -= openFee;
  addTrade({
    action: "open",
    side: order.side,
    orderType,
    price: entryPrice,
    size,
    fee: openFee,
    realizedPnl: null,
  });
  startFundingSettlement();
  return state.position;
}

function placeLimitOrder() {
  if (state.position) {
    addLog("已有仓位，请先平仓再提交限价单。", "danger");
    return;
  }

  if (state.pendingOrders.length > 0) {
    addLog("已有挂单，请先撤单或等待成交。", "danger");
    return;
  }

  if (state.margin > state.balance) {
    addLog("保证金超过可用余额，无法挂单。", "danger");
    return;
  }

  const order = {
    id: Date.now(),
    side: state.side,
    price: state.limitPrice,
    margin: state.margin,
    leverage: state.leverage,
    createdAt: new Date().toLocaleTimeString(),
  };

  state.balance -= order.margin;
  state.pendingOrders = [order];
  addLog(
    `${order.side === "long" ? "限价开多" : "限价开空"}挂单 ${formatUsd(order.price)}，保证金 ${formatUsd(order.margin)} USDT。`,
    "info",
  );
  renderMarketFrame();
  renderControls();
  renderPendingOrders();
}

function cancelOrder(orderId) {
  const order = state.pendingOrders.find((item) => item.id === orderId);
  if (!order) return;

  state.pendingOrders = state.pendingOrders.filter((item) => item.id !== orderId);
  state.balance += order.margin;
  addLog(`已撤销限价单，释放保证金 ${formatUsd(order.margin)} USDT。`, "info");
  renderMarketFrame();
  renderControls();
  renderPendingOrders();
}

function checkPendingOrders() {
  if (state.position || state.pendingOrders.length === 0) return;

  const markPrice = latestPrice();
  const order = state.pendingOrders[0];
  const shouldFill =
    order.side === "long"
      ? markPrice <= order.price
      : markPrice >= order.price;

  if (!shouldFill) return;

  state.pendingOrders = [];
  const position = createPositionFromOrder(order, order.price, "limit");
  addLog(
    `${order.side === "long" ? "限价开多" : "限价开空"}成交，成交价 ${formatUsd(order.price)}，开仓手续费 ${formatUsd(position.openFee)} USDT。`,
    "success",
  );
  renderPendingOrders();
}

function openPosition() {
  if (state.position) {
    addLog("已有仓位，请先平仓再开新仓。", "danger");
    return;
  }

  if (state.orderType === "limit") {
    placeLimitOrder();
    return;
  }

  if (state.pendingOrders.length > 0) {
    addLog("已有挂单，请先撤单或等待成交。", "danger");
    return;
  }

  if (state.margin > state.balance) {
    addLog("保证金超过可用余额，无法开仓。", "danger");
    return;
  }

  const markPrice = latestPrice();
  const order = {
    side: state.side,
    margin: state.margin,
    leverage: state.leverage,
  };

  state.balance -= state.margin;
  const position = createPositionFromOrder(order, markPrice, "market");
  addLog(
    `${state.side === "long" ? "市价开多" : "市价开空"} ${formatUsd(position.size, 4)} BTC，入场价 ${formatUsd(markPrice)}，开仓手续费 ${formatUsd(position.openFee)} USDT。`,
    "success",
  );
  renderMarketFrame();
  renderControls();
}

function closePosition() {
  if (!state.position) return;
  const markPrice = latestPrice();
  const pnl = calcPnl(state.position, markPrice);
  const closeNotional = calcNotional(state.position.size, markPrice);
  const closeFee = calcTradingFee(closeNotional, "market");
  state.position.closeFee = closeFee;
  const netPnl = pnl - state.position.openFee - closeFee - state.position.fundingFee;
  state.balance = Math.max(0, state.balance + state.position.margin + pnl - closeFee);
  addTrade({
    action: "close",
    side: state.position.side,
    price: markPrice,
    size: state.position.size,
    fee: state.position.openFee + closeFee,
    fundingFee: state.position.fundingFee,
    realizedPnl: netPnl,
  });
  addLog(
    `手动平仓，${pnl >= 0 ? "盈利" : "亏损"} ${formatUsd(Math.abs(pnl))} USDT，平仓手续费 ${formatUsd(closeFee)} USDT。`,
    pnl >= 0 ? "success" : "danger",
  );
  state.position = null;
  stopFundingSettlement();
  renderMarketFrame();
  renderControls();
}

function resetDemo() {
  state.candles = createCandles(state.interval);
  state.balance = INITIAL_BALANCE;
  state.position = null;
  stopFundingSettlement();
  state.pendingOrders = [];
  state.tradeHistory = [];
  state.shockMode = false;
  state.margin = 500;
  state.leverage = 10;
  state.orderType = "market";
  state.side = "long";
  state.limitPrice = latestPrice();
  state.orderBook = createOrderBook(latestPrice());
  addLog("账户和行情已重置。", "info");
  resumeMarket();
  renderAll();
}

function setChartData() {
  candleSeries.setData(state.candles.map(toCandlePoint));
  volumeSeries.setData(state.candles.map(toVolumePoint));
  chartApi.timeScale().scrollToRealTime();
  chartReady = true;
}

function updateChartWithCandle(candle) {
  if (!chartReady) return;
  candleSeries.update(toCandlePoint(candle));
  volumeSeries.update(toVolumePoint(candle));
}

function syncLiquidationPriceLine() {
  if (!chartReady) return;

  if (!state.position) {
    clearLiquidationPriceLine();
    return;
  }

  const price = state.position.liquidationPrice;
  const title = `Liq ${formatUsd(price)}`;

  if (!liquidationPriceLine) {
    liquidationPriceLine = candleSeries.createPriceLine({
      price,
      color: "#f5c542",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      lineVisible: true,
      title,
      axisLabelColor: "#f5c542",
      axisLabelTextColor: "#0c111d",
    });
    return;
  }

  liquidationPriceLine.applyOptions({
    price,
    title,
  });
}

function clearLiquidationPriceLine() {
  if (!liquidationPriceLine) return;
  candleSeries.removePriceLine(liquidationPriceLine);
  liquidationPriceLine = null;
}

function renderBook() {
  const book = state.orderBook;
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
    dom.openButton.disabled = state.pendingOrders.length > 0;
    return;
  }

  const markPrice = latestPrice();
  const pnl = calcPnl(position, markPrice);
  const netPnl = pnl - position.openFee - position.closeFee - position.fundingFee;
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
    ${info("累计手续费", `${formatUsd(position.openFee + position.closeFee)} USDT`, "danger")}
    ${info("资金费累计", `${position.fundingFee >= 0 ? "-" : "+"}${formatUsd(Math.abs(position.fundingFee))} USDT`, position.fundingFee <= 0 ? "up" : "down")}
    ${info("预估净盈亏", `${netPnl >= 0 ? "+" : "-"}${formatUsd(Math.abs(netPnl))} USDT`, netPnl >= 0 ? "up" : "down")}
    <div class="risk-meter">
      <div>保证金率</div>
      <strong>${formatUsd(marginRatio, 1)}%</strong>
      <span style="width:${Math.min(100, marginRatio)}%"></span>
    </div>
  `;
}

function renderPendingOrders() {
  dom.pendingCount.textContent = String(state.pendingOrders.length);

  if (state.pendingOrders.length === 0) {
    dom.pendingOrders.innerHTML = '<div class="empty-mini">暂无挂单</div>';
    return;
  }

  dom.pendingOrders.innerHTML = state.pendingOrders.map((order) => `
    <article class="pending-card">
      <header>
        <strong class="${order.side === "long" ? "text-up" : "text-down"}">
          ${order.side === "long" ? "限价开多" : "限价开空"}
        </strong>
        <small>${order.createdAt}</small>
      </header>
      <small>委托价 $${formatUsd(order.price)} · ${order.leverage}x · 保证金 ${formatUsd(order.margin)} USDT</small>
      <footer>
        <small>${order.side === "long" ? "价格小于等于委托价成交" : "价格大于等于委托价成交"}</small>
        <button class="cancel-order" data-order-id="${order.id}">撤单</button>
      </footer>
    </article>
  `).join("");
}

function renderTradeHistory() {
  dom.tradeCount.textContent = `${state.tradeHistory.length} 笔`;

  if (state.tradeHistory.length === 0) {
    dom.tradeHistory.innerHTML = '<div class="empty-state">暂无成交，开仓或平仓后这里会记录价格、手续费和已实现盈亏。</div>';
    return;
  }

  dom.tradeHistory.innerHTML = state.tradeHistory.map((trade) => {
    const actionText = {
      open: trade.orderType === "limit" ? "限价开仓" : "市价开仓",
      close: "手动平仓",
      liquidation: "强制平仓",
    }[trade.action];
    const pnlTone = trade.realizedPnl === null
      ? ""
      : trade.realizedPnl >= 0
        ? "text-up"
        : "text-down";
    const pnlText = trade.realizedPnl === null
      ? "-"
      : `${trade.realizedPnl >= 0 ? "+" : "-"}${formatUsd(Math.abs(trade.realizedPnl))} USDT`;

    return `
      <article class="trade-row">
        <span>${trade.time}</span>
        <strong class="trade-pill ${trade.side === "long" ? "text-up" : "text-down"}">${trade.side === "long" ? "多" : "空"}</strong>
        <div class="trade-main">
          <strong>${actionText}</strong>
          <span>${formatUsd(trade.size, 4)} BTC</span>
        </div>
        <div>
          <span>成交价</span>
          <strong>$${formatUsd(trade.price)}</strong>
        </div>
        <div>
          <span>费用</span>
          <strong>${formatUsd(trade.fee)} USDT</strong>
        </div>
        <div>
          <span>已实现盈亏</span>
          <strong class="${pnlTone}">${pnlText}</strong>
        </div>
      </article>
    `;
  }).join("");
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
  dom.openButton.textContent =
    state.orderType === "limit"
      ? `${state.side === "long" ? "挂多单" : "挂空单"} BTC`
      : `${state.side === "long" ? "开多" : "开空"} BTC`;
  dom.openButton.disabled = Boolean(state.position) || state.pendingOrders.length > 0;

  dom.orderTypeGroup.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.orderType === state.orderType);
  });
  dom.sideGroup.querySelectorAll("button").forEach((button) => {
    const active = button.dataset.side === state.side;
    button.classList.toggle("active", active);
    button.classList.toggle("long", active && state.side === "long");
    button.classList.toggle("short", active && state.side === "short");
  });
  dom.intervalTabs.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.interval === state.interval);
  });
}

function renderMarketFrame() {
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

  renderBook();
  renderPosition();
  syncLiquidationPriceLine();
}

function renderAll() {
  setChartData();
  renderMarketFrame();
  renderControls();
  renderPendingOrders();
  renderTradeHistory();
  renderLogs();
}

dom.runToggle.addEventListener("click", () => {
  state.isRunning = !state.isRunning;
  resumeMarket();
  renderControls();
});

dom.shockToggle.addEventListener("click", () => {
  state.shockMode = !state.shockMode;
  addLog(state.shockMode ? "暴跌模拟已开启，行情波动加速。" : "暴跌模拟已关闭。", "info");
  resumeMarket();
  renderControls();
});

dom.resetButton.addEventListener("click", resetDemo);

dom.intervalTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-interval]");
  if (!button) return;
  changeInterval(button.dataset.interval);
});

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
dom.pendingOrders.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-order-id]");
  if (!button) return;
  cancelOrder(Number(button.dataset.orderId));
});
window.addEventListener("resize", () => {
  const rect = dom.chart.getBoundingClientRect();
  chartApi.resize(Math.max(320, Math.floor(rect.width)), Math.max(320, Math.floor(rect.height)));
});

state.limitPrice = latestPrice();
initChart();
loadInitialCandles().finally(() => {
  resumeMarket();
  renderAll();
});
