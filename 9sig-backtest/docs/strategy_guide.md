# 9sig Strategy - Detailed Explanation

## Overview
The 9sig strategy is a systematic investment approach designed for 3x leveraged ETFs (like TQQQ or QQQ3) that aims to capture growth while managing risk through quarterly rebalancing and special rules for extreme market conditions.

## Core Components

### 1. Instruments
- **Primary Investment**: 3x leveraged ETF (e.g., TQQQ for NASDAQ-100 3x leverage)
- **Secondary Asset**: Cash (or alternatives like gold/bonds for stability)

### 2. Initial Allocation
- **60%** in the 3x leveraged ETF
- **40%** in cash/stable assets

### 3. Quarterly Rebalancing Rules

The strategy operates on a quarterly schedule with the following logic:

#### Standard Rebalancing (9% Target Growth)
At the end of each quarter, evaluate the ETF performance:

- **If ETF grew MORE than 9%**: Sell excess ETF holdings to bring the quarterly growth back down to exactly 9%
  - Example: If ETF grew 15% in Q1, sell enough to realize only 9% growth
  - The proceeds go to the cash position
  
- **If ETF grew LESS than 9%**: Buy additional ETF using cash to achieve 9% quarterly growth
  - Example: If ETF grew only 3% in Q1, buy more ETF to reach 9% growth target
  - This uses cash reserves to increase ETF position

- **If ETF had NEGATIVE growth**: Still buy more ETF to reach 9% growth from the previous quarter's ending value
  - Example: If ETF dropped -5% in Q1, buy enough to achieve 9% growth from Q4's ending value

## Special Rules

### 4. The "30 Down" Rule

This rule activates during significant drawdowns:

**Trigger**: When the ETF drops 30% or more (measured at quarter close) compared to the highest quarterly close in the past 2 years (8 quarters).

**Effects when triggered**:
1. **Ignore sell signals**: Do NOT sell ETF even if it grows more than 9% in subsequent quarters
2. **Continue buy signals**: Still buy more ETF if quarterly growth is less than 9%
3. **Duration**: Ignore the next 2 sell signals
4. **Reset**: After ignoring 2 sell signals, rebalance the entire portfolio back to 60/40 allocation

**Rationale**: This prevents selling during recovery periods after significant drawdowns, allowing the portfolio to benefit from potential rebounds.

### 5. The "100 Up" Rule

This rule handles extreme positive performance:

**Trigger**: When the ETF gains 100% or more in a single quarter.

**Effect**: Immediately rebalance the entire portfolio back to the original 60/40 allocation.

**Rationale**: This takes profits after exceptional gains and reduces risk exposure when valuations may be stretched.

## Implementation Details

### Quarterly Process
1. Calculate ETF performance for the quarter
2. Check for special rule triggers (30 Down or 100 Up)
3. If no special rules apply, execute standard 9% rebalancing
4. If 30 Down rule is active, follow its logic
5. Record the quarter's closing value for future reference

### Key Calculations
- **Quarterly Growth**: (Current Value - Previous Quarter Close) / Previous Quarter Close
- **9% Target Value**: Previous Quarter Close × 1.09
- **30% Drawdown Level**: Highest Quarterly Close in Past 2 Years × 0.70
- **Rebalancing Amount**: Current Holdings - Target Holdings

### Risk Management Features
1. **Volatility Dampening**: The 9% cap limits exposure during rapid upswings
2. **Drawdown Protection**: The 30 Down rule prevents panic selling
3. **Profit Taking**: The 100 Up rule ensures exceptional gains are locked in
4. **Cash Buffer**: The 40% cash allocation provides buying power during downturns

## Example Scenarios

### Scenario 1: Normal Quarter
- Q1 ends with ETF up 12%
- Action: Sell ETF to realize only 9% growth
- Result: Extra 3% gains converted to cash

### Scenario 2: Down Market
- Q2 ends with ETF down -8%
- Action: Buy more ETF to achieve 9% growth from Q1 close
- Result: Increased ETF position using cash reserves

### Scenario 3: 30 Down Triggered
- ETF drops 35% from 2-year high
- Next quarter ETF recovers 20%
- Action: Hold all ETF (ignore sell signal), don't rebalance to 9%
- Result: Capture full recovery potential

### Scenario 4: Extreme Rally
- ETF gains 105% in one quarter
- Action: Immediately rebalance to 60/40
- Result: Lock in exceptional gains, reduce risk