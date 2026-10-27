# 9sig Backtest

## 中文网页版（107）

- 工作台：<http://183.23.140.51:8910/>
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
