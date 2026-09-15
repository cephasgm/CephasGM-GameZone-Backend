/**
 * ============================================================
 * CephasGM GameZone — KYC Validators
 * ============================================================
 */

'use strict';

const { z } = require('zod');

const documentTypeEnum = z.enum([
  'ID',
  'PASSPORT',
  'DRIVER_LICENSE',
  'UTILITY_BILL',
  'SELFIE',
]);

const submitKYCSchema = z.object({
  documents: z
    .array(
      z.object({
        documentType: documentTypeEnum,
        documentUrl: z.string().url().max(500),
        documentNumber: z.string().trim().max(50).optional(),
        cloudinaryId: z.string().trim().max(200).optional(),
      })
    )
    .min(1, 'At least one document is required')
    .max(5, 'Maximum 5 documents per submission'),
});

const reviewKYCSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  rejectionNote: z.string().trim().max(500).optional(),
}).refine((d) => d.status !== 'REJECTED' || (d.rejectionNote && d.rejectionNote.length >= 3), {
  message: 'Rejection requires a note',
  path: ['rejectionNote'],
});

module.exports = {
  submitKYCSchema,
  reviewKYCSchema,
};