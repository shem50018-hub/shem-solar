// src/services/sms.service.js
const AfricasTalking = require('africastalking');

let _at = null;
function getSMSClient() {
  if (!_at) {
    _at = AfricasTalking({
      apiKey: process.env.AT_API_KEY,
      username: process.env.AT_USERNAME,
    });
  }
  return _at.SMS;
}

// ── Core send function ────────────────────────────────────────────────────────
async function sendSMS({ to, message }) {
  // Normalise to 254XXXXXXXXX
  const phone = to.replace(/^(\+254|0)/, '+254');

  const sms = getSMSClient();
  const result = await sms.send({
    to: [phone],
    message,
    from: process.env.AT_SENDER_ID,
  });

  const recipient = result?.SMSMessageData?.Recipients?.[0];
  if (!recipient) {
    throw new Error(`SMS failed to ${phone}: no response from Africa's Talking (check API key/username/balance)`);
  }
  if (recipient.status !== 'Success') {
    throw new Error(`SMS failed to ${phone}: ${recipient.status}`);
  }
  console.log(`📱 SMS sent to ${phone} — messageId: ${recipient.messageId}`);
  return recipient;
}

// ── Pre-defined templates ─────────────────────────────────────────────────────

function orderConfirmation({ name, orderNumber, product, amount, phone }) {
  return sendSMS({
    to: phone,
    message:
      `Hi ${name}, your Shem Solar order ${orderNumber} is confirmed! ` +
      `Product: ${product}. ` +
      `Amount paid: KES ${Number(amount).toLocaleString()}. ` +
      `Our team will contact you within 24hrs to schedule installation. ` +
      `Questions? Call 0717644520. ShemSolar`,
  });
}

function installationReminder({ name, phone, date, time }) {
  return sendSMS({
    to: phone,
    message:
      `Hi ${name}, your Shem Solar installation is scheduled for ` +
      `${date} at ${time}. Our technician will call 1hr before arrival. ` +
      `Ensure access to your main switchboard. ShemSolar 0717644520`,
  });
}

function paymentLinkNotification({ name, phone, orderNumber, amount, productName }) {
  return sendSMS({
    to: phone,
    message:
      `Hi ${name}, your Shem Solar quote is ready! ` +
      `${productName} — KES ${Number(amount).toLocaleString()}. ` +
      `Reply YES or call 0717644520 to receive your M-Pesa payment link. ` +
      `Ref: ${orderNumber}. ShemSolar`,
  });
}

function paymentFailed({ name, phone, orderNumber }) {
  return sendSMS({
    to: phone,
    message:
      `Hi ${name}, your M-Pesa payment for order ${orderNumber} was not completed. ` +
      `Please try again or call us on 0717644520. ShemSolar`,
  });
}

function quoteFollowUp({ name, phone, system, estimatedValue }) {
  return sendSMS({
    to: phone,
    message:
      `Hi ${name}, thanks for your interest in solar! ` +
      `We've prepared a quote for a ${system} system worth KES ${Number(estimatedValue).toLocaleString()}. ` +
      `Call 0717644520 or reply YES to receive it. ShemSolar`,
  });
}

function siteVisitReminder({ name, phone, date }) {
  return sendSMS({
    to: phone,
    message:
      `Hi ${name}, reminder: Shem Solar engineers will visit your property tomorrow, ${date}, ` +
      `for a FREE solar site assessment. Please ensure someone is home. ` +
      `Call 0717644520 to reschedule. ShemSolar`,
  });
}

module.exports = {
  sendSMS,
  orderConfirmation,
  installationReminder,
  paymentLinkNotification,
  paymentFailed,
  quoteFollowUp,
  siteVisitReminder,
};
