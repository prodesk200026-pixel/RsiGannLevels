import webpush from 'web-push';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, 'subscriptions.json');

function loadSubs() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function saveSubs(subs) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(subs, null, 2));
}

export class PushService {
  constructor() {
    this.enabled = Boolean(config.push.vapidPublicKey && config.push.vapidPrivateKey);
    if (this.enabled) {
      webpush.setVapidDetails(
        config.push.vapidSubject,
        config.push.vapidPublicKey,
        config.push.vapidPrivateKey
      );
    } else {
      console.warn('[PushService] VAPID keys not set — generate with `npx web-push generate-vapid-keys` and set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY. Push alerts disabled; in-app beep still works while the tab is open.');
    }
    this.subscriptions = loadSubs();
  }

  addSubscription(sub) {
    if (!this.subscriptions.find((s) => s.endpoint === sub.endpoint)) {
      this.subscriptions.push(sub);
      saveSubs(this.subscriptions);
    }
  }

  removeSubscription(endpoint) {
    this.subscriptions = this.subscriptions.filter((s) => s.endpoint !== endpoint);
    saveSubs(this.subscriptions);
  }

  async broadcast(payload) {
    if (!this.enabled) return;
    const body = JSON.stringify(payload);
    await Promise.all(
      this.subscriptions.map((sub) =>
        webpush.sendNotification(sub, body).catch((err) => {
          if (err.statusCode === 410 || err.statusCode === 404) this.removeSubscription(sub.endpoint);
          else console.warn('[PushService] send failed:', err.message);
        })
      )
    );
  }
}
