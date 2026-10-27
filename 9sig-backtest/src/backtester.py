# -*- coding: utf-8 -*-
"""
A simple, vectorized backtester for the 9sig investment strategy.

This script runs a backtest of the 9sig strategy, a rules-based method
for managing a portfolio of a leveraged ETF and cash. It handles data loading,
the core backtesting loop, event logging, and generates an interactive
performance chart and a summary report.
"""

import logging
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List, Dict, Tuple, Optional

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from rich.console import Console
from rich.table import Table

# --- Configuration ---

@dataclass(frozen=True)
class StrategyConfig:
    """Parameters for the 9sig strategy."""
    initial_capital: float = 10000.0
    etf_allocation: float = 0.6
    cash_allocation: float = 0.4
    target_quarterly_growth: float = 0.09
    drawdown_threshold: float = 0.30
    drawdown_lookback_quarters: int = 8
    sell_signals_to_ignore_on_drawdown: int = 2
    extreme_gain_threshold: float = 1.0

@dataclass(frozen=True)
class FileConfig:
    """File and path configuration."""
    # Input file
    data_csv_path: Path = Path("data/market_data.csv")
    
    # Output files
    output_dir: Path = Path("results")
    log_file_path: Path = output_dir / "backtest.log"
    results_csv_path: Path = output_dir / "strategy_results.csv"
    plot_html_path: Path = output_dir / "performance_chart.html"
    plot_png_path: Path = output_dir / "performance_chart.png"

# --- Logging Setup ---

