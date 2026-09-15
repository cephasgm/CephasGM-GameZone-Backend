/**
 * ============================================================
 * CephasGM GameZone — Payment Provider Registry
 * ============================================================
 */

'use strict';

const config = require('../../config');
const logger = require('../../config/logger');
const { AppError } = require('../../utils/AppError');

const mockProvider        = require('./mockProvider');
const mpesaProvider       = require('./mpesaProvider');
const flutterwaveProvider = require('./flutterwaveProvider');

/* Registry — maps PaymentMethod enum → provider instance */
const REGISTRY = {
  MPESA:          mpesaProvider,
  TIGO_PESA:      mockProvider,
  AIRTEL_MONEY:   mockProvider,
  FLUTTERWAVE:    flutterwaveProvider,
  CARD:           flutterwaveProvider,
  BANK_TRANSFER:  flutterwaveProvider,
  CRYPTO:         mockProvider,
};

function get(method) {
  const key = String(method).toUpperCase();
  const provider = REGISTRY[key];

  if (!provider) {
    throw new AppError(
      `Unsupported payment method: ${method}`,
      400,
      'UNSUPPORTED_PAYMENT_METHOD'
    );
  }

  if (!provider.isEnabled()) {
    throw new AppError(
      `Payment method ${method} is not available right now`,
      503,
      'PAYMENT_METHOD_DISABLED'
    );
  }

  return provider;
}

function availableMethods() {
  const methods = [];

  if (mpesaProvider.isEnabled()) {
    methods.push({ method: 'MPESA', label: 'M-Pesa', provider: 'mpesa' });
  }
  if (flutterwaveProvider.isEnabled()) {
    methods.push({ method: 'CARD', label: 'Card / Bank', provider: 'flutterwave' });
    methods.push({ method: 'FLUTTERWAVE', label: 'Mobile Money (Flutterwave)', provider: 'flutterwave' });
  }
  if (mockProvider.isEnabled()) {
    methods.push({ method: 'BANK_TRANSFER', label: 'Bank Transfer', provider: 'mock' });
    methods.push({ method: 'AIRTEL_MONEY', label: 'Airtel Money', provider: 'mock' });
    methods.push({ method: 'TIGO_PESA', label: 'Tigo Pesa', provider: 'mock' });
  }

  return methods;
}

function defaultProviderFor(method) {
  return REGISTRY[String(method).toUpperCase()] || mockProvider;
}

logger.info(
  {
    registered: Object.keys(REGISTRY),
    mockEnabled: mockProvider.isEnabled(),
    mpesaEnabled: mpesaProvider.isEnabled(),
    flutterwaveEnabled: flutterwaveProvider.isEnabled(),
  },
  '💳 Payment providers loaded'
);

module.exports = {
  get,
  availableMethods,
  defaultProviderFor,
  mock: mockProvider,
  mpesa: mpesaProvider,
  flutterwave: flutterwaveProvider,
};