# 9sig Backtest

## 中文网页版（107）

- 工作台：<http://183.23.140.51:8910/>
- 40% / 50% / 60% 现金策略对比：<http://183.23.140.51:8910/?compare=1#cash-comparison>
- 每 3 个月 / 半年 / 一年的三张模拟表：<http://183.23.140.51:8910/?frequency=1#frequency-comparison>
- 再平衡过程演示：<http://183.23.140.51:8910/?rebalance=1#rebalance-panel>
- 交易策略与再平衡详解：<http://183.23.140.51:8910/guide#rebalance>
- 六步交互演示：<http://183.23.140.51:8910/?demo=1>
- 详细图文操作指南：<http://183.23.140.51:8910/guide>
- 局域网工作台：<http://192.168.124.107:8910/>

网页复用本项目原 Python 回测引擎，提供 CSV 导入、资金与规则参数、日期筛选、
策略与全仓 ETF 对照图、逐季交易解释及 CSV 下载。打开页面自动运行默认演示。
“再平衡过程”按估值、判定、目标、买卖、核对五步展示每个季度，并提供调仓前后
占比、资金划转与持仓对照。普通季度增长目标与特殊比例重置分别计算；30 Down
按卖出信号消耗忽略次数，现金不足时不成交，重置可能买入或卖出。所有明细对应
原引擎实际输出，自定义初始占比也会同步到计算过程与 CSV。
独立“现金比例对比”栏目同时计算 40%、50%、60% 现金（ETF 对应 60%、50%、40%），
共用当前数据、日期、本金和特殊规则，展示累计 / 年化收益、季度最大回撤、期末资产、
调仓次数以及可逐季查看的收益 / 回撤曲线。特殊重置恢复到各组的初始比例。
左侧 ETF 占比只控制单策略结果；三组对比的初始比例固定。支持单独导出对比 CSV。
“调仓周期对比”新增三张表，各含三种现金配置，共九种组合。周期增长目标由季度目标
复利换算（默认 9% / 18.81% / 41.158161%），回看窗口换算为周期数并向上取整；
特殊规则仅在周期末检查，100 Up 百分比保持不变并按该周期的累计增长判断。
九组最大回撤统一按季度估值，包含未调仓季度。表格显示检查日期和不完整周期提示，
可导出九行汇总 CSV；完整约定见网页指南的“调仓周期对比”。
原仓库没有附行情 CSV，内置的 25 个季度价格是**人工模拟数据，不是真实 TQQQ 行情**。
导入的 CSV 仅用于请求内存计算；页面不接券商、不下单、不保存上传文件。

快速操作：打开工作台 → “跟着演示一遍” → 按六步演示查看 192 股卖出与 30 Down 再平衡 →
“导出 CSV” → 选择“上传自己的 CSV”并重新回测。全部细节与规则限制见页面指南。

部署、服务管理和回滚命令见 [deploy/README.md](deploy/README.md)。
验收入口与报告见 [test/README.md](test/README.md)。

下面保留原命令行项目说明。

A backtester for a specific, rules-based investment strategy.

## The strat

It's a 60/40 portfolio (ETF/cash) that rebalances based on a set of rules. The core idea is to aim for a fixed quarterly growth target for the ETF portion and apply specific actions during significant market drawdowns or gains.

The full details are in `docs/strategy_guide.md` which I read in some Reddit post.

## The structure

```
.
├── .gitignore
├── README.md
├── requirements.txt
├── data
│   └── market_data.csv
├── docs
│   ├── strategy_guide.md
│   └── strategy_source.txt
├── results
│   ├── backtest.log
│   ├── performance_chart.html
│   ├── performance_chart.png
│   └── strategy_results.csv
└── src
    └── backtester.py
```

## How to run it

Make sure you have Python, then install the dependencies.

```bash
pip install -r requirements.txt
```

From the root directory, run the script.

```bash
python src/backtester.py
```

This creates a `results` directory with the output. You'll get an interactive chart, a CSV with the detailed data, the logs, and a summary table in the console.

## Results

So, the strategy underperforms a simple buy-and-hold. It does manage to curb volatility a bit, but not enough to make up for the lost returns. The rules seem to have a knack for selling too early in recovery periods.

![Performance Chart](results/performance_chart.png)
