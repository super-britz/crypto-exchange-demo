# Crypto Exchange Demo

这是 31 节课作业的交易所前端 Demo。它不是为了做一个真正可交易的产品，而是用交易所这个业务场景，练习前端在实时数据、复杂状态、性能优化和业务风控里的核心能力。

项目地址：

```text
/Users/britz/Downloads/crypto-exchange-demo
```

## 这个项目解决什么问题

普通 CRUD 项目主要证明会调接口、渲染列表、提交表单。交易所前端更复杂，因为页面面对的是持续变化的行情、用户订单、仓位风险、账户资产和异常网络状态。

这个 Demo 覆盖了一个简化但完整的交易流程：

```text
实时行情 -> K 线 / 盘口 -> 下单 -> 持仓 -> 盈亏 / 费用 -> 平仓 / 强平 -> 成交记录
```

你通过这个项目练到的不是某一个库，而是“如何把快速变化的数据，稳定、准确、可解释地呈现给用户”。

## 已完成功能

- K 线图，使用 TradingView Lightweight Charts
- K 线周期切换：1m / 5m / 15m / 1h
- Binance WebSocket 实时行情
- Binance 历史 K 线初始化
- 盘口 / 订单簿
- 盘口渲染节流
- K 线 `update()` 增量更新
- 市价 / 限价下单
- 限价挂单 / 到价成交 / 撤单
- 开仓、手动平仓
- 强制平仓模拟
- K 线强平价线
- 手续费计算
- 资金费率模拟结算
- 账户资产面板
- 成交记录 / 已实现盈亏
- 事件日志
- Binance 连接失败后的本地模拟降级
- 暴跌行情压力测试

## 运行方式

安装依赖：

```bash
cd /Users/britz/Downloads/crypto-exchange-demo
npm install
```

启动本地开发服务：

```bash
npm run dev
```

打开本地地址：

```text
http://127.0.0.1:5173/
```

生产构建：

```bash
npm run build
```

## 演示顺序

1. 看顶部状态变成“Binance 实时行情”。
2. 看 K 线图自动刷新，说明接入了 Binance `btcusdt@kline_1m`。
3. 看右侧盘口持续变化，说明接入了 Binance `btcusdt@depth20@100ms`。
4. 切换 `1m / 5m / 15m / 1h` 周期，观察历史 K 线重新加载并重连对应 stream。
5. 用市价单开仓，观察账户资产面板里的可用余额、占用保证金、钱包余额、总权益变化。
6. 切到限价单，输入委托价，观察“当前委托”。
7. 等行情到价自动成交，或者手动撤单释放保证金。
8. 成交后看 K 线上出现 `Liq` 强平价线。
9. 等待资金费率模拟结算，观察账户资产和事件日志变化。
10. 点击“手动平仓”，查看成交记录里的平仓价、手续费、已实现盈亏。
11. 点击“暴跌模拟”，让价格更容易触发强平。
12. 触发强平后，观察仓位清空、强平线移除、成交记录新增强平流水。

## 我学到了什么

### 1. K 线不是图表，而是时间序列数据

K 线数据本质是 OHLCV：

```text
open / high / low / close / volume
```

页面启动时先拉历史 K 线，通过 `setData()` 初始化图表；WebSocket 推送新行情后，通过 `series.update()` 增量更新最后一根 K 线。

对应代码：

- `initChart()`
- `setChartData()`
- `updateChartWithCandle()`
- `loadInitialCandles()`
- `upsertStreamCandle()`

学这个的意义：很多业务都不是静态表格，而是时间序列，比如监控指标、服务器日志、IoT 数据、订单趋势、实时大屏。

### 2. 盘口不是列表，而是高频数据流

盘口订阅 Binance：

```text
btcusdt@depth20@100ms
```

这个数据更新频率很高。如果每条 WebSocket 消息都直接刷新 DOM，页面会抖、会卡。所以这里先把最新盘口写进内存，再用 `requestAnimationFrame` 合并到浏览器下一帧渲染。