def setup_logging(log_path: Path) -> None:
    """Configure logging to console and file."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(log_path, mode='w'),
            logging.StreamHandler(sys.stdout)
        ]
    )

# --- Core Components ---

class Portfolio:
    """Manages the state of the investment portfolio."""
    def __init__(self, config: StrategyConfig):
        self._config = config
        self.etf_shares: float = 0.0
        self.cash: float = 0.0
        self.initial_value: float = config.initial_capital

    def initialize(self, initial_etf_price: float) -> None:
        """Set up the initial 60/40 allocation."""
        self.cash = self.initial_value * self._config.cash_allocation
        initial_etf_value = self.initial_value * self._config.etf_allocation
        if initial_etf_price > 0:
            self.etf_shares = initial_etf_value / initial_etf_price
        logging.info(f"Portfolio initialized. ETF Shares: {self.etf_shares:.4f}, Cash: ${self.cash:,.2f}")

    def get_value(self, current_etf_price: float) -> Tuple[float, float]:
        """Calculate the current total value of the portfolio."""
        etf_value = self.etf_shares * current_etf_price
        total_value = etf_value + self.cash
        return etf_value, total_value

    def rebalance_to_target(self, total_value: float, current_etf_price: float) -> None:
        """Rebalance the portfolio back to the initial 60/40 split."""
        target_etf_value = total_value * self._config.etf_allocation
        self.cash = total_value * self._config.cash_allocation
        if current_etf_price > 0:
            self.etf_shares = target_etf_value / current_etf_price
        logging.info("Rebalancing portfolio to 60/40 allocation.")

    def adjust_for_target_growth(
        self, target_etf_value: float, current_etf_value: float, current_etf_price: float
    ) -> str:
        """Adjust portfolio to meet the quarterly ETF growth target."""
        if current_etf_value > target_etf_value:
            # Sell excess ETF
            shares_to_sell = (current_etf_value - target_etf_value) / current_etf_price
            self.etf_shares -= shares_to_sell
            self.cash += shares_to_sell * current_etf_price
            action = f"Sell {shares_to_sell:.2f} shares"
            logging.info(f"{action} for ${shares_to_sell * current_etf_price:,.2f}")
            return action
        else:
            # Buy more ETF
            value_to_buy = target_etf_value - current_etf_value
            if self.cash >= value_to_buy:
                shares_to_buy = value_to_buy / current_etf_price
                self.etf_shares += shares_to_buy
                self.cash -= value_to_buy
                action = f"Buy {shares_to_buy:.2f} shares"
                logging.info(f"{action} for ${value_to_buy:,.2f}")
                return action
            else:
                logging.warning(f"Insufficient cash. Need ${value_to_buy:,.2f}, have ${self.cash:,.2f}")
                return "Insufficient Cash"

class DataHandler:
    """Handles loading and preparing market data."""
    @staticmethod
    def load_price_data(path: Path) -> pd.DataFrame:
        """Load and prepare historical price data from a CSV."""
        logging.info(f"Loading data from {path}")
        df = pd.read_csv(path)
        df['Date'] = pd.to_datetime(df['Date'])
        df = df.set_index('Date')
        df.columns = ['ETF_Price', 'Cash_Rate']
        return df

    @staticmethod
    def get_quarter_end_dates(df: pd.DataFrame) -> pd.DatetimeIndex:
        """Get the actual last trading day of each quarter from the data."""
        logging.info("Determining quarter-end dates from data.")
        if not isinstance(df.index, pd.DatetimeIndex):
            raise TypeError("DataFrame index must be a DatetimeIndex.")

        # Group by year/quarter and find the last date in each group.
        # This ensures we only use dates that actually exist in the index.
        quarter_ends = df.groupby([df.index.year, df.index.quarter]).apply(lambda x: x.index.max())
        return pd.to_datetime(quarter_ends.values)

class Backtester:
    """Orchestrates the backtesting process."""
    def __init__(self, config: StrategyConfig, portfolio: Portfolio, data_handler: DataHandler):
        self.config = config
        self.portfolio = portfolio
        self.data_handler = data_handler
        self.thirty_down_active = False
        self.sell_signals_to_ignore = 0
        self.quarterly_etf_values: List[float] = []
        self.results: List[Dict] = []

    def _check_thirty_down_rule(self, current_etf_value: float) -> bool:
        """Check if the 30% drawdown rule is triggered."""
        if len(self.quarterly_etf_values) < self.config.drawdown_lookback_quarters:
            return False
        
        lookback_values = self.quarterly_etf_values[-self.config.drawdown_lookback_quarters:]
        highest_close = max(lookback_values)
        drawdown_level = highest_close * (1 - self.config.drawdown_threshold)
        
        return current_etf_value <= drawdown_level

    def run(self, price_data: pd.DataFrame, quarter_ends: pd.DatetimeIndex) -> pd.DataFrame:
        """Execute the main backtesting loop."""
        logging.info("Starting backtest run.")
        self.portfolio.initialize(price_data.iloc[0]['ETF_Price'])

        for i, date in enumerate(quarter_ends):
            current_price = price_data.loc[date, 'ETF_Price']
            etf_value, total_value = self.portfolio.get_value(current_price)
            
            action = "Hold"
            
            if i > 0:
                previous_etf_value = self.quarterly_etf_values[-1]
                quarterly_perf = (etf_value - previous_etf_value) / previous_etf_value if previous_etf_value else 0
                
                logging.info(f"--- Quarter {date.strftime('%Y-%m-%d')} ---")
                logging.info(f"Performance: {quarterly_perf:.2%}, Portfolio Value: ${total_value:,.2f}")

                # Check special rules
                is_30_down_triggered = self._check_thirty_down_rule(etf_value)
                is_100_up_triggered = quarterly_perf >= self.config.extreme_gain_threshold

                if is_30_down_triggered and not self.thirty_down_active:
                    self.thirty_down_active = True
                    self.sell_signals_to_ignore = self.config.sell_signals_to_ignore_on_drawdown
                    action = "30-Down Rule Triggered"
                    logging.warning(f"*** {action} ***")
                
                elif is_100_up_triggered:
                    action = "100-Up Rule Triggered"
                    self.portfolio.rebalance_to_target(total_value, current_price)
                    self.thirty_down_active = False # Reset 30-down rule
                    self.sell_signals_to_ignore = 0
                    logging.warning(f"*** {action} ***")

                else:
                    target_etf_value = previous_etf_value * (1 + self.config.target_quarterly_growth)
                    is_sell_signal = etf_value > target_etf_value

                    if is_sell_signal and self.thirty_down_active and self.sell_signals_to_ignore > 0:
                        self.sell_signals_to_ignore -= 1
                        action = f"Ignore Sell (30-Down, {self.sell_signals_to_ignore} left)"
                        logging.info(action)
                        if self.sell_signals_to_ignore == 0:
                            self.thirty_down_active = False
                            action = "30-Down Complete & Rebalance"
                            self.portfolio.rebalance_to_target(total_value, current_price)
                            logging.warning(f"*** {action} ***")
                    else:
                        action = self.portfolio.adjust_for_target_growth(target_etf_value, etf_value, current_price)

            # Record state for the quarter
            final_etf_value, final_total_value = self.portfolio.get_value(current_price)
            self.results.append({
                'date': date,
                'etf_price': current_price,
                'etf_shares': self.portfolio.etf_shares,
                'etf_value': final_etf_value,
                'cash_value': self.portfolio.cash,
                'total_value': final_total_value,
                'action': action
            })
            self.quarterly_etf_values.append(final_etf_value)

        logging.info("Backtest run completed.")
        return pd.DataFrame(self.results)

class Reporting:
    """Handles the generation of plots and summary tables."""
    @staticmethod
    def create_buy_and_hold_comparison(
        price_data: pd.DataFrame, quarter_ends: pd.DatetimeIndex, initial_capital: float
    ) -> pd.DataFrame:
        """Generate a buy-and-hold benchmark portfolio."""
        logging.info("Generating Buy & Hold comparison data.")
        initial_price = price_data.iloc[0]['ETF_Price']
        initial_shares = initial_capital / initial_price if initial_price > 0 else 0
        
        # Create the comparison dataframe using only the quarter-end dates
        comparison_df = price_data.loc[quarter_ends].copy()
        comparison_df['total_value'] = comparison_df['ETF_Price'] * initial_shares
        
        # Reset index to turn the date index into a column
        comparison_df = comparison_df.reset_index()
        
        return comparison_df.rename(columns={'index': 'date'})[['date', 'total_value']]

    @staticmethod
    def plot_interactive_results(
        strategy_df: pd.DataFrame, comparison_df: pd.DataFrame, file_path: Path
    ) -> None:
        """Create and save an interactive Plotly chart."""
        logging.info(f"Generating interactive plot and saving to {file_path}")
        fig = go.Figure()

        # Add traces
        fig.add_trace(go.Scatter(x=strategy_df['date'], y=comparison_df['total_value'], name='Buy & Hold',
                                 line=dict(color='red', width=2)))
        fig.add_trace(go.Scatter(x=strategy_df['date'], y=strategy_df['total_value'], name='9sig Strategy (Total)',
                                 line=dict(color='blue', width=2.5)))
        fig.add_trace(go.Scatter(x=strategy_df['date'], y=strategy_df['etf_value'], name='9sig ETF Value',
                                 line=dict(color='purple', width=1.5, dash='dot')))
        fig.add_trace(go.Scatter(x=strategy_df['date'], y=strategy_df['cash_value'], name='9sig Cash Value',
                                 line=dict(color='green', width=1.5, dash='dash')))

        # Add annotations for significant events
        events = strategy_df[strategy_df['action'].str.contains('Rule|Rebalance|Insufficient', na=False)]
        for _, row in events.iterrows():
            fig.add_annotation(
                x=row['date'], y=row['total_value'], text=row['action'][0], # First letter
                showarrow=True, arrowhead=2, ax=0, ay=-40,
                font=dict(size=9, color="black"),
                bordercolor="#c7c7c7", borderwidth=1, bgcolor="#ff7f0e", opacity=0.8
            )

        # Update layout
        fig.update_layout(
            title_text='9sig Strategy vs. Buy & Hold Performance',
            xaxis_title='Date',
            yaxis_title='Portfolio Value (Log Scale)',
            yaxis_type='log',
            legend_title_text='Portfolio',
            template='plotly_white',
            hovermode='x unified'
        )
        fig.write_html(str(file_path))
        # Also save as a static image for embedding
        png_path = file_path.with_suffix('.png')
        fig.write_image(str(png_path), width=1200, height=600, scale=2)
        logging.info(f"Static plot saved to {png_path}")

    @staticmethod
    def _calculate_kpis(series: pd.Series, risk_free_rate: float = 0.0) -> Dict[str, float]:
        """Helper to calculate performance metrics for a given value series."""
        quarterly_returns = series.pct_change()
        
        # Annualized Volatility
        annualized_volatility = quarterly_returns.std() * np.sqrt(4) # 4 quarters/year
        
        # Max Drawdown
        cumulative_max = series.cummax()
        drawdown = (series - cumulative_max) / cumulative_max
        max_drawdown = drawdown.min()
        
        # CAGR
        cagr = (series.iloc[-1] / series.iloc[0]) ** (1 / (len(series) / 4)) - 1
        
        # Sharpe Ratio
        excess_returns = quarterly_returns - (risk_free_rate / 4)
        sharpe_ratio = excess_returns.mean() / excess_returns.std() * np.sqrt(4) if excess_returns.std() != 0 else 0
        
        # Sortino Ratio
        downside_returns = excess_returns[excess_returns < 0]
        downside_std = downside_returns.std()
        sortino_ratio = excess_returns.mean() / downside_std * np.sqrt(4) if downside_std != 0 else 0

        return {
            "Final Value": series.iloc[-1],
            "Total Return": (series.iloc[-1] / series.iloc[0] - 1),
            "CAGR": cagr,
            "Annualized Volatility": annualized_volatility,
            "Max Drawdown": max_drawdown,
            "Sharpe Ratio": sharpe_ratio,
            "Sortino Ratio": sortino_ratio,
        }

    @staticmethod
    def display_performance_summary(
        strategy_df: pd.DataFrame, comparison_df: pd.DataFrame, initial_capital: float
    ) -> None:
        """Calculate and display final performance metrics in a table."""
        logging.info("Calculating final performance metrics.")
        
        # Prepend initial capital for accurate KPI calculation
        strategy_series = pd.concat([pd.Series([initial_capital]), strategy_df['total_value']]).reset_index(drop=True)
        bh_series = pd.concat([pd.Series([initial_capital]), comparison_df['total_value']]).reset_index(drop=True)

        strat_kpis = Reporting._calculate_kpis(strategy_series)
        bh_kpis = Reporting._calculate_kpis(bh_series)

        table = Table(title="Backtest Performance Summary")
        table.add_column("Metric", justify="right", style="cyan", no_wrap=True)
        table.add_column("9sig Strategy", justify="right", style="magenta")
        table.add_column("Buy & Hold", justify="right", style="green")

        table.add_row("Final Value", f"${strat_kpis['Final Value']:,.2f}", f"${bh_kpis['Final Value']:,.2f}")
        table.add_row("Total Return", f"{strat_kpis['Total Return']:.2%}", f"{bh_kpis['Total Return']:.2%}")
        table.add_row("CAGR", f"{strat_kpis['CAGR']:.2%}", f"{bh_kpis['CAGR']:.2%}")
        table.add_row("Annualized Volatility", f"{strat_kpis['Annualized Volatility']:.2%}", f"{bh_kpis['Annualized Volatility']:.2%}")
        table.add_row("Max Drawdown", f"{strat_kpis['Max Drawdown']:.2%}", f"{bh_kpis['Max Drawdown']:.2%}")
        table.add_row("Sharpe Ratio", f"{strat_kpis['Sharpe Ratio']:.2f}", f"{bh_kpis['Sharpe Ratio']:.2f}")
        table.add_row("Sortino Ratio", f"{strat_kpis['Sortino Ratio']:.2f}", f"{bh_kpis['Sortino Ratio']:.2f}")
        table.add_row("Outperformance (Final Value)", f"{(strat_kpis['Final Value'] / bh_kpis['Final Value'] - 1):.2%}", "---")

        console = Console()
        console.print(table)

# --- Main Execution ---

def main() -> None:
    """Run the complete backtesting and reporting pipeline."""
    # Initialization
    strategy_config = StrategyConfig()
    file_config = FileConfig()
    
    # Ensure output directory exists
    file_config.output_dir.mkdir(exist_ok=True)
    
    setup_logging(file_config.log_file_path)

    # Instantiate core components
    portfolio = Portfolio(strategy_config)
    data_handler = DataHandler()
    backtester = Backtester(strategy_config, portfolio, data_handler)
    reporter = Reporting()

    # Data Loading
    price_data = data_handler.load_price_data(file_config.data_csv_path)
    quarter_ends = data_handler.get_quarter_end_dates(price_data)

    # Backtesting
    strategy_results = backtester.run(price_data, quarter_ends)
    strategy_results.to_csv(file_config.results_csv_path, index=False)
    logging.info(f"Detailed results saved to {file_config.results_csv_path}")

    # Reporting
    comparison_results = reporter.create_buy_and_hold_comparison(
        price_data, quarter_ends, strategy_config.initial_capital
    )
    reporter.plot_interactive_results(
        strategy_results, comparison_results, file_config.plot_html_path
    )
    reporter.display_performance_summary(
        strategy_results, comparison_results, strategy_config.initial_capital
    )

if __name__ == "__main__":
    main()