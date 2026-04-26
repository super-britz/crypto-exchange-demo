# Crypto Exchange Demo

这是 31 节课作业的最小可演示版本，功能覆盖：

- K 线图
- 盘口 / 订单簿
- Binance WebSocket 实时行情
- 市价 / 限价下单
- 开仓、平仓
- 暴跌行情
- 强制平仓
- K 线强平价线
- 资金费率展示
- 事件日志
- TradingView Lightweight Charts K 线

## 运行方式

在项目目录安装依赖：

```bash
cd /Users/britz/Downloads/crypto-exchange-demo
npm install
```

启动开发服务：

```bash
npm run dev
```

然后打开终端输出的本地地址，通常是：

```text
http://127.0.0.1:5173/
```

## 演示顺序

1. 看顶部状态变成“Binance 实时行情”。
2. 看 K 线图自动刷新，说明它接了 Binance `btcusdt@kline_1m`。
3. 看右侧盘口持续变化，说明它接了 Binance `btcusdt@depth20@100ms`。
4. 在下单区选择开多或开空，设置保证金和杠杆。
5. 点击开仓，观察仓位区出现入场价、标记价、强平价、未实现盈亏。
6. 看 K 线图上出现 `Liq` 强平价线。
7. 点击“暴跌模拟”，临时切到本地压力测试行情，让强平更容易被演示出来。
8. 如果价格触发强平线，系统会自动强平并写入事件日志，同时移除 K 线上的强平价线。
9. 也可以点击“手动平仓”观察余额和日志变化。

## 面试可以怎么讲

### K 线

K 线使用 `lightweight-charts` 绘制，数据结构包括 open、high、low、close、volume。启动时拉取最近 72 根 1m K 线并通过 `setData()` 初始化，之后由 WebSocket 通过 `series.update()` 增量更新最新 candle。

对应代码：`src/app.js` 里的 `initChart()`、`setChartData()`、`updateChartWithCandle()`、`loadInitialCandles()`、`upsertStreamCandle()`。

这次升级后可以这样讲：

> 第一版用 Canvas 手写过 K 线，理解 OHLC、坐标映射和行情刷新。升级版引入 TradingView Lightweight Charts，补上交易所常见的十字光标、时间轴缩放、价格轴和成交量柱。

### 盘口

盘口订阅 Binance `btcusdt@depth20@100ms`，展示 20 档深度里的买卖盘价格、数量、累计数量，并用背景深度条展示盘口厚度。

对应代码：`connectMarketStream()`、`normalizeDepth()`、`renderBook()`、`bookRow()`。

盘口是高频数据流，WebSocket 消息不会每条都直接刷新 DOM，而是先写入内存中的最新 order book，再通过 `requestAnimationFrame` 合并到下一帧渲染，降低主线程压力。

对应代码：`requestMarketRender()`、`renderMarketFrame()`。

### Socket

真实行情来自 Binance market-data-only WebSocket：

```text
wss://data-stream.binance.vision/stream?streams=btcusdt@kline_1m/btcusdt@depth20@100ms
```

启动时会通过 `data-api.binance.vision` 拉最近 72 根 1m K 线，随后 WebSocket 增量更新最新 K 线和盘口。暴跌模拟是本地压力测试模式，会临时断开真实流，关闭后再自动重连。

如果当前网络或代理出口无法连接 Binance WebSocket，页面会自动尝试备用 endpoint；多次失败后会降级到本地模拟行情，并在顶部状态栏显示“连接失败，使用本地模拟”。

对应代码：`loadInitialCandles()`、`connectMarketStream()`、`upsertStreamCandle()`、`resumeMarket()`。

### 开仓和平仓

开仓时根据保证金和杠杆计算名义价值，再用入场价计算仓位数量。平仓时根据当前标记价计算盈亏，并回到账户余额。

对应代码：`openPosition()`、`closePosition()`、`calcPnl()`。

### 强制平仓

强平价用简化模型计算：

```text
多单强平价 = 入场价 * (1 - (1 / 杠杆 - 维持保证金率))
空单强平价 = 入场价 * (1 + (1 / 杠杆 - 维持保证金率))
```

每次行情更新后都会检查是否触发强平。

对应代码：`calcLiquidationPrice()`、`checkLiquidation()`。

开仓后会用 Lightweight Charts 的 `createPriceLine()` 在 K 线上绘制强平价线；平仓或强平后通过 `removePriceLine()` 移除。

对应代码：`syncLiquidationPriceLine()`、`clearLiquidationPriceLine()`。

## 后续可升级点

- 把盘口计算放进 Web Worker。
- 增加虚拟列表和批量更新策略。
- 增加委托订单、成交记录和资金费率结算。
- 接入真实 TradingView 时间粒度切换，比如 1m / 5m / 15m。
- 断线重连时增加指数退避和最大重试次数。