对应代码：

- `connectMarketStream()`
- `normalizeDepth()`
- `requestMarketRender()`
- `renderMarketFrame()`
- `renderBook()`

学这个的意义：实时行情、告警流、聊天消息、协作编辑、在线状态、物流轨迹，都会遇到“数据推得比 UI 能渲染得更快”的问题。

### 3. WebSocket 不是连上就完了

这个项目里 WebSocket 做了：

- 连接中状态
- 已连接状态
- 重连状态
- 失败后切备用 endpoint
- 多次失败后降级到本地模拟行情
- 暴跌模拟时临时断开真实行情
- 关闭模拟后恢复真实行情

对应代码：

- `getBinanceWsUrls()`
- `connectMarketStream()`
- `setStreamStatus()`
- `scheduleReconnect()`
- `resumeMarket()`

学这个的意义：真实业务里网络一定会失败。前端需要让用户知道系统现在处于什么状态，而不是静默坏掉。

### 4. 交易前端的核心是状态机

这个 Demo 里的订单和仓位状态变化大概是：

```text
无仓位
-> 提交市价单
-> 持仓中
-> 手动平仓 / 强制平仓
-> 无仓位
```

限价单则是：

```text
无挂单
-> 提交限价单
-> 当前委托
-> 到价成交 / 手动撤单
-> 持仓中 / 无挂单
```

对应代码：

- `openPosition()`
- `placeLimitOrder()`
- `checkPendingOrders()`
- `cancelOrder()`
- `closePosition()`
- `checkLiquidation()`

学这个的意义：很多业务都不是“点一下按钮调接口”这么简单，而是状态流转，比如审批、订单、退款、物流、工单、课程报名、库存占用。

### 5. 账户资产模型比 UI 更重要

账户面板拆出了：

- 钱包余额
- 可用余额
- 占用保证金
- 未实现盈亏
- 已实现盈亏
- 累计费用
- 资金费净额
- 总权益

核心公式：

```text
钱包余额 = 可用余额 + 占用保证金
总权益 = 钱包余额 + 未实现盈亏
占用保证金 = 持仓保证金 + 当前委托保证金
净已实现盈亏 = 毛盈亏 - 开仓手续费 - 平仓手续费 - 资金费累计
```

对应代码：

- `calcUsedMargin()`
- `getAccountSnapshot()`
- `renderAccount()`
- `calcPnl()`
- `calcTradingFee()`

学这个的意义：前端不是把接口字段摆出来就行，还要理解业务字段之间的关系。金融、库存、SaaS 计费、订单结算都会有类似的资产或资源模型。

## 为什么需要学习这些

这个项目训练的是高级前端能力：

- 实时数据处理
- 高频 UI 渲染优化
- 复杂业务状态管理
- 异常状态和降级策略
- 业务公式落地
- 图表库选型
- 用户风险提示
- 可解释的交易流水

如果只做普通后台管理系统，面试官很难看出你能不能处理复杂业务。这个 Demo 可以证明你不只是会写页面，也能理解数据、状态、性能和业务风险。

## 实际业务中的作用

交易所只是一个练习载体，这些能力可以迁移到很多业务：

- 金融交易：行情、盘口、订单、持仓、风控
- 监控平台：指标曲线、实时日志、告警流
- 物流系统：车辆轨迹、订单状态、异常提醒
- 协作工具：多人在线、实时同步、冲突处理
- 客服系统：消息流、会话状态、未读计数
- 游戏和互动系统：帧更新、事件流、实时状态
- SaaS 工作台：复杂表单、状态流转、审计记录

所以这个项目的价值不是“会做交易所”，而是证明你能做实时、复杂、强业务约束的前端应用。

## 技术选型说明

### 为什么用 Lightweight Charts

K 线看起来只是蜡烛图，但交易软件里的 K 线需要：

