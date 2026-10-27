export type RuleState = {
  athDdActive: boolean;
  skipSellDaysRemaining: number;
  skipSellWindowEnds: string | null;
  floorTriggered: boolean;
  latestClose: number;
  trailingAthClose: number;
  pctFromAth: number;
  athDdTriggerDate: string | null;
  athDdTriggerClose: number;
  athDdTriggerAthClose: number;
  athDdTriggerAthCloseDate: string | null;
  athDdTriggerPctOfAth: number;
};

export type RebalanceAction = 'buy_tqqq' | 'sell_tqqq' | 'hold';
export type DefensiveAsset = 'SGOV' | 'CASH';

export type RebalanceEvent = {
  date: string;
  action: RebalanceAction;
  intendedAction: RebalanceAction;
  tqqqTradeDollars: number;
  defensiveTradeDollars: number;
  tqqqValue: number;
  defensiveValue: number;
  tqqqWeight: number;
  defensiveWeight: number;
  ruleState: RuleState;
  reason: string;
  defensiveAsset: DefensiveAsset;
};

export type StrategySnapshot = {
  asOfDate: string;
  confirmedCloseDate: string;
  marketTimestamp: number;
  nextRebalanceDate: string;
  action: string;
  portfolioValue: number;
  tqqqValue: number;
  defensiveValue: number;
  tqqqTargetValue: number;
  defensiveAsset: DefensiveAsset;
  ruleState: RuleState;
  currentRebalanceEvent: RebalanceEvent | null;
};

export type StrategyInitialState = {
  date: string;
  tqqqTradeDollars: number;
  tqqqValue: number;
  defensiveValue: number;
  defensiveAsset: DefensiveAsset;
};

export type StrategyConfig = {
  name: string;
  trailingAthLookbackDays: number;
  skipSellThresholdRatio: number;
  skipSellWindowDays: number;
  floorTriggerPct: number;
  floorTargetPct: number;
  nextQuarterTargetMultiplier: number;
};

export type BenchmarkSeries = {
  tqqqBuyAndHold: Array<{ date: string; value: number }>;
  defensiveSleeve: Array<{ date: string; value: number }>;
};

export type StrategyBacktest = {
  initialState: StrategyInitialState;
  equityCurve: Array<{ date: string; value: number }>;
  benchmark: BenchmarkSeries;
  latestState: {
    date: string;
    tqqqValue: number;
    defensiveValue: number;
    portfolioValue: number;
    tqqqTargetValue: number;
    defensiveAsset: DefensiveAsset;
    ruleState: RuleState;
  };
  metrics: {
    finalValue: number;
    cagr: number;
    maxDrawdown: number;
    rebalanceCount: number;
    buyHoldFinalValue: number;
    buyHoldCagr: number;
    buyHoldMaxDrawdown: number;
  };
  rebalanceLog: RebalanceEvent[];
};

export type PricePoint = {
  date: string;
  open: number;
  close: number;
  high?: number;
};
