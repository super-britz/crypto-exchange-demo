# Crypto Exchange Demo

这是 31 节课作业的最小可演示版本，功能覆盖：

- K 线图
- 盘口 / 订单簿
- 模拟 socket 行情推送
- 市价 / 限价下单
- 开仓、平仓
- 暴跌行情
- 强制平仓
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

1. 看 K 线图自动刷新，说明这是模拟的 1 分钟 candle。
2. 看右侧盘口持续变化，说明这是模拟 WebSocket 高频推送。
3. 在下单区选择开多或开空，设置保证金和杠杆。
4. 点击开仓，观察仓位区出现入场价、标记价、强平价、未实现盈亏。
5. 点击“暴跌模拟”，让行情波动加速。
6. 如果价格触发强平线，系统会自动强平并写入事件日志。
7. 也可以点击“手动平仓”观察余额和日志变化。

## 面试可以怎么讲

### K 线

K 线使用 `lightweight-charts` 绘制，数据结构包括 open、high、low、close、volume。每次行情 tick 都会追加新 candle，并保留最近 72 根。

对应代码：`src/app.js` 里的 `initChart()`、`renderKline()`、`createCandles()`、`tick()`。

这次升级后可以这样讲：

> 第一版用 Canvas 手写过 K 线，理解 OHLC、坐标映射和行情刷新。升级版引入 TradingView Lightweight Charts，补上交易所常见的十字光标、时间轴缩放、价格轴和成交量柱。

### 盘口

盘口根据标记价格生成买卖档位，展示价格、数量、累计数量，并用背景深度条模拟盘口深度。

对应代码：`createOrderBook()`、`renderBook()`、`bookRow()`。

### Socket

这里没有连接真实后端，而是用 `setInterval` 模拟 WebSocket 行情推送。普通模式 1 秒一跳，暴跌模式 650ms 一跳并提高波动率。

对应代码：`scheduleSocket()`、`tick()`。

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

## 后续可升级点

- 接真实 Binance WebSocket 行情。
- 把盘口计算放进 Web Worker。
- 增加虚拟列表和批量更新策略。
- 增加委托订单、成交记录和资金费率结算。
- 接入真实 TradingView 时间粒度切换，比如 1m / 5m / 15m。