- 十字光标
- 时间轴
- 价格轴
- 缩放和平移
- 成交量
- 增量更新
- price line
- 高频数据下保持性能

ECharts、AntV 更偏通用图表。它们可以画 K 线，但交易场景里的细节需要自己补很多。Lightweight Charts 是 TradingView 开源的金融图表库，更贴近交易终端需求。

这不等于不能手写 Canvas。手写 Canvas 的价值是理解底层坐标映射、像素比、重绘、数据裁剪；引入 Lightweight Charts 的价值是站在成熟库上完成更接近真实业务的功能。

### Lightweight Charts 和 Canvas 的关系

Lightweight Charts 底层也是基于 Canvas 渲染。区别是：

```text
手写 Canvas = 自己管理坐标、缩放、绘制、事件、性能
Lightweight Charts = 库帮你封装金融图表常用能力
```

所以学习路径不是二选一，而是：

```text
先手写，理解原理
再用库，完成业务
```

## 核心模块

### K 线模块

负责历史 K 线初始化、实时 K 线更新、周期切换和强平线绘制。

关键函数：

- `initChart()`
- `setChartData()`
- `updateChartWithCandle()`
- `changeInterval()`
- `syncLiquidationPriceLine()`

### 行情模块

负责 Binance REST、WebSocket、重连和本地模拟降级。

关键函数：

- `loadInitialCandles()`
- `connectMarketStream()`
- `handleStreamPayload()`
- `scheduleReconnect()`
- `startLocalStressStream()`

### 订单模块

负责市价单、限价单、撤单、到价成交。

关键函数：

- `openPosition()`
- `placeLimitOrder()`
- `checkPendingOrders()`
- `cancelOrder()`

### 仓位和风控模块

负责持仓、盈亏、手续费、资金费、强平。

关键函数：

- `createPositionFromOrder()`
- `closePosition()`
- `checkLiquidation()`
- `settleFundingFee()`
- `calcLiquidationPrice()`

### 账户和流水模块

负责资产快照、成交记录、已实现盈亏。

关键函数：

- `getAccountSnapshot()`
- `renderAccount()`
- `addTrade()`
- `renderTradeHistory()`

## 面试可以怎么讲

可以按这条线讲：

```text
我做的是一个合约交易前端 Demo。它接了 Binance 的 K 线和盘口 WebSocket，K 线用 Lightweight Charts 做历史初始化和增量 update，盘口用 requestAnimationFrame 做渲染节流。交易侧实现了市价、限价、挂单、撤单、开仓、平仓、强平、手续费、资金费和成交记录。账户侧拆了钱包余额、可用余额、占用保证金、未实现盈亏、已实现盈亏和总权益。这个项目重点不是交易本身，而是训练实时数据、复杂状态和高频渲染。
```

如果被问“为什么不用 ECharts”，可以说：

```text
ECharts 是通用图表库，可以画 K 线，但交易终端需要十字光标、时间轴、价格轴、缩放、成交量、price line 和高频增量更新。Lightweight Charts 更贴近金融图表场景。之前我也手写过 Canvas K 线，所以理解底层绘制；这里用成熟库是为了更快完成业务能力。
```

如果被问“项目难点是什么”，可以说：

```text
难点不在画 UI，而在实时数据和业务状态。盘口是高频推送，不能每条消息都刷新 DOM，所以用了 requestAnimationFrame 合并渲染。K 线不能每次全量 setData，所以用 update 增量更新。交易侧要保证保证金占用、手续费、资金费、已实现盈亏和强平状态一致，所以抽了账户快照函数统一计算。
```

## 后续可升级点

- 止盈止损 TP/SL
- 历史委托列表
- WebSocket 最近更新时间、重连次数、当前 endpoint 展示
- localStorage 保存账户和成交记录
- 盘口计算放进 Web Worker
- 移动端用分区 tabs 优化体验
- 更接近真实交易所的风险率和保证金率模型
