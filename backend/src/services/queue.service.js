// src/services/queue.service.js
const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const sms = require('./sms.service');

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
});

// ── Queue ─────────────────────────────────────────────────────────────────────
const smsQueue = new Queue('sms', {
  connection,
  defaultJobOptions: {
    attempts:    3,
    backoff:     { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail:     50,
  },
});

// ── Job helpers (called from controllers) ────────────────────────────────────
async function queueOrderConfirmation(data) {
  return smsQueue.add('order_confirmation', data, { priority: 1 });
}
async function queuePaymentFailed(data) {
  return smsQueue.add('payment_failed', data, { priority: 1 });
}
async function queueInstallationReminder(data) {
  return smsQueue.add('installation_reminder', data);
}
async function queueQuoteFollowUp(data) {
  return smsQueue.add('quote_follow_up', data);
}
async function queueSiteVisitReminder(data) {
  return smsQueue.add('site_visit_reminder', data);
}
async function queuePaymentLinkNotification(data) {
  return smsQueue.add('payment_link_notification', data, { priority: 1 });
}

// ── Worker (processes jobs) ───────────────────────────────────────────────────
function startWorker() {
  const worker = new Worker('sms', async (job) => {
    console.log(`📤 Processing SMS job: ${job.name} (id: ${job.id})`);
    switch (job.name) {
      case 'order_confirmation':
        await sms.orderConfirmation(job.data); break;
      case 'payment_failed':
        await sms.paymentFailed(job.data); break;
      case 'installation_reminder':
        await sms.installationReminder(job.data); break;
      case 'quote_follow_up':
        await sms.quoteFollowUp(job.data); break;
      case 'site_visit_reminder':
        await sms.siteVisitReminder(job.data); break;
      case 'payment_link_notification':
        await sms.paymentLinkNotification(job.data); break;
      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  }, { connection });

  worker.on('completed', (job) => console.log(`✅ SMS job ${job.id} (${job.name}) completed`));
  worker.on('failed', (job, err) => console.error(`❌ SMS job ${job?.id} failed:`, err.message));
  return worker;
}

module.exports = {
  smsQueue,
  startWorker,
  queueOrderConfirmation,
  queuePaymentFailed,
  queueInstallationReminder,
  queueQuoteFollowUp,
  queueSiteVisitReminder,
  queuePaymentLinkNotification,
};
