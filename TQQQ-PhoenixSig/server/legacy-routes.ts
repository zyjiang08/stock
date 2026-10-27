import type { Express, Request, Response } from 'express';
import { getStrategyPayloads } from './strategy/service.js';
import { runRebalanceAlertsJob } from './jobs/rebalance-alerts.js';

export function registerLegacyRoutes(app: Express): void {
  app.get('/api/strategy/current', async (_req: Request, res: Response) => {
    try {
      const { current } = await getStrategyPayloads();
      res.json(current);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load current strategy snapshot.';
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.get('/api/strategy/backtest', async (_req: Request, res: Response) => {
    try {
      const { backtest } = await getStrategyPayloads();
      res.json(backtest);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load backtest payload.';
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.post('/api/jobs/rebalance-alerts/run', async (req: Request, res: Response) => {
    try {
      const result = await runRebalanceAlertsJob(req.header('x-job-key'));
      res.status(result.status).json(result.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to run rebalance alerts job.';
      res.status(500).json({ ok: false, error: message });
    }
  });
}
