import { Router } from 'express';
import { config } from '../config/index.js';

export function apiRouter({ adapterManager, settingsStore, pushService, alertManager }) {
  const router = Router();

  router.get('/health', (req, res) => {
    res.json({ ok: true, ...adapterManager.status(), time: Date.now() });
  });

  router.get('/settings/:symbol', (req, res) => {
    res.json(settingsStore.get(req.params.symbol));
  });

  router.post('/settings/:symbol', (req, res) => {
    const updated = settingsStore.update(req.params.symbol, req.body || {});
    res.json(updated);
  });

  router.get('/history', (req, res) => {
    res.json(alertManager.getHistory(Number(req.query.limit) || 100));
  });

  router.get('/push/vapid-public-key', (req, res) => {
    res.json({ publicKey: config.push.vapidPublicKey, enabled: pushService.enabled });
  });

  router.post('/push/subscribe', (req, res) => {
    pushService.addSubscription(req.body);
    res.json({ ok: true });
  });

  router.post('/push/unsubscribe', (req, res) => {
    pushService.removeSubscription(req.body.endpoint);
    res.json({ ok: true });
  });

  router.post('/push/test', async (req, res) => {
    await pushService.broadcast({
      type: 'TEST',
      title: 'Test alert',
      body: 'Push notifications are wired up correctly.',
      tag: 'test',
    });
    res.json({ ok: true, enabled: pushService.enabled });
  });

  return router;
}
