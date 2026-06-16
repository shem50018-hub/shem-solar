// src/services/mpesa.service.js
const axios = require('axios');
const dayjs = require('dayjs');

const BASE_URL = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

let _tokenCache = null;
let _tokenExpiry = null;

// ── 1. Get OAuth access token (cached) ────────────────────────────────────────
async function getAccessToken() {
  if (_tokenCache && _tokenExpiry && dayjs().isBefore(_tokenExpiry)) {
    return _tokenCache;
  }
  const credentials = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString('base64');

  const { data } = await axios.get(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${credentials}` } }
  );

  _tokenCache  = data.access_token;
  _tokenExpiry = dayjs().add(55, 'minute'); // token valid for 60min — refresh at 55
  return _tokenCache;
}

// ── 2. Generate Lipa Na M-Pesa password ───────────────────────────────────────
function generatePassword() {
  const timestamp = dayjs().format('YYYYMMDDHHmmss');
  const raw = `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`;
  return {
    password:  Buffer.from(raw).toString('base64'),
    timestamp,
  };
}

// ── 3. Initiate STK Push ──────────────────────────────────────────────────────
// phone must be in format 254XXXXXXXXX (no leading 0)
async function initiateSTKPush({ phone, amount, orderNumber, description }) {
  const token = await getAccessToken();
  const { password, timestamp } = generatePassword();

  // Normalise phone: strip leading 0 or +, prepend 254
  const normalised = phone.replace(/^(\+254|0)/, '254');

  const payload = {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password:          password,
    Timestamp:         timestamp,
    TransactionType:   'CustomerPayBillOnline',
    Amount:            Math.round(amount), // must be integer
    PartyA:            normalised,
    PartyB:            process.env.MPESA_SHORTCODE,
    PhoneNumber:       normalised,
    CallBackURL:       process.env.MPESA_CALLBACK_URL,
    AccountReference:  orderNumber,          // shows on customer's M-Pesa receipt
    TransactionDesc:   description || `Shem Solar – ${orderNumber}`,
  };

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
    payload,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  // data.ResponseCode === '0' means the push was sent successfully
  // data.CheckoutRequestID is what we store in orders.mpesa_checkout_id
  if (data.ResponseCode !== '0') {
    throw new Error(`Daraja STK push failed: ${data.ResponseDescription}`);
  }

  return {
    checkoutRequestId:  data.CheckoutRequestID,
    merchantRequestId:  data.MerchantRequestID,
    responseDescription: data.ResponseDescription,
  };
}

// ── 4. Parse the Safaricom callback body ──────────────────────────────────────
// Returns { success, checkoutRequestId, receiptNumber, phone, amount } or { success: false, reason }
function parseCallback(body) {
  try {
    const stk = body.Body?.stkCallback;
    if (!stk) throw new Error('Invalid callback shape');

    const checkoutRequestId = stk.CheckoutRequestID;
    const resultCode        = stk.ResultCode;

    if (resultCode !== 0) {
      // resultCode 1032 = user cancelled, 1037 = timeout, etc.
      return {
        success: false,
        checkoutRequestId,
        reason: stk.ResultDesc || 'Payment failed',
        resultCode,
      };
    }

    // Extract items from CallbackMetadata
    const items = stk.CallbackMetadata?.Item || [];
    const get = (name) => items.find(i => i.Name === name)?.Value;

    return {
      success:            true,
      checkoutRequestId,
      receiptNumber:      get('MpesaReceiptNumber'),
      phone:              String(get('PhoneNumber')),
      amount:             get('Amount'),
      transactionDate:    String(get('TransactionDate')),
    };
  } catch (err) {
    throw new Error(`Failed to parse M-Pesa callback: ${err.message}`);
  }
}

module.exports = { getAccessToken, initiateSTKPush, parseCallback };
